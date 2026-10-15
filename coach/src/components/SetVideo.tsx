import { useEffect, useRef, useState } from 'react';
import { useStore } from '../data/store';
import { deleteSetVideo, saveSetVideo, videoProblem, videoUrl } from '../data/videos';
import { Sheet } from './Sheet';
import { Icon } from './ui';

/** Odtwarzacz nagrania serii (arkusz od dołu). `onRemove` — przycisk usunięcia nagrania. */
export function VideoViewer({ video, title, onClose, onRemove }: { video: string; title: string; onClose: () => void; onRemove?: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let url = '';
    let live = true;
    videoUrl(video)
      .then((u) => {
        url = u;
        if (live) setSrc(u);
      })
      .catch((e: Error) => live && setErr(e.message));
    return () => {
      live = false;
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    };
  }, [video]);
  return (
    <Sheet label={`Nagranie: ${title}`} onClose={onClose}>
      <div className="between">
        <h3>{title}</h3>
        <button className="icon-btn" aria-label="Zamknij" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      {err ? (
        <p className="muted">Nie udało się wczytać nagrania: {err}</p>
      ) : src ? (
        <video className="set-video" src={src} controls playsInline autoPlay muted />
      ) : (
        <p className="muted">Wczytywanie nagrania…</p>
      )}
      {onRemove && (
        <button className="btn btn-ghost btn-sm" onClick={onRemove}>
          <Icon name="trash" size={16} /> Usuń nagranie
        </button>
      )}
    </Sheet>
  );
}

/**
 * Ikona kamery przy serii: bez nagrania — wybór „Nagraj” / „Z galerii” (systemowe menu telefonu),
 * z nagraniem — odtworzenie, zmiana albo usunięcie.
 */
export function SetVideoButton({ clientId, video, title, onChange }: { clientId: string; video?: string; title: string; onChange: (video: string | undefined) => void }) {
  const { db, toast, ask } = useStore();
  // plik kasujemy tylko, gdy nie należy do zapisanego treningu (np. anulowane poprawki zostawiają stare nagranie)
  const dropFile = (ref: string) => {
    if (!db.sessions.some((s) => s.exercises.some((e) => e.setsLog?.some((x) => x.video === ref)))) void deleteSetVideo(ref);
  };
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    const problem = videoProblem(file);
    if (problem) return toast(problem);
    setBusy(true);
    try {
      const ref = await saveSetVideo(file, clientId);
      if (video) dropFile(video);
      onChange(ref);
      toast('Nagranie dodane do serii.');
    } catch (e) {
      toast(`Nie udało się zapisać nagrania (${(e as Error).message}). Spróbuj ponownie przy lepszym zasięgu.`);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <>
      <button
        type="button"
        className={`cam-btn ${video ? 'has' : ''}`}
        disabled={busy}
        aria-label={busy ? 'Wysyłanie nagrania' : video ? `Nagranie: ${title}` : `Dodaj nagranie: ${title}`}
        title={video ? 'Zobacz nagranie' : 'Nagraj lub dodaj film'}
        onClick={() => (video ? setOpen(true) : input.current?.click())}
      >
        {busy ? <span className="cam-spin" /> : <Icon name={video ? 'play' : 'cam'} size={18} />}
      </button>
      <input ref={input} type="file" accept="video/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
      {open && video && (
        <VideoViewer
          video={video}
          title={title}
          onClose={() => setOpen(false)}
          onRemove={async () => {
            if (!(await ask('Usunąć nagranie tej serii?', { confirm: 'Usuń nagranie' }))) return;
            setOpen(false);
            dropFile(video);
            onChange(undefined);
          }}
        />
      )}
    </>
  );
}

/** ▶ przy serii w historii — otwiera nagranie. */
export function VideoChip({ video, title }: { video: string; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="chip-vid"
        aria-label={`Zobacz nagranie: ${title}`}
        title="Zobacz nagranie"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        ▶
      </button>
      {open && <VideoViewer video={video} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}
