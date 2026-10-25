import { useEffect, useRef, useState } from 'react';
import { VOICE_MAX_S } from '../data/chatMedia';
import { fmtClock, pickAudioMime } from '../lib/chat';
import { Icon } from './ui';

export const canRecordVoice = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

export interface VoiceClip {
  blob: Blob;
  url: string;
  dur: number;
}

/**
 * Nagrywanie wiadomości głosowej: naciśnij — nagrywa do „Stop”; przytrzymaj — nagrywa do puszczenia.
 * Format: MP4/AAC gdzie się da (iPhone), inaczej WebM/Opus (Android). Limit {@link VOICE_MAX_S} s.
 */
export function useVoiceRecorder(onDone: (clip: VoiceClip) => void, onError: (msg: string) => void) {
  const [state, setState] = useState<'idle' | 'starting' | 'rec'>('idle');
  const [secs, setSecs] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const t0 = useRef(0);
  const cancelled = useRef(false);
  const heldAt = useRef(0);
  const stopAfterStart = useRef(false);

  const cleanup = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  useEffect(
    () => () => {
      cancelled.current = true;
      if (rec.current?.state === 'recording') rec.current.stop();
      cleanup();
    },
    [],
  );
  useEffect(() => {
    if (state !== 'rec') return;
    const id = window.setInterval(() => {
      const s = (Date.now() - t0.current) / 1000;
      setSecs(Math.floor(s));
      if (s >= VOICE_MAX_S && rec.current?.state === 'recording') rec.current.stop();
    }, 250);
    return () => window.clearInterval(id);
  }, [state]);

  const start = async () => {
    if (state !== 'idle') return;
    cancelled.current = false;
    stopAfterStart.current = false;
    setState('starting');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      stream.current = s;
      const mimeType = pickAudioMime((m) => MediaRecorder.isTypeSupported?.(m) ?? false);
      const r = new MediaRecorder(s, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64_000 });
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        cleanup();
        setState('idle');
        const dur = (Date.now() - t0.current) / 1000;
        if (cancelled.current || dur < 0.6 || !chunks.length) return;
        const type = (r.mimeType || mimeType || 'audio/mp4').split(';')[0];
        const blob = new Blob(chunks, { type });
        onDone({ blob, url: URL.createObjectURL(blob), dur: Math.min(dur, VOICE_MAX_S) });
      };
      t0.current = Date.now();
      r.start(500);
      rec.current = r;
      setSecs(0);
      setState('rec');
      if (stopAfterStart.current) r.stop();
    } catch (e) {
      cleanup();
      setState('idle');
      const err = e as Error;
      onError(err.name === 'NotAllowedError' ? 'Brak zgody na mikrofon — zezwól w ustawieniach przeglądarki.' : `Nie udało się włączyć mikrofonu (${err.message}).`);
    }
  };
  const stop = () => {
    if (rec.current?.state === 'recording') rec.current.stop();
    else if (state === 'starting') stopAfterStart.current = true;
  };
  const cancel = () => {
    cancelled.current = true;
    stop();
  };

  /** Obsługa przycisku mikrofonu: krótkie naciśnięcie = start/stop, przytrzymanie = nagrywanie do puszczenia. */
  const pressProps = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      heldAt.current = Date.now();
      if (state === 'idle') void start();
    },
    onPointerUp: () => {
      const held = Date.now() - heldAt.current;
      if (held > 450 && (state === 'rec' || state === 'starting')) stop();
    },
    onClick: (e: React.MouseEvent) => {
      // klawiatura (Enter / spacja) — bez pointerdown
      if (e.detail === 0) {
        if (state === 'idle') void start();
        else stop();
      }
    },
  };
  return { state, secs, start, stop, cancel, pressProps };
}

/** Odtwarzacz wiadomości głosowej w dymku: przycisk, pasek postępu, czas. */
export function VoicePlayer({ src, dur, label = 'Wiadomość głosowa' }: { src: string | null; dur?: number; label?: string }) {
  const a = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [len, setLen] = useState(dur ?? 0);
  const [err, setErr] = useState(false);
  const total = len || dur || 0;
  return (
    <div className="voice">
      <button
        type="button"
        className="voice-btn"
        aria-label={playing ? `Pauza: ${label}` : `Odtwórz: ${label}`}
        disabled={!src || err}
        onClick={() => {
          const el = a.current;
          if (!el) return;
          if (el.paused) void el.play().catch(() => setErr(true));
          else el.pause();
        }}
      >
        <Icon name={playing ? 'pause' : 'play'} size={18} />
      </button>
      <input
        type="range"
        className="voice-bar"
        min={0}
        max={Math.max(1, total)}
        step={0.1}
        value={Math.min(t, total || t)}
        aria-label="Postęp odtwarzania"
        onChange={(e) => {
          if (a.current) a.current.currentTime = Number(e.target.value);
          setT(Number(e.target.value));
        }}
        style={{ '--p': `${total ? Math.min(100, (t / total) * 100) : 0}%` } as React.CSSProperties}
      />
      <span className="voice-time">{err ? 'błąd' : fmtClock(playing || t > 0 ? t : total)}</span>
      {src && (
        <audio
          ref={a}
          src={src}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setT(0);
          }}
          onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setLen(e.currentTarget.duration)}
          onError={() => setErr(true)}
        />
      )}
    </div>
  );
}
