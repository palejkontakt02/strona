import { LOAD_PER_TEXT } from '../lib/run';
import { VideoChip } from '../components/SetVideo';
import { needsReview, sessionVideos } from '../data/videos';
import { useState } from 'react';
import { Sheet } from '../components/Sheet';
import { LocationTag } from '../components/location';
import type { Appointment, TrainingSession } from '../domain';
import { put } from '../data/db';
import { isSolo, sessionsOf } from '../data/ops';
import { useStore } from '../data/store';
import { StartButtons } from './StartButtons';
import { fmtDay, fmtLong, fnum, nEx } from '../format';
import { todayISO } from '../lib/dates';
import { sessionLoad, tonnage } from '../lib/load';
import { num, repsN } from '../lib/parse';
import { fmtDur, fmtKm, paceText, runTotals } from '../lib/running';

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
      <h3>Najbliższe wizyty z trenerem</h3>
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

/** Seria jako tekst: „8 × 45 kg”, „8/str. × 20 kg”, „30/25 s” (lewa/prawa), „45 s”. */
export function setText(x: { reps?: number; repsR?: number; unit?: 's' | 'min'; load?: number; dist?: number; hr?: number; label?: string }, perSide?: boolean, cardio?: boolean): string {
  // cardio / bieg: „schł. 3:05 · 800 m · 3:51/km · 172 ud./min”
  if (cardio || x.dist != null || x.hr != null)
    return [
      x.label === 'Schłodzenie' && 'schł.',
      x.label === 'Przerwa' && 'trucht',
      x.reps != null && fmtDur(x.reps),
      x.dist != null && fmtKm(x.dist),
      paceText(x.reps, x.dist),
      x.hr != null && `${fnum(x.hr)} ud./min`,
    ]
      .filter(Boolean)
      .join(' · ');
  // na czas od minuty: „1:30” zamiast „90 s”
  if (x.unit === 's' && x.reps != null && x.reps >= 60 && x.repsR == null) {
    const t = `${Math.floor(x.reps / 60)}:${String(x.reps % 60).padStart(2, '0')}${perSide ? '/str.' : ''}`;
    return x.load != null ? `${t} × ${fnum(x.load)} kg` : t;
  }
  const u = x.unit ? ` ${x.unit === 'min' ? 'min' : 's'}` : '';
  const side = perSide && x.repsR == null ? '/str.' : '';
  const r = x.reps == null ? '?' : x.repsR != null ? `${fnum(x.reps)}/${fnum(x.repsR)}` : fnum(x.reps);
  const main = `${r}${u}${side}${x.repsR != null ? ' (L/P)' : ''}`;
  return x.load != null ? `${main} × ${fnum(x.load)} kg` : x.unit ? main : `${main} × —`;
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
                    {s.pain ? ` · ból ${s.pain}/10` : ''}
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
  onAssign,
}: {
  plain?: boolean;
  s: TrainingSession;
  onClose: () => void;
  onEdit?: () => void;
  onRepeat?: () => void;
  onTrainer?: () => void;
  onUndo?: () => void;
  /** Trener: zadaj ten trening jeszcze raz (temu samemu albo innemu podopiecznemu). */
  onAssign?: (other: boolean) => void;
  /** Trener: przegląd nagrań i komentarz. */
  onReview?: () => void;
}) {
  const { db, apply } = useStore();
  // po przełączeniu „sam / z trenerem” pokazujemy aktualny zapis, nie migawkę z otwarcia
  const live = db.sessions.find((x) => x.id === s.id);
  s = live ?? s;
  const solo = isSolo(db, s);
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
          {/* usunięty w międzyczasie — bez przełącznika (zapis przywróciłby trening) */}
          {!live ? <span className="tag tag-neutral">{solo ? 'samodzielnie' : 'z trenerem'}</span> : <span className="seg seg-sm" role="radiogroup" aria-label="Z kim był trening">
            {([true, false] as const).map((v) => (
              <button
                key={String(v)}
                type="button"
                role="radio"
                aria-checked={solo === v}
                className={solo === v ? 'active' : ''}
                onClick={() => solo !== v && void apply([put('sessions', { ...s, solo: v })], v ? 'Oznaczono: samodzielnie.' : 'Oznaczono: z trenerem.')}
              >
                {v ? 'samodzielnie' : 'z trenerem'}
              </button>
            ))}
          </span>}
          {s.withIds?.length ? (
            <span>
              👥 w parze{(() => {
                // podopieczny w aplikacji nie widzi innych osób — wtedy samo „w parze”
                const names = s.withIds.map((id) => db.clients.find((c) => c.id === id)?.name.split(' ')[0]).filter(Boolean);
                return names.length ? `: ${names.join(', ')}` : '';
              })()}
            </span>
          ) : null}
          {(() => {
            // suma cardio / biegu w treningu (z tempem, gdy są czasy i dystanse)
            const t = runTotals(s);
            if (!t) return null;
            return (
              <span>
                {t.km ? '🏃' : '🫀'} {t.km ? <b>{fmtKm(t.km)}</b> : null}
                {t.km && t.min ? ' · ' : ''}
                {t.min ? <b>{fmtDur(t.min)}</b> : null}
                {t.pace ? ` · śr. ${t.pace}` : ''}
              </span>
            );
          })()}
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
          {s.pain != null && s.pain > 0 && (
            <span className={s.pain >= 5 ? 'warn-text' : undefined}>
              ból <b>{s.pain}</b>/10
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
                  {e.perSide && <span className="muted small">na każdą stronę</span>}
                  {e.loadPer && !e.cardio && <span className="muted small">kg: {LOAD_PER_TEXT[e.loadPer]}</span>}
                  {e.cardio && <span className="muted small">cardio</span>}
                </div>
                {work.length + warm.length > 0 ? (
                  <div className="hist-sets">
                    {warm.length > 0 && <span className="muted">rozgrzewka: {warm.map((x) => setText(x, e.perSide, e.cardio)).join(', ')}{warm.filter((x) => x.video).map((x, j) => <VideoChip key={j} video={x.video!} title={`${e.name} · rozgrzewka`} />)}</span>}
                    {work.map((x, j) => (
                      <span key={j} className="set-chip">
                        {setText(x, e.perSide, e.cardio)}
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
        {onAssign && s.exercises.length > 0 && (
          <div className="sheet-assign">
            <button className="btn btn-secondary" onClick={() => onAssign(false)}>
              ↻ Powtórz trening
            </button>
            <button className="btn btn-secondary" onClick={() => onAssign(true)}>
              ⧉ Kopiuj na innego
            </button>
          </div>
        )}
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
