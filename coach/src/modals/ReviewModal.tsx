import { useEffect, useRef, useState } from 'react';
import { Modal } from '../components/ui';
import { clientById } from '../data/ops';
import { put } from '../data/db';
import { useStore } from '../data/store';
import { sessionVideos, videoUrl } from '../data/videos';
import { fmtDay } from '../format';
import { useNav } from '../nav';

/**
 * Przegląd treningu przez trenera: nagrania serii po kolei (poprzednie/następne, zwolnione tempo),
 * notatka podopiecznego i komentarz trenera widoczny w aplikacji podopiecznego; zapis = „obejrzane”.
 */
export function ReviewModal({ m }: { m: { sessionId: string } }) {
  const { db, apply } = useStore();
  const { closeModal, openModal } = useNav();
  const s = db.sessions.find((x) => x.id === m.sessionId);
  const vids = s ? sessionVideos(s) : [];
  const [idx, setIdx] = useState(0);
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [rate, setRate] = useState(1);
  const [note, setNote] = useState(s?.coachNote ?? '');
  const player = useRef<HTMLVideoElement>(null);
  const cur = vids[idx];

  useEffect(() => {
    if (!cur) return;
    let url = '';
    let live = true;
    setSrc(null);
    setErr('');
    videoUrl(cur.video)
      .then((u) => {
        url = u;
        if (live) setSrc(u);
      })
      .catch((e: Error) => live && setErr(e.message));
    return () => {
      live = false;
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    };
  }, [cur?.video]);
  useEffect(() => {
    if (player.current) player.current.playbackRate = rate;
  }, [rate, src]);

  if (!s) return null;
  const client = clientById(db, s.clientId);
  const save = async () => {
    const coachNote = note.trim() || undefined;
    if (await apply([put('sessions', { ...s, reviewedAt: new Date().toISOString(), coachNote })], coachNote ? 'Obejrzane — komentarz widzi podopieczny.' : 'Oznaczono jako obejrzane.')) closeModal();
  };

  return (
    <Modal
      title={`${client?.name ?? ''} · ${s.workoutName || 'Trening'} · ${fmtDay(s.date)}`}
      onClose={closeModal}
      onSubmit={() => void save()}
      submitLabel={s.reviewedAt ? 'Zapisz komentarz' : 'Obejrzane ✓'}
      wide
      extraActions={
        <button type="button" className="btn btn-ghost" onClick={() => openModal({ kind: 'session', session: s })}>
          Edytuj trening
        </button>
      }
    >
      {vids.length > 0 ? (
        <div className="review-player">
          <div className="between">
            <b>
              {cur.exercise} <span className="muted">· {cur.label}</span>
            </b>
            <span className="muted small">
              {idx + 1} / {vids.length}
            </span>
          </div>
          {err ? (
            <p className="muted">Nie udało się wczytać nagrania: {err}</p>
          ) : src ? (
            <video ref={player} className="set-video" src={src} controls playsInline autoPlay muted onError={() => setErr('nie można odtworzyć tego pliku')} />
          ) : (
            <p className="muted">Wczytywanie nagrania…</p>
          )}
          <div className="review-ctrl row">
            <button type="button" className="btn btn-secondary btn-sm" disabled={idx === 0} onClick={() => setIdx(idx - 1)} aria-label="Poprzednie nagranie">
              ‹ <span className="hide-xs">Poprzednie</span>
            </button>
            <div className="seg" role="group" aria-label="Tempo odtwarzania">
              {[0.25, 0.5, 1].map((r) => (
                <button key={r} type="button" className={rate === r ? 'active' : ''} aria-pressed={rate === r} onClick={() => setRate(r)}>
                  {r === 1 ? '1×' : `${String(r).replace('.', ',')}×`}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-secondary btn-sm" disabled={idx >= vids.length - 1} onClick={() => setIdx(idx + 1)} aria-label="Następne nagranie">
              <span className="hide-xs">Następne</span> ›
            </button>
          </div>
        </div>
      ) : (
        <p className="muted">Ten trening nie ma nagrań.</p>
      )}
      {s.notes && (
        <div className="review-note">
          <span className="eyebrow">Notatka podopiecznego</span>
          <p>{s.notes}</p>
        </div>
      )}
      <label className="field">
        <span>Komentarz dla podopiecznego (zobaczy go przy tym treningu)</span>
        <textarea className="input" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Np. seria 2: kolana uciekają do środka — w następnym tygodniu 5 kg mniej i pauza na dole." />
      </label>
      {s.reviewedAt && <p className="muted small">Obejrzane {fmtDay(s.reviewedAt.slice(0, 10))}.</p>}
    </Modal>
  );
}
