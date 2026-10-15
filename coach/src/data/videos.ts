import { cloudMode } from './config';
import { supabase } from './supabase';

/**
 * Nagrania serii (technika). W chmurze: prywatny koszyk Supabase Storage „set-videos”
 * (folder = id podopiecznego, dostęp: trener i ten podopieczny). Bez chmury: IndexedDB
 * w przeglądarce. W zapisie serii zostaje tylko odnośnik: „sb:<ścieżka>” albo „idb:<id>”.
 */
export const VIDEO_BUCKET = 'set-videos';
/** Domyślny limit pliku w darmowym planie Supabase. */
export const VIDEO_MAX_MB = 50;

const IDB = 'fitowa-videos';
const STORE = 'v';

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

function extOf(file: File): string {
  const fromName = file.name.match(/\.([a-z0-9]{2,4})$/i)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  if (file.type.includes('quicktime')) return 'mov';
  if (file.type.includes('webm')) return 'webm';
  return 'mp4';
}

/** Sprawdza plik przed wysłaniem; zwraca komunikat błędu albo null. */
export function videoProblem(file: File): string | null {
  if (!file.type.startsWith('video/') && !/\.(mov|mp4|m4v|webm)$/i.test(file.name)) return 'To nie jest plik wideo.';
  if (file.size > VIDEO_MAX_MB * 1024 * 1024)
    return `Nagranie ma ${Math.round(file.size / 1024 / 1024)} MB — limit to ${VIDEO_MAX_MB} MB. Nagraj krótszy fragment (sama seria) albo w niższej jakości (Ustawienia → Aparat → Nagrywanie wideo → 1080p).`;
  return null;
}

/** Zapisuje nagranie i zwraca odnośnik do zapisania przy serii. */
export async function saveSetVideo(file: File, clientId: string): Promise<string> {
  if (cloudMode()) {
    const path = `${clientId}/${rid()}.${extOf(file)}`;
    const { error } = await supabase.storage.from(VIDEO_BUCKET).upload(path, file, { contentType: file.type || 'video/mp4', upsert: false });
    if (error) throw new Error(error.message);
    return `sb:${path}`;
  }
  const id = rid();
  await idbDo('readwrite', (s) => s.put(file, id));
  return `idb:${id}`;
}

/** Adres do odtworzenia nagrania (w chmurze link ważny godzinę). */
export async function videoUrl(ref: string): Promise<string> {
  if (ref.startsWith('sb:')) {
    const { data, error } = await supabase.storage.from(VIDEO_BUCKET).createSignedUrl(ref.slice(3), 3600);
    if (error || !data) throw new Error(error?.message ?? 'Brak nagrania.');
    return data.signedUrl;
  }
  if (ref.startsWith('idb:')) {
    const blob = await idbDo<Blob | undefined>('readonly', (s) => s.get(ref.slice(4)));
    if (!blob) throw new Error('Nagranie jest zapisane tylko na innym urządzeniu.');
    return URL.createObjectURL(blob);
  }
  if (/^https?:\/\//.test(ref)) return ref;
  throw new Error('Nieznane nagranie.');
}

/** Usuwa plik nagrania (błąd pomijany — odnośnik i tak znika z serii). */
export async function deleteSetVideo(ref: string): Promise<void> {
  try {
    if (ref.startsWith('sb:')) {
      await supabase.storage.from(VIDEO_BUCKET).remove([ref.slice(3)]);
    } else if (ref.startsWith('idb:')) {
      await idbDo('readwrite', (s) => s.delete(ref.slice(4)));
    }
  } catch {
    // brak sieci / pliku — nic więcej do zrobienia
  }
}
