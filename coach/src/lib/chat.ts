import type { Client, MsgMedia, MsgRef, TrainingSession } from '../domain';
import { chatThread, type ChatMsg } from './comms';

/** Opis załącznika (gdy wiadomość nie ma tekstu). */
export const mediaLabel = (kind: MsgMedia['kind']) => (kind === 'audio' ? 'Wiadomość głosowa' : kind === 'video' ? 'Nagranie wideo' : 'Zdjęcie');

const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });

/** „Trening 1 · Przysiad, 25 paź” — kontekst wiadomości przypiętej do treningu / ćwiczenia. */
export function refText(ref: MsgRef): string {
  const what = [ref.workout || (ref.sessionId || ref.date ? 'Trening' : ''), ref.exName].filter(Boolean).join(' · ');
  return [what, ref.date ? shortDate(ref.date) : ''].filter(Boolean).join(', ');
}

/** Kontekst z treningu (zapisanego albo w trakcie) i ćwiczenia. */
export function refFor(s: Pick<TrainingSession, 'id' | 'date' | 'workoutName' | 'exercises'> | undefined, exIndex?: number, fallback?: { label?: string; date?: string }): MsgRef {
  const ex = exIndex != null ? s?.exercises[exIndex] : undefined;
  return {
    ...(s?.id ? { sessionId: s.id } : {}),
    ...(exIndex != null ? { exIndex } : {}),
    ...(ex?.name || (exIndex != null && fallback?.label) ? { exName: (ex?.name || fallback?.label)!.slice(0, 120) } : {}),
    ...(s?.workoutName || (exIndex == null && fallback?.label) ? { workout: (s?.workoutName || fallback?.label)!.slice(0, 120) } : {}),
    ...(s?.date || fallback?.date ? { date: s?.date || fallback?.date } : {}),
  };
}

/**
 * Wiadomości dotyczące treningu: przypięte do niego (ref / sessionId) i odpowiedzi trenera na nie.
 * Od najstarszej.
 */
export function threadForSession(c: Pick<Client, 'inbox' | 'replies'>, sessionId: string): ChatMsg[] {
  const all = chatThread(c);
  const ids = new Set(all.filter((m) => m.ref?.sessionId === sessionId || m.sessionId === sessionId).map((m) => m.id));
  return all.filter((m) => ids.has(m.id) || (m.replyTo != null && ids.has(m.replyTo)));
}

/** „0:07”, „1:05”. */
export const fmtClock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export type TextPart = { text: string } | { text: string; t: number };

/** Znaczniki czasu w tekście („0:07 — kolana do środka”) jako osobne części; tylko m:ss do 59:59. */
export function splitStamps(text: string): TextPart[] {
  const out: TextPart[] = [];
  const re = /(^|[^\d:])(\d{1,2}):([0-5]\d)(?![\d:])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[1].length;
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ text: `${m[2]}:${m[3]}`, t: Number(m[2]) * 60 + Number(m[3]) });
    last = start + m[2].length + 1 + m[3].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** Format wiadomości głosowej: MP4/AAC (iPhone, nowe przeglądarki), inaczej WebM/Opus (Android). */
export function pickAudioMime(isSupported: (m: string) => boolean): string {
  const opts = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  return opts.find((m) => {
    try {
      return isSupported(m);
    } catch {
      return false;
    }
  }) ?? '';
}

/** Rozszerzenie pliku z typu. */
export const extFor = (mime: string) =>
  /webm/.test(mime) ? 'webm' : /ogg/.test(mime) ? 'ogg' : /aac/.test(mime) ? 'aac' : /audio\/mp4|m4a/.test(mime) ? 'm4a' : /png/.test(mime) ? 'png' : /webp/.test(mime) ? 'webp' : /hei[cf]/.test(mime) ? 'heic' : /image/.test(mime) ? 'jpg' : 'mp4';

/** Wiadomość z nagraniem wideo, na którą odpowiada trener (znaczniki czasu przewijają to nagranie). */
export const videoOf = (m: Pick<ChatMsg, 'media'> | undefined) => m?.media?.find((x) => x.kind === 'video');
