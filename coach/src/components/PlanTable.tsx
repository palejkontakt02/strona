import { useState } from 'react';
import type { Plan, PlanWorkout } from '../domain';
import { planGrid, type GridSlot } from '../lib/planGrid';
import { Tag } from './ui';
import { fmtWeekdayDate } from '../lib/planGrid';

/**
 * Plan jak arkusz: dla każdego treningu (A, B, …) tabela — wiersz na serię, kolumny to tygodnie.
 * Rozgrzewki schowane, widać je po rozwinięciu.
 */
export function PlanTable({
  plan,
  done,
  nextId,
  onLive,
  onAthlete,
}: {
  plan: Plan;
  done: Set<string>;
  nextId?: string;
  onLive?: (workoutId: string) => void;
  onAthlete?: (workoutId: string) => void;
}) {
  const [warmOpen, setWarmOpen] = useState<Set<string>>(new Set());
  const slots = planGrid(plan, (s) => warmOpen.has(s));
  return (
    <div className="ptab-wrap">
      {slots.map(({ name: slot, cols, hasWarm }) => {
        const next = cols.find((c) => c.k.id === nextId);
        const showWarm = warmOpen.has(slot);
        return (
          <section key={slot} className="ptab">
            <div className="ptab-head">
              <strong>{slot}</strong>
              {hasWarm && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-expanded={showWarm}
                  onClick={() => setWarmOpen((o) => (o.has(slot) ? new Set([...o].filter((x) => x !== slot)) : new Set([...o, slot])))}
                >
                  {showWarm ? 'Ukryj rozgrzewki' : 'Pokaż rozgrzewki'}
                </button>
              )}
              {next && (
                <span className="plan-workout-actions">
                  <Tag tone="accent">następny: {next.week.name}</Tag>
                  {onLive && (
                    <button className="btn btn-primary btn-sm" onClick={() => onLive(next.k.id)}>
                      ▶ Prowadź
                    </button>
                  )}
                  {onAthlete && (
                    <button className="btn btn-secondary btn-sm" onClick={() => onAthlete(next.k.id)}>
                      Jako zawodnik
                    </button>
                  )}
                </span>
              )}
            </div>
            <GridTable slot={slots.find((x) => x.name === slot)!} nextId={nextId} done={done} />
          </section>
        );
      })}
    </div>
  );
}

/** Tabela jednego treningu: wiersz na serię; każdy tydzień ma kolumny Powt. | Ciężar | RPE (bieg: odcinek | cel | RPE). */
function GridTable({ slot, nextId, done, noRest }: { slot: GridSlot; nextId?: string; done?: Set<string>; /** Przerwa pod nazwą ćwiczenia zamiast osobnej kolumny (węższa tabela). */ noRest?: boolean }) {
  const { cols, rows } = slot;
  if (rows.length === 0) return <p className="muted small">Brak ćwiczeń.</p>;
  // sam bieg: nagłówki biegowe (przy mieszanym treningu zostają siłowe)
  const run = rows.every((r) => r.cardio);
  const cls = (id: string) => `${id === nextId ? 'is-next' : ''} ${done?.has(id) && id !== nextId ? 'is-done' : ''}`;
  return (
    <div className="ptab-scroll">
      <table className="ptab-table">
        <thead>
          <tr>
            <th className="ptab-ex" rowSpan={2}>
              Ćwiczenie
            </th>
            <th className="ptab-no" rowSpan={2}>
              {noRest ? 'Nr' : 'Seria'}
            </th>
            {!noRest && (
              <th className="ptab-rest" rowSpan={2}>
                Przerwa
              </th>
            )}
            {cols.map(({ week, k, date }) => (
              <th key={week.id} colSpan={3} className={`ptab-week ${cls(k.id)}`}>
                {week.name}
                {k.id === nextId ? ' ▶' : done?.has(k.id) ? ' ✓' : ''}
                {date && <span className="ptab-date">{fmtWeekdayDate(date)}</span>}
              </th>
            ))}
          </tr>
          <tr>
            {cols.map(({ week, k }) => [
              <th key={`${week.id}-r`} className={`ptab-sub ptab-wk ${cls(k.id)}`}>
                {run ? 'Odcinek' : 'Powt.'}
              </th>,
              <th key={`${week.id}-l`} className={`ptab-sub ${cls(k.id)}`}>
                {run ? 'Cel' : 'Ciężar'}
              </th>,
              <th key={`${week.id}-p`} className={`ptab-sub ${cls(k.id)}`}>
                RPE
              </th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) =>
            r.lines.map((line, i) => (
              <tr key={`${r.name}-${i}`} className={`${r.linked ? 'ptab-linked' : ''} ${i === 0 ? 'ptab-first' : ''}`}>
                {i === 0 && (
                  <th scope="row" className="ptab-ex" rowSpan={r.lines.length}>
                    <span className="ex-label">{r.label}</span> {r.name}
                    {noRest && r.rest && <span className="ptab-note">przerwa {r.rest}</span>}
                    {r.notes && <span className="ptab-note">{r.notes}</span>}
                  </th>
                )}
                <td className="ptab-no">{line.no}</td>
                {i === 0 && !noRest && (
                  <td className="ptab-rest" rowSpan={r.lines.length}>
                    {r.rest || '—'}
                  </td>
                )}
                {line.cells.map((c, ci) => {
                  const id = cols[ci].k.id;
                  const base = `${id === nextId ? 'is-next' : ''} ${c && c !== 'none' && c.warm ? 'ptab-warm' : ''}`;
                  if (c === 'none')
                    return (
                      <td key={cols[ci].week.id} colSpan={3} className={`ptab-wk ${base} muted`}>
                        —
                      </td>
                    );
                  return [
                    <td key={`${cols[ci].week.id}-r`} className={`ptab-wk ${base}`}>
                      {c?.reps}
                    </td>,
                    <td key={`${cols[ci].week.id}-l`} className={`ptab-load ${base}`}>
                      {c?.load}
                    </td>,
                    <td key={`${cols[ci].week.id}-p`} className={`ptab-rpe ${base}`}>
                      {c?.rpe}
                    </td>,
                  ];
                })}
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Jeden trening (np. poza planem, podgląd) w tym samym układzie co plan; rozgrzewki po rozwinięciu. */
export function WorkoutTable({ workout, colName = 'Plan', done, doneName = 'Wykonano' }: { workout: PlanWorkout; colName?: string; /** Wykonanie (z zapisu) — druga kolumna obok planu. */ done?: PlanWorkout; doneName?: string }) {
  const [warm, setWarm] = useState(false);
  const name = workout.name || 'Trening';
  const weeks = [{ id: 'w1', name: colName, workouts: [{ ...workout, name }] }, ...(done ? [{ id: 'w2', name: doneName, workouts: [{ ...done, name }] }] : [])];
  const [slot] = planGrid({ id: 'w', clientId: '', name: '', active: false, weeks }, () => warm, !!done);
  if (!slot) return null;
  return (
    <div className={`ptab ptab-one ${done ? 'ptab-two' : ''}`}>
      {slot.hasWarm && (
        <button type="button" className="btn btn-ghost btn-sm ptab-warm-btn" aria-expanded={warm} onClick={() => setWarm(!warm)}>
          {warm ? 'Ukryj rozgrzewki' : 'Pokaż rozgrzewki'}
        </button>
      )}
      <GridTable slot={slot} noRest={!!done} />
    </div>
  );
}
