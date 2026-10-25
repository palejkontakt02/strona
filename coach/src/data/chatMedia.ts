import type { MsgMedia } from '../domain';
import { extFor } from '../lib/chat';
import { cloudMode } from './config';
import { deleteClientFile, FILE_BUCKET, fileUrl } from './files';
import { supabase } from './supabase';
import { deleteSetVideo, saveSetVideo, videoUrl } from './videos';

/**
 * Załączniki w rozmowie — te same miejsca co reszta plików podopiecznego:
 * wideo → koszyk „set-videos” (jak nagrania serii), zdjęcia i wiadomości głosowe → „client-files” (jak pliki z ankiety).
 * Folder = id podopiecznego (dostęp: trener i ten podopieczny). Bez chmury — IndexedDB tej przeglądarki.
 */

/** Limit wiadomości głosowej (s). */
export const VOICE_MAX_S = 180;
export const CHAT_IMAGE_MAX_MB = 20;

const rid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// ta sama baza co files.ts — fileUrl odczyta stąd plik
function idbPut(blob: Blob, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('fitowa-files', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('f');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const req = r.result.transaction('f', 'readwrite').objectStore('f').put(blob, id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    };
  });
}

/** Zdjęcie z telefonu zmniejszone do 1600 px (JPEG) przed wysyłką; gdy się nie da (np. HEIC poza Safari) — oryginał. */
export async function shrinkPhoto(file: Blob, max = 1600): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) || file.size < 300 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.82));
    return out && out.size < file.size ? out : file;
  } catch {
    return file;
  }
}

/** Zapisuje plik do wiadomości i zwraca załącznik. Wideo musi już mieścić się w limicie (fitVideoFile w SetVideo). */
export async function saveChatMedia(blob: Blob, kind: MsgMedia['kind'], clientId: string, dur?: number): Promise<MsgMedia> {
  const extra = dur != null && Number.isFinite(dur) ? { dur: Math.round(dur * 10) / 10 } : {};
  if (kind === 'video') {
    const file = blob instanceof File ? blob : new File([blob], `film.${extFor(blob.type)}`, { type: blob.type || 'video/mp4' });
    return { kind, ref: await saveSetVideo(file, clientId), mime: file.type || 'video/mp4', ...extra };
  }
  const data = kind === 'image' ? await shrinkPhoto(blob) : blob;
  const mime = (data.type || (kind === 'audio' ? 'audio/mp4' : 'image/jpeg')).split(';')[0];
  if (cloudMode()) {
    const path = `${clientId}/${kind === 'audio' ? 'glos' : 'czat'}-${rid()}.${extFor(mime)}`;
    const { error } = await supabase.storage.from(FILE_BUCKET).upload(path, data, { contentType: mime, upsert: false });
    if (error) throw new Error(/mime|not supported|invalid.*type/i.test(error.message) ? 'Baza wymaga aktualizacji (sekcja 23 w hardening.sql) — wiadomości głosowe nie są jeszcze włączone.' : error.message);
    return { kind, ref: `sb:${path}`, mime, ...extra };
  }
  const id = rid();
  await idbPut(data, id);
  return { kind, ref: `idb:${id}`, mime, ...extra };
}

/** Adres do wyświetlenia / odtworzenia (w chmurze link ważny godzinę). */
export const chatMediaUrl = (m: MsgMedia) => (m.kind === 'video' ? videoUrl(m.ref) : fileUrl(m.ref));

/** Usuwa plik załącznika (błędy pomijane). */
export const deleteChatMedia = (m: MsgMedia) => (m.kind === 'video' ? deleteSetVideo(m.ref) : deleteClientFile(m.ref));
