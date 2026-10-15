import { VideoChip } from '../components/SetVideo';
import { needsReview, sessionVideos } from '../data/videos';
import { useState } from 'react';
import { Sheet } from '../components/Sheet';
import { LocationTag } from '../components/location';
import type { Appointment, TrainingSession } from '../domain';
import { isSolo, sessionsOf } from '../data/ops';
import { useStore } from '../data/store';
import { StartButtons } from './StartButtons';
import { fmtDay, fmtLong, fnum, nEx } from '../format';
import { todayISO } from '../lib/dates';
import { sessionLoad, tonnage } from '../lib/load';
import { num, repsN } from '../lib/parse';

/** Najbliższe zaplanowane wizyty klienta. */
/** Zaplanowane wizyty, które jeszcze się nie skończyły (dzisiejsze po czasie trwania już nie). */
export function upcomingVisits(appts: Appointment[], clientId: string, now = new Date()): Appointment[] {
  const today = todayISO();
  const mins = now.getHours() * 60 + now.getMinutes();
  const toMin = (t: string) => (parseInt(t.slice(0, 2), 10) || 0) * 60 + (parseInt(t.slice(3, 5), 10) || 0);
  return appts
    .filter((a) => a.clientId === clientId && a.status === 'planned' && (a.date > today || (a.date === today && toMin(a.time) + (a.duration || 60) > mins)))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

export function Upcoming({ clientId, limit = 4 }: { clientId: string; limit?: number }) {
  const { db } = useStore();
  const today = todayISO();
  const next = upcomingVisits(db.appointments, clientId);
  const [all, setAll] = useState(false);
  if (next.length === 0) return null;
  return (
    <section className="acard">
      <h3>Najbliższe treningi</h3>
      <ul className="rows">
        {(all ? next.slice(0, 8) : next.slice(0, limit)).map((a) => (
          <li key={a.id} className="row">
            <span className="row-time">{a.time}</span>
            <div className="grow">
              <span className="first-cap">{a.date === today ? 'Dziś' : fmtLong(a.date)}</span>
              <div>
                <LocationTag id={a.locationId} />
              </div>
            </div>
          </li>
        ))}
      </ul>
      {next.length > limit && (
        <button className="btn btn-ghost btn-sm" onClick={() => setAll(!all)}>
          {all ? 'Mniej' : `Więcej (${Math.min(8, next.length) - limit})`}
        </button>
      )}
    </section>
  );
}

/** Historia odbytych treningów ze szczegółami serii. */
interface HistoryActions {
  onEdit?: (s: TrainingSession) => void;
  /** Ten sam trening jeszcze raz (zawodnik). */
  onRepeat?: (s: TrainingSession) => void;
  /** Ten sam trening jeszcze raz, prowadzony przez trenera. */
  onTrainer?: (s: TrainingSession) => void;
  /** Oznacz jako niewykonany (usuwa zapis, jednostka wraca do listy). */
  onUndo?: (s: TrainingSession) => void;
  canUndo?: (s: TrainingSession) => boolean;
}

export function History({ clientId, onEdit, onRepeat, onTrainer, onUndo, canUndo, plain }: { clientId: string; /** Widok podopiecznego: bez skrótów trenerskich. */ plain?: boolean } & HistoryActions) {
  const { db } = useStore();
  const sessions = sessionsOf(db, clientId);
  const [limit, setLimit] = useState(8);
  const [open, setOpen] = useState<TrainingSession | null>(null);
  return (
    <section className="acard">
      <h3>Historia treningów</h3>
      {sessions.length === 0 ? (
        <p className="muted small">Tu pojawią się Twoje treningi — zarówno te z trenerem, jak i zrobione samodzielnie.</p>
      ) : (
        <ul className="hist-list">
          {sessions.slice(0, limit).map((s) => (
            <li key={s.id}>
              <button className="hist-item" onClick={() => setOpen(s)}>
                <span className="hist-date">
                  <b>{fmtDay(s.date)}</b>
                </span>
                <span className="grow">
                  <b>{s.workoutName || 'Trening'}</b>
                  <span className="muted small">
                    {nEx(s.exercises.length)}
                    {s.duration ? ` · ${s.duration} min` : ''}
                    {s.srpe != null ? (plain ? ` · wysiłek ${s.srpe}/10` : ` · RPE ${s.srpe}`) : ''}
                  </span>
                </span>
                <span className="wo-go">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {sessions.length > limit && (
        <button className="btn btn-ghost btn-block" onClick={() => setLimit(limit + 10)}>
          Pokaż starsze
        </button>
      )}
      {open && (
        <SessionSheet
          plain={plain}
          s={open}
          onClose={() => setOpen(null)}
          onEdit={onEdit && (!canUndo || canUndo(open)) ? () => (setOpen(null), onEdit(open)) : undefined}
          onRepeat={onRepeat && (() => (setOpen(null), onRepeat(open)))}
          onTrainer={onTrainer && (() => (setOpen(null), onTrainer(open)))}
          onUndo={onUndo && (!canUndo || canUndo(open)) ? () => (setOpen(null), onUndo(open)) : undefined}
        />
      )}
    </section>
  );
}

export function SessionSheet({
  plain,
  s,
  onClose,
  onEdit,
  onRepeat,
  onTrainer,
  onUndo,
  onReview,
}: {
  plain?: boolean;
  s: TrainingSession;
  onClose: () => void;
  onEdit?: () => void;
  onRepeat?: () => void;
  onTrainer?: () => void;
  onUndo?: () => void;
  /** Trener: przegląd nagrań i komentarz. */
  onReview?: () => void;
}) {
  const { db } = useStore();
  const ton = tonnage(s);
  const nVid = sessionVideos(s).length;
  const load = sessionLoad(s);
  return (
    <Sheet label={`Trening ${fmtDay(s.date)}`} onClose={onClose}>
        <div className="between">
          <div>
            <span className="eyebrow first-cap">{fmtLong(s.date)}</span>
            <h2>{s.workoutName || 'Trening'}</h2>
          </div>
          <button className="btn btn-primary btn-sm" onClick={onClose}>
            Zamknij
          </button>
        </div>
        {s.coachNote && (
          <div className="coach-note">
            <span className="eyebrow">Komentarz trenera</span>
            <p>{s.coachNote}</p>
          </div>
        )}
        {onReview && (
          <button className={`btn ${needsReview(s) ? 'btn-primary' : 'btn-secondary'} btn-block`} onClick={onReview}>
            {nVid ? `🎥 Przejrzyj nagrania (${nVid})` : '💬 Komentarz dla podopiecznego'}
            {s.reviewedAt ? ' · obejrzane ✓' : ''}
          </button>
        )}
        <div className="hist-stats">
          <span className="tag tag-neutral">{isSolo(db, s) ? 'samodzielnie' : 'z trenerem'}</span>
          {s.duration != null && (
            <span>
              <b>{s.duration}</b> min
            </span>
          )}
          {s.srpe != null && (
            <span>
              {plain ? 'wysiłek' : 'RPE'} <b>{s.srpe}</b>
              {plain && '/10'}
            </span>
          )}
          {ton > 0 && (
            <span title="Suma: ciężar × powtórzenia ze wszystkich serii">
              <b>{fnum(ton / 1000, 1)}</b> {plain ? 't podniesione łącznie' : 't tonażu'}
            </span>
          )}
          {load != null && !plain && (
            <span>
              <b>{fnum(load, 0)}</b> AU
            </span>
          )}
          <LocationTag id={s.locationId} />
        </div>
        <div className="hist-ex">
          {s.exercises.map((e, i) => {
            const work = (e.setsLog ?? []).filter((x) => !x.warmup);
            const warm = (e.setsLog ?? []).filter((x) => x.warmup);
            return (
              <div key={i} className="hist-ex-row">
                <div className="between">
                  <b>
                    {e.label && <span className="ex-label">{e.label}</span>} {e.name}
                  </b>
                </div>
                {work.length + warm.length > 0 ? (
                  <div className="hist-sets">
                    {warm.length > 0 && <span className="muted">rozgrzewka: {warm.map((x) => `${x.reps ?? '?'}×${fnum(x.load)}`).join(', ')}{warm.filter((x) => x.video).map((x, j) => <VideoChip key={j} video={x.video!} title={`${e.name} · rozgrzewka`} />)}</span>}
                    {work.map((x, j) => (
                      <span key={j} className="set-chip">
                        {x.reps ?? '?'} × {x.load != null ? `${fnum(x.load)} kg` : '—'}
                        {x.rpe != null && <i>{plain ? ` · trudność ${fnum(x.rpe)}/10` : ` @${fnum(x.rpe)}`}</i>}
                        {x.video && <VideoChip video={x.video} title={`${e.name} · seria ${j + 1}`} />}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="hist-sets">
                    {Array.from({ length: Math.min(20, Math.max(1, repsN(e.sets) ?? 1)) }, (_, j) => (
                      <span key={j} className="set-chip">
                        <i>{j + 1}.</i> {e.reps || '?'} × {num(e.load) != null ? `${fnum(num(e.load))} kg` : '—'}
                        {e.rpe && <i> @{e.rpe}</i>}
                      </span>
                    ))}
                  </div>
                )}
                {e.notes && <div className="muted small">{e.notes}</div>}
              </div>
            );
          })}
        </div>
        {s.notes && (
          <div className="hist-note">
            <span className="eyebrow">Notatka</span>
            <p>{s.notes}</p>
          </div>
        )}
        {onRepeat && s.exercises.length > 0 && <StartButtons onStart={onRepeat} onTrainer={onTrainer} label="Zrób ten trening jeszcze raz" />}
        <div className="sheet-actions">
          {onEdit && (
            <button className="btn btn-secondary" onClick={onEdit}>
              ✎ Popraw
            </button>
          )}
          {onUndo && (
            <button className="btn btn-ghost btn-danger-text" onClick={onUndo}>
              ✕ Oznacz jako niewykonany
            </button>
          )}
        </div>
      </Sheet>
  );
}
