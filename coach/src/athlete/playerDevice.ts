import { useEffect } from 'react';
import { BEEP_SEC, buildRestWav } from '../lib/restWav';

/**
 * Urządzenie w trakcie treningu: ekran nie gaśnie (Wake Lock), a koniec przerwy słychać przy
 * zablokowanym telefonie (element <audio> z plikiem „cisza + sygnał”, Media Session na ekranie blokady).
 * Wszystko z bezpiecznym brakiem działania, gdy przeglądarka nie ma danego API.
 */

type Sentinel = { release: () => Promise<void>; released?: boolean };
type WakeNav = Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } };

/** Ekran nie gaśnie, dopóki `active`; po powrocie do aplikacji blokada jest żądana ponownie (system ją zwalnia). */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    const nav = navigator as WakeNav;
    if (!active || !nav.wakeLock) return;
    let lock: Sentinel | null = null;
    let stop = false;
    const req = async () => {
      if (stop || document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      try {
        const l = await nav.wakeLock!.request('screen');
        if (stop) void l.release().catch(() => {});
        else lock = l;
      } catch {
        // odmowa (np. tryb oszczędzania baterii) — ekran zgaśnie normalnie
      }
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') void req();
    };
    void req();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop = true;
      document.removeEventListener('visibilitychange', onVis);
      void lock?.release().catch(() => {});
      lock = null;
    };
  }, [active]);
}

const SOUND_KEY = 'fitowa-rest-sound';

/** Sygnał końca przerwy przy zablokowanym ekranie — domyślnie włączony. */
export function restSoundOn(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== '0';
  } catch {
    return true;
  }
}
export function setRestSound(on: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, on ? '1' : '0');
  } catch {
    // bez zapamiętania
  }
  if (!on) stopRestAudio();
}

let el: HTMLAudioElement | null = null;
let url: string | null = null;
/** Koniec przerwy, do której gra obecny plik (ms) i długość ciszy (s). */
let playingEnd = 0;
let silence = 0;

function audioEl(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  if (!el) {
    el = new Audio();
    el.preload = 'auto';
    el.setAttribute('playsinline', '');
  }
  return el;
}

/**
 * Pierwsze dotknięcie w odtwarzaczu „odblokowuje” element audio (iOS pozwala potem grać
 * bez kolejnego gestu, np. z efektu po zaliczeniu serii).
 */
export function primeRestAudio() {
  const a = audioEl();
  if (!a || a.dataset.primed || !restSoundOn()) return;
  a.dataset.primed = '1';
  const blob = new Blob([buildRestWav(0.05, 0).buffer as ArrayBuffer], { type: 'audio/wav' });
  const u = URL.createObjectURL(blob);
  a.src = u;
  a.volume = 0;
  void a
    .play()
    .then(() => a.pause())
    .catch(() => delete a.dataset.primed)
    .finally(() => {
      a.volume = 1;
      URL.revokeObjectURL(u);
    });
}

/** Gra „ciszę do końca przerwy + sygnał”; zwraca false, gdy się nie da (brak API, odmowa autoodtwarzania). */
export function startRestAudio(end: number, info: { title: string; subtitle?: string }): boolean {
  const a = audioEl();
  if (!a || !restSoundOn()) return false;
  const sec = (end - Date.now()) / 1000;
  if (sec < 2) return false;
  if (playingEnd === end && !a.paused) return true;
  stopRestAudio();
  silence = sec;
  playingEnd = end;
  url = URL.createObjectURL(new Blob([buildRestWav(sec).buffer as ArrayBuffer], { type: 'audio/wav' }));
  a.src = url;
  a.currentTime = 0;
  a.play().catch(() => {
    playingEnd = 0;
  });
  setMedia(end, info);
  return true;
}

/** Czy sygnał końca przerwy zagra z pliku (wtedy bez dodatkowego piknięcia w aplikacji). */
export function restAudioPlaying(): boolean {
  return !!el && !el.paused && playingEnd > 0;
}

/**
 * Zatrzymuje dźwięk przerwy. `keepTail` — gdy sygnał końca już gra, niech wybrzmi
 * (przerwa skończyła się sama, nie została pominięta).
 */
export function stopRestAudio(keepTail = false) {
  if (!el) return;
  if (keepTail && !el.paused && el.currentTime >= silence - 0.4 && el.currentTime < silence + BEEP_SEC) {
    const u = url;
    el.onended = () => {
      if (u) URL.revokeObjectURL(u);
      if (el) el.onended = null;
    };
    url = null;
    playingEnd = 0;
    clearMedia();
    return;
  }
  el.onended = null;
  el.pause();
  if (url) URL.revokeObjectURL(url);
  url = null;
  playingEnd = 0;
  el.removeAttribute('src');
  try {
    el.load();
  } catch {
    // nic
  }
  clearMedia();
}

const clock = (t: number) => new Date(t).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Ekran blokady: „Przerwa do 14:32:10” + pasek postępu odtwarzania = odliczanie. */
function setMedia(end: number, info: { title: string; subtitle?: string }) {
  const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
  if (!ms || typeof MediaMetadata === 'undefined') return;
  try {
    ms.metadata = new MediaMetadata({ title: `${info.title} do ${clock(end)}`, artist: info.subtitle ?? '', album: 'Fitowa' });
    ms.playbackState = 'playing';
    // „pauza” na ekranie blokady wycisza tylko tę przerwę (odliczanie w aplikacji zostaje)
    ms.setActionHandler('pause', () => stopRestAudio());
    ms.setActionHandler('stop', () => stopRestAudio());
  } catch {
    // starsza przeglądarka — bez opisu na ekranie blokady
  }
}
function clearMedia() {
  const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
  if (!ms) return;
  try {
    ms.metadata = null;
    ms.playbackState = 'none';
    ms.setActionHandler('pause', null);
    ms.setActionHandler('stop', null);
  } catch {
    // nic
  }
}

/* ---------- koniec przerwy na cały ekran i zapowiedzi głosowe ---------- */

const FLASH_KEY = 'fitowa-rest-flash';
const VOICE_KEY = 'fitowa-voice';

function readFlag(key: string, def: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v == null ? def : v === '1';
  } catch {
    return def;
  }
}
function writeFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // bez zapamiętania
  }
}

/** Pełnoekranowy sygnał końca przerwy — domyślnie włączony. */
export const restFlashOn = () => readFlag(FLASH_KEY, true);
export const setRestFlash = (on: boolean) => writeFlag(FLASH_KEY, on);

/** Zapowiedzi głosowe („Następna seria: …”) — domyślnie wyłączone. */
export const voiceOn = () => readFlag(VOICE_KEY, false);
export function setVoice(on: boolean) {
  writeFlag(VOICE_KEY, on);
  if (!on) {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      // nic
    }
  }
}

/** Czy przeglądarka w ogóle ma syntezę mowy. */
export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

/** Polski głos, jeśli jest (lista głosów bywa pusta przy pierwszym wywołaniu). */
function plVoice(): SpeechSynthesisVoice | undefined {
  try {
    return window.speechSynthesis.getVoices().find((v) => /^pl(-|_|$)/i.test(v.lang));
  } catch {
    return undefined;
  }
}

/**
 * Mówi tekst po polsku (pl-PL), gdy zapowiedzi są włączone. Bez polskiego głosu — język pl-PL i domyślny głos
 * systemu; brak API albo błąd — po cichu nic. Poprzednia zapowiedź jest przerywana.
 */
export function speak(text: string, force = false): boolean {
  if ((!force && !voiceOn()) || !canSpeak() || !text.trim()) return false;
  try {
    const s = window.speechSynthesis;
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'pl-PL';
    const v = plVoice();
    if (v) u.voice = v;
    u.rate = 1;
    u.onerror = () => undefined;
    s.speak(u);
    return true;
  } catch {
    return false;
  }
}
