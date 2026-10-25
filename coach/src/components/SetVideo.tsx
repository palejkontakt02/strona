import { useEffect, useRef, useState } from 'react';
import { useStore } from '../data/store';
import { deleteSetVideo, saveSetVideo, VIDEO_MAX_MB, videoProblem, videoUrl } from '../data/videos';
import { Sheet } from './Sheet';
import { canRecordInApp, VideoRecorder } from './VideoRecorder';
import { shrinkVideo } from './videoShrink';
import { Icon } from './ui';

/**
 * Film gotowy do zapisu: za duży z galerii — przekodowany w telefonie do limitu (postęp w `onProgress`, null = koniec);
 * nie da się — błąd z komunikatem do pokazania.
 */
export async function fitVideoFile(file: File, onProgress: (p: number | null) => void): Promise<File> {
  if (!videoProblem(file, true) && file.size > VIDEO_MAX_MB * 1024 * 1024 && canRecordInApp()) {
    onProgress(0);
    try {
      const small = await shrinkVideo(file, (VIDEO_MAX_MB - 2) * 1024 * 1024, (p) => onProgress(p));
      if (small && small.size <= VIDEO_MAX_MB * 1024 * 1024) file = small;
    } catch (e) {
      throw new Error(`Nie udało się zmniejszyć nagrania: ${(e as Error).message}.`);
    } finally {
      onProgress(null);
    }
  }
  const problem = videoProblem(file);
  if (problem) throw new Error(problem);
  return file;
}

/** Postęp przekodowania za dużego filmu. */
export function ShrinkSheet({ progress }: { progress: number }) {
  return (
    <Sheet label="Przygotowanie nagrania" onClose={() => undefined}>
      <h3>Przygotowuję nagranie…</h3>
      <p className="muted small">Film jest większy niż {VIDEO_MAX_MB} MB — zapisuję go w wysokiej jakości w limicie. Nie zamykaj aplikacji.</p>
      <div className="progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      <p className="center">{Math.round(progress * 100)}%</p>
    </Sheet>
  );
}

/** Odtwarzacz nagrania serii (arkusz od dołu). `onRemove` — przycisk usunięcia nagrania. */
export function VideoViewer({ video, title, onClose, onRemove, onReplace }: { video: string; title: string; onClose: () => void; onRemove?: () => void; onReplace?: () => void }) {
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
        <video className="set-video" src={src} controls playsInline autoPlay muted onError={() => setErr('ten plik nie daje się odtworzyć — nagraj ponownie')} />
      ) : (
        <p className="muted">Wczytywanie nagrania…</p>
      )}
      {(onReplace || onRemove) && (
        <div className="actions">
          {onReplace && (
            <button className="btn btn-secondary btn-sm" onClick={onReplace}>
              <Icon name="cam" size={16} /> Nagraj ponownie
            </button>
          )}
          {onRemove && (
            <button className="btn btn-ghost btn-sm" onClick={onRemove}>
              <Icon name="trash" size={16} /> Usuń nagranie
            </button>
          )}
        </div>
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
  const [choose, setChoose] = useState(false);
  const [recording, setRecording] = useState(false);
  // bez nagrania: wybór „nagraj w aplikacji” (pełna jakość) albo galeria; stara przeglądarka — od razu galeria
  const add = () => (canRecordInApp() ? setChoose(true) : input.current?.click());

  const [shrink, setShrink] = useState<number | null>(null);
  const pick = async (picked: File | undefined) => {
    if (!picked) return;
    let file: File;
    try {
      file = await fitVideoFile(picked, setShrink);
    } catch (e) {
      // długi komunikat — okno do przeczytania zamiast znikającego paska
      await ask((e as Error).message, { confirm: 'Rozumiem' });
      if (input.current) input.current.value = '';
      return;
    }
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
        onClick={() => (video ? setOpen(true) : add())}
      >
        {busy ? <span className="cam-spin" /> : <Icon name={video ? 'play' : 'cam'} size={18} />}
      </button>
      <input ref={input} type="file" accept="video/*,video/quicktime,video/mp4,.mov,.mp4,.m4v" hidden onChange={(e) => void pick(e.target.files?.[0])} />
      {shrink != null && <ShrinkSheet progress={shrink} />}
      {choose && (
        <Sheet label="Dodaj nagranie" onClose={() => setChoose(false)}>
          <h3>{title}</h3>
          <div className="video-choice">
            <button
              className="btn btn-primary btn-lg btn-block"
              onClick={() => {
                setChoose(false);
                setRecording(true);
              }}
            >
              <Icon name="cam" /> Nagraj w aplikacji — najlepsza jakość
            </button>
            <button
              className="btn btn-secondary btn-block"
              onClick={() => {
                setChoose(false);
                input.current?.click();
              }}
            >
              Wybierz z galerii / aparatu telefonu
            </button>
            <p className="muted small">
              Film z galerii: jeśli w okienku wyboru na iPhonie widzisz u góry <b>Opcje</b>, wybierz tam <b>Bieżący</b> / oryginał zamiast „Najbardziej zgodny” — telefon nie zmniejszy jakości. Za duży film aplikacja sama zapisze w wysokiej jakości w limicie {VIDEO_MAX_MB} MB.
            </p>
          </div>
        </Sheet>
      )}
      {recording && (
        <VideoRecorder
          title={title}
          onClose={() => setRecording(false)}
          onDone={(file) => {
            setRecording(false);
            void pick(file);
          }}
        />
      )}
      {open && video && (
        <VideoViewer
          video={video}
          title={title}
          onClose={() => setOpen(false)}
          onReplace={() => {
            setOpen(false);
            add();
          }}
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
        ▶ Film
      </button>
      {open && <VideoViewer video={video} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}
