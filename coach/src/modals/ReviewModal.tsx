import { useEffect, useRef, useState } from 'react';
import { Icon, Modal } from '../components/ui';
import { RefThread } from '../components/RefComment';
import { clientById, isSolo } from '../data/ops';
import { PainMap } from '../components/PainMap';
import { isAsym, painTextClass, repsLabel, spotsText } from '../lib/sessionBadges';
import { put } from '../data/db';
import { useStore } from '../data/store';
import { sessionVideos, videoUrl } from '../data/videos';
import { fmtDay, fmtLong, fnum } from '../format';
import { setText } from '../athlete/History';
import { num, repsN } from '../lib/parse';
import { useNav } from '../nav';
import type { SessionExercise, SetLog } from '../domain';

/** Powtórzenia serii do tabeli jednolicie z listą i nagraniami: „5”, „5/5 L/P”, „8/str.”, „1:30/str.”, „15/10 s L/P”. */
const repsCell = (x: SetLog, perSide?: boolean) => (x.reps == null ? '—' : repsLabel(x, perSide));

/** Serie ćwiczenia: pojedynczo (zapis seria po serii) albo z podsumowania („4 × 5 × 100”). */
function ExSets({ e, onVideo }: { e: SessionExercise; /** Kamera przy serii: pokaż to nagranie w odtwarzaczu. */ onVideo?: (video: string) => void }) {
  const log = e.setsLog ?? [];
  if (!log.length) {
    const n = repsN(e.sets);
    const load = num(e.load);
    if (!n && !e.reps && load == null) return <p className="muted small">Bez zapisanych serii.</p>;
    return (
      <p className="rv-sum">
        {n ? `${n} × ` : ''}
        {e.reps || '?'}{/[a-ząćęłńóśźż]/i.test(e.reps ?? '') ? '' : ' powt.'}{load != null ? ` · ${fnum(load)} kg` : ''}
        {e.rpe ? ` · RPE ${e.rpe.replace('.', ',')}` : ''}
      </p>
    );
  }
  if (e.cardio)
    return (
      <ol className="rv-cardio">
        {log.map((x, i) => (
          <li key={i} className={x.warmup ? 'muted' : undefined}>
            {setText(x, e.perSide, true)}
            {x.rpe != null && ` · RPE ${fnum(x.rpe)}`}
          </li>
        ))}
      </ol>
    );
  let n = 0;
  // ćwiczenie bez ciężaru (wszędzie „—”) — bez kolumny kg
  const hasKg = log.some((x) => x.load != null);
  return (
    <table className="rv-sets">
      <thead>
        <tr>
          <th scope="col">Seria</th>
          <th scope="col">{e.timed || log.some((x) => x.unit) ? 'Czas / powt.' : 'Powt.'}</th>
          {hasKg && <th scope="col">kg</th>}
          <th scope="col">RPE</th>
        </tr>
      </thead>
      <tbody>
        {log.map((x, i) => {
          if (!x.warmup) n++;
          return (
            <tr key={i} className={x.warmup ? 'rv-warm' : undefined}>
              <td>{x.warmup ? 'rozgrz.' : x.label && x.label !== 'Robocze' ? `${n} · ${x.label.toLowerCase()}` : n}</td>
              <td className={`num${isAsym(x) ? ' rv-asym' : ''}`} title={isAsym(x) ? 'Różnica między stronami' : undefined}>
                {repsCell(x, e.perSide)}
              </td>
              {hasKg && <td className="num">{x.load != null ? fnum(x.load) : '—'}</td>}
              <td className="num">
                {x.rpe != null ? fnum(x.rpe) : '—'}
                {x.video &&
                  (onVideo ? (
                    <button type="button" className="rv-cam" onClick={() => onVideo(x.video!)} aria-label={`Odtwórz nagranie: seria ${x.warmup ? 'rozgrzewkowa' : n}`}>
                      <Icon name="cam" size={15} />
                    </button>
                  ) : (
                    <Icon name="cam" size={13} />
                  ))}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Trening oczami trenera: ćwiczenia z seriami (wyróżnione to, którego dotyczy komentarz), komentarze podopiecznego
 * z odpowiedzią, nagrania serii (poprzednie/następne, zwolnione tempo) i komentarz trenera widoczny w aplikacji
 * podopiecznego. Przy nagraniach zapis = „obejrzane”.
 */
export function ReviewModal({ m }: { m: { sessionId: string; exIndex?: number } }) {
  const { db, apply } = useStore();
  const { closeModal, openModal } = useNav();
  const s = db.sessions.find((x) => x.id === m.sessionId);
  const vids = s ? sessionVideos(s) : [];
  // nagrania ćwiczenia z komentarza na początek
  const hlName = s && m.exIndex != null ? s.exercises[m.exIndex]?.name : undefined;
  const [idx, setIdx] = useState(() => Math.max(0, hlName ? vids.findIndex((v) => v.exercise === hlName) : 0));
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [rate, setRate] = useState(1);
  const [note, setNote] = useState(s?.coachNote ?? '');
  const player = useRef<HTMLVideoElement>(null);
  const playerBox = useRef<HTMLDivElement>(null);
  const hlRef = useRef<HTMLDivElement>(null);
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
  // ćwiczenie z komentarza widoczne od razu
  useEffect(() => {
    hlRef.current?.scrollIntoView?.({ block: 'center' });
  }, []);

  if (!s) return null;
  const client = clientById(db, s.clientId);
  const hasVids = vids.length > 0;
  const solo = isSolo(db, s);
  const stop = s.stoppedForPain;
  const stopSpots = stop?.spots?.length ? stop.spots : s.painMap;
  // kamera przy serii: to nagranie w odtwarzaczu na górze
  const showVideo = (video: string) => {
    const i = vids.findIndex((v) => v.video === video);
    if (i >= 0) setIdx(i);
    playerBox.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    if (i === idx) void player.current?.play?.().catch(() => {});
  };
  const save = async () => {
    const coachNote = note.trim() || undefined;
    // bez nagrań nie ma czego „obejrzeć” — zapisujemy tylko komentarz (o ile się zmienił)
    if (!hasVids) {
      if (coachNote === s.coachNote) return closeModal();
      if (await apply([put('sessions', { ...s, coachNote })], coachNote ? 'Komentarz zapisany — podopieczny zobaczy go przy treningu.' : 'Komentarz usunięty.')) closeModal();
      return;
    }
    if (await apply([put('sessions', { ...s, reviewedAt: new Date().toISOString(), coachNote })], coachNote ? 'Obejrzane — komentarz widzi podopieczny.' : 'Oznaczono jako obejrzane.')) closeModal();
  };

  return (
    <Modal
      title={client?.name ?? 'Trening'}
      onClose={closeModal}
      onSubmit={() => void save()}
      submitLabel={hasVids && !s.reviewedAt ? 'Obejrzane ✓' : 'Zapisz komentarz'}
      wide
      extraActions={
        <button type="button" className="btn btn-ghost" onClick={() => openModal({ kind: 'session', session: s })}>
          <Icon name="edit" size={16} /> Edytuj trening
        </button>
      }
    >
      <div className="rv-head">
        <span className="eyebrow first-cap">{fmtLong(s.date)}</span>
        <h2>{s.workoutName || 'Trening'}</h2>
        <p className="rv-stats muted small">
          {[
            s.duration != null && `${s.duration} min`,
            s.srpe != null && `sRPE ${fnum(s.srpe)}`,
            solo ? 'samodzielnie' : 'z trenerem',
          ]
            .filter(Boolean)
            .join(' · ')}
          {s.pain != null && s.pain > 0 && !stop && (
            <>
              {' · '}
              <span className={painTextClass(s.pain) || undefined}>ból {s.pain}/10{s.painMap?.length ? ` (${spotsText(s.painMap)})` : ''}</span>
            </>
          )}
        </p>
      </div>
      {stop && (
        <div className="sb-stop-box rv-stop" role="note">
          <b>Trening przerwany z powodu bólu</b>
          <span>
            ból <b>{stop.level}/10</b>
            {stop.exName ? ` · przy ćwiczeniu: ${stop.exName}` : ''}
          </span>
          {stopSpots?.length ? (
            <>
              <span>gdzie: {spotsText(stopSpots)}</span>
              <PainMap spots={stopSpots} readOnly />
            </>
          ) : (
            <span className="muted small">Bez zaznaczonych miejsc.</span>
          )}
        </div>
      )}
      {hasVids && (
        <div className="review-player" ref={playerBox}>
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
      )}
      {s.notes && (
        <div className="review-note">
          <span className="eyebrow">Notatka podopiecznego</span>
          <p>{s.notes}</p>
        </div>
      )}
      <RefThread clientId={s.clientId} sessionId={s.id} />
      {s.exercises.length > 0 ? (
        <div className="rv-exs">
          {s.exercises.map((e, i) => {
            const hl = i === m.exIndex;
            return (
              <div key={i} ref={hl ? hlRef : undefined} className={`rv-ex${hl ? ' rv-hl' : ''}`}>
                <div className="rv-ex-name">
                  <b>
                    {e.label && <span className="ex-label">{e.label}</span>} {e.name}
                  </b>
                  {hl && <span className="rv-hl-tag">Komentarz dotyczy tego ćwiczenia</span>}
                  {stop && stop.exIndex === i && <span className="sb-stop small">tu przerwano — ból {stop.level}/10</span>}
                </div>
                <ExSets e={e} onVideo={hasVids ? showVideo : undefined} />
                {e.notes && <p className="muted small">{e.notes}</p>}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted">Trening bez zapisanych ćwiczeń.</p>
      )}
      <label className="field">
        <span>Komentarz dla podopiecznego (zobaczy go przy tym treningu)</span>
        <textarea className="input" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Np. seria 2: kolana uciekają do środka — w następnym tygodniu 5 kg mniej i pauza na dole." />
      </label>
      {hasVids && s.reviewedAt && <p className="muted small">Obejrzane {fmtDay(s.reviewedAt.slice(0, 10))}.</p>}
    </Modal>
  );
}
