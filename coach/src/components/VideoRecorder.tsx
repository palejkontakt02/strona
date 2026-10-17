import { useEffect, useRef, useState } from 'react';
import { VIDEO_MAX_MB } from '../data/videos';
import { Sheet } from './Sheet';
import { Icon } from './ui';

/** Nagrywanie w aplikacji działa, gdy przeglądarka ma kamerę i MediaRecorder (iOS 14.3+, Android, komputer). */
export const canRecordInApp = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

/** Format nagrania: MP4 (iPhone, nowy Chrome), inaczej WebM. */
function pickMime(): string {
  const opts = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return opts.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? '';
}

/** Bitrate dobrany tak, by ~45 s mieściło się w limicie pliku, ale nie mniej niż jakość „1080p z telefonu”. */
const BITRATE = 8_000_000;
const LIMIT = (VIDEO_MAX_MB - 2) * 1024 * 1024;

/**
 * Nagrywanie serii w aplikacji: tylna kamera, 1080p, wysoki bitrate (galeria telefonu przy wysyłce
 * przez przeglądarkę często zmniejsza jakość). Zatrzymuje się samo przed limitem rozmiaru pliku.
 */
export function VideoRecorder({ title, onDone, onClose }: { title: string; onDone: (file: File) => void; onClose: () => void }) {
  const live = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const size = useRef(0);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [state, setState] = useState<'starting' | 'ready' | 'rec' | 'done' | 'error'>('starting');
  const [err, setErr] = useState('');
  const [secs, setSecs] = useState(0);
  const [result, setResult] = useState<{ url: string; file: File } | null>(null);
  const [info, setInfo] = useState('');

  const stopStream = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };

  useEffect(() => {
    let cancelled = false;
    setState('starting');
    stopStream();
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
        audio: true,
      })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        const st = s.getVideoTracks()[0]?.getSettings();
        setInfo(st?.width && st?.height ? `${Math.max(st.width, st.height)}×${Math.min(st.width, st.height)}${st.frameRate ? ` · ${Math.round(st.frameRate)} kl./s` : ''}` : '');
        if (live.current) {
          live.current.srcObject = s;
          void live.current.play().catch(() => undefined);
        }
        setState('ready');
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setErr(e.name === 'NotAllowedError' ? 'Brak zgody na kamerę — zezwól w ustawieniach przeglądarki albo wybierz film z galerii.' : `Nie udało się włączyć kamery (${e.message}).`);
        setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [facing]);

  useEffect(
    () => () => {
      rec.current?.state === 'recording' && rec.current.stop();
      stopStream();
      if (result) URL.revokeObjectURL(result.url);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (state !== 'rec') return;
    const t0 = Date.now();
    const id = window.setInterval(() => setSecs(Math.floor((Date.now() - t0) / 1000)), 250);
    return () => window.clearInterval(id);
  }, [state]);

  const start = () => {
    if (!stream.current) return;
    const mimeType = pickMime();
    chunks.current = [];
    size.current = 0;
    const r = new MediaRecorder(stream.current, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: BITRATE, audioBitsPerSecond: 128_000 });
    r.ondataavailable = (e) => {
      if (!e.data.size) return;
      chunks.current.push(e.data);
      size.current += e.data.size;
      if (size.current > LIMIT && r.state === 'recording') r.stop(); // przed limitem pliku
    };
    r.onstop = () => {
      const type = (r.mimeType || mimeType || 'video/mp4').split(';')[0];
      const blob = new Blob(chunks.current, { type });
      const file = new File([blob], `seria-${Date.now()}.${type.includes('webm') ? 'webm' : 'mp4'}`, { type });
      setResult({ url: URL.createObjectURL(blob), file });
      setState('done');
    };
    r.start(1000);
    rec.current = r;
    setSecs(0);
    setState('rec');
  };

  const again = () => {
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
    setState('ready');
  };
  // podgląd z kamery po każdym powrocie do gotowości (np. „Nagraj ponownie”)
  useEffect(() => {
    if (state === 'ready' && live.current && stream.current && live.current.srcObject !== stream.current) {
      live.current.srcObject = stream.current;
      void live.current.play().catch(() => undefined);
    }
  }, [state]);

  return (
    <Sheet label={`Nagraj: ${title}`} onClose={onClose}>
      <div className="between">
        <h3>{title}</h3>
        <button className="icon-btn" aria-label="Zamknij" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      {state === 'error' ? (
        <p className="muted">{err}</p>
      ) : (
        <div className="rec-stage">
          {result ? (
            <video className="set-video" src={result.url} controls playsInline autoPlay />
          ) : (
            <video ref={live} className={`set-video ${facing === 'user' ? 'mirror' : ''}`} playsInline muted autoPlay />
          )}
          {state === 'rec' && (
            <span className="rec-badge">
              ● {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
            </span>
          )}
        </div>
      )}
      {state !== 'error' && (
        <p className="muted small center">
          {state === 'done' && result ? `Nagranie: ${(result.file.size / 1024 / 1024).toFixed(1)} MB — sprawdź i użyj.` : `Wysoka jakość${info ? ` (${info})` : ''} · do ok. ${Math.round((LIMIT * 8) / BITRATE)} s`}
        </p>
      )}
      <div className="rec-actions">
        {state === 'ready' && (
          <>
            <button className="btn btn-ghost" onClick={() => setFacing(facing === 'environment' ? 'user' : 'environment')}>
              ⟲ Kamera
            </button>
            <button className="rec-btn" aria-label="Nagrywaj" onClick={start} />
          </>
        )}
        {state === 'rec' && <button className="rec-btn on" aria-label="Zatrzymaj" onClick={() => rec.current?.stop()} />}
        {state === 'done' && result && (
          <>
            <button className="btn btn-ghost" onClick={again}>
              Nagraj ponownie
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                stopStream();
                onDone(result.file);
              }}
            >
              Użyj nagrania
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}
