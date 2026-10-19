import { cloudMode } from './config';
import { supabase } from './supabase';

/**
 * Pliki podopiecznego (zdjęcia, wyniki badań) dołączone do ankiety. W chmurze: prywatny koszyk
 * „client-files” (folder = id podopiecznego; dostęp: trener i ten podopieczny). Bez chmury: IndexedDB.
 * W zapisie zostaje odnośnik „sb:<ścieżka>” albo „idb:<id>”.
 */
export const FILE_BUCKET = 'client-files';
export const FILE_MAX_MB = 20;

const IDB = 'fitowa-files';
const STORE = 'f';

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(IDB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function idbDo<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const rid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const isImage = (type: string, name = '') => type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(name);
export const isPdf = (type: string, name = '') => type === 'application/pdf' || /\.pdf$/i.test(name);

/** Sprawdza plik; zwraca komunikat błędu albo null. */
export function fileProblem(file: File): string | null {
  if (!isImage(file.type, file.name) && !isPdf(file.type, file.name)) return `„${file.name}” — dodaj zdjęcie (JPG, PNG, HEIC) albo PDF.`;
  if (file.size > FILE_MAX_MB * 1024 * 1024) return `„${file.name}” ma ${Math.round(file.size / 1024 / 1024)} MB — limit to ${FILE_MAX_MB} MB.`;
  return null;
}

/**
 * Duże zdjęcie z telefonu (np. 4–12 MB) zmniejszone do ok. 2000 px (JPEG) — czytelne, a dużo lżejsze.
 * Jeśli przeglądarka nie umie go otworzyć (np. HEIC poza Safari) — zostaje oryginał.
 */
async function shrinkImage(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1.5 * 1024 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.85));
    return out && out.size < file.size ? out : file;
  } catch {
    return file;
  }
}

/** Zapisuje plik i zwraca odnośnik, typ i rozmiar po zmniejszeniu. */
export async function saveClientFile(file: File, clientId: string): Promise<{ ref: string; type: string; size: number }> {
  const blob = isImage(file.type, file.name) ? await shrinkImage(file) : file;
  const type = blob.type || file.type || (isPdf('', file.name) ? 'application/pdf' : 'image/jpeg');
  const ext = type === 'application/pdf' ? 'pdf' : type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : /hei[cf]/i.test(type + file.name) ? 'heic' : 'jpg';
  if (cloudMode()) {
    const path = `${clientId}/${rid()}.${ext}`;
    const { error } = await supabase.storage.from(FILE_BUCKET).upload(path, blob, { contentType: type, upsert: false });
    if (error) throw new Error(/bucket not found/i.test(error.message) ? 'BUCKET' : error.message);
    return { ref: `sb:${path}`, type, size: blob.size };
  }
  const id = rid();
  await idbDo('readwrite', (s) => s.put(blob, id));
  return { ref: `idb:${id}`, type, size: blob.size };
}

/** Adres do otwarcia pliku (w chmurze link ważny godzinę). */
export async function fileUrl(ref: string): Promise<string> {
  if (ref.startsWith('sb:')) {
    const { data, error } = await supabase.storage.from(FILE_BUCKET).createSignedUrl(ref.slice(3), 3600);
    if (error || !data) throw new Error(error?.message ?? 'Brak pliku.');
    return data.signedUrl;
  }
  if (ref.startsWith('idb:')) {
    const blob = await idbDo<Blob | undefined>('readonly', (s) => s.get(ref.slice(4)));
    if (!blob) throw new Error('Plik jest zapisany tylko na innym urządzeniu.');
    return URL.createObjectURL(blob);
  }
  throw new Error('Nieznany plik.');
}

/** Usuwa plik z magazynu (błąd pomijany — odnośnik i tak znika z ankiety). */
export async function deleteClientFile(ref: string): Promise<void> {
  try {
    if (ref.startsWith('sb:')) await supabase.storage.from(FILE_BUCKET).remove([ref.slice(3)]);
    else if (ref.startsWith('idb:')) await idbDo('readwrite', (s) => s.delete(ref.slice(4)));
  } catch {
    // brak sieci / pliku
  }
}

/** Rozmiar do pokazania: „840 kB”, „2,4 MB”. */
export const fmtSize = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} kB` : `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);
