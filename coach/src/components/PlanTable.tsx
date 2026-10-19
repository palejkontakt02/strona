import { useState } from 'react';
import type { Plan } from '../domain';
import { planGrid } from '../lib/planGrid';
import { Tag } from './ui';

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
      {slots.map(({ name: slot, cols, rows, hasWarm }) => {
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
            {rows.length === 0 ? (
              <p className="muted small">Brak ćwiczeń.</p>
            ) : (
              <div className="ptab-scroll">
                <table className="ptab-table">
                  <thead>
                    <tr>
                      <th className="ptab-ex">Ćwiczenie</th>
                      <th className="ptab-no">Seria</th>
                      <th className="ptab-rest">Przerwa</th>
                      {cols.map(({ week, k }) => (
                        <th key={week.id} className={`${k.id === nextId ? 'is-next' : ''} ${done.has(k.id) && k.id !== nextId ? 'is-done' : ''}`}>
                          {week.name}
                          {k.id === nextId ? ' ▶' : done.has(k.id) ? ' ✓' : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) =>
                      r.lines.map((line, i) => (
                        <tr key={`${r.name}-${i}`} className={`${r.linked ? 'ptab-linked' : ''} ${i === 0 ? 'ptab-first' : ''}`}>
                          {i === 0 && (
                            <th scope="row" className="ptab-ex" rowSpan={r.lines.length}>
                              <span className="ex-label">{r.label}</span> {r.name}
                              {r.notes && <span className="ptab-note">{r.notes}</span>}
                            </th>
                          )}
                          <td className="ptab-no">{line.no}</td>
                          {i === 0 && (
                            <td className="ptab-rest" rowSpan={r.lines.length}>
                              {r.rest || '—'}
                            </td>
                          )}
                          {line.cells.map((c, ci) => (
                            <td key={cols[ci].week.id} className={`${cols[ci].k.id === nextId ? 'is-next' : ''} ${c && c !== 'none' && c.warm ? 'ptab-warm' : ''}`}>
                              {c === 'none' ? <span className="muted">—</span> : c ? c.text : null}
                            </td>
                          ))}
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
