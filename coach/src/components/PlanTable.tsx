import type { Plan, PlanExercise } from '../domain';
import { exerciseLabels, mergeGroups } from '../lib/plan';
import { cardioByName, isTimed, perSideByName } from '../lib/run';
import { fmtDur, fmtKm, parseDur, parseKm } from '../lib/running';
import { fmtSec, secOf } from '../lib/parse';
import { Tag } from './ui';

const kg = (load: string) => (/^\d+([.,]\d+)?$/.test(load.trim()) ? `${load.trim()} kg` : load.trim());
const PREFIX: Record<string, string> = { Rozgrzewka: 'R', 'Top set': 'Top', 'Back-off': 'B-off', 'Drop set': 'Drop', AMRAP: 'AMRAP', Schłodzenie: 'S', Przerwa: 'trucht' };

/** Linie komórki: jeden blok serii na linię („3 × 6–10 · 75% @8”, „R 1 × 5 · 60 kg”). */
export function exerciseLines(e: PlanExercise): { text: string; warm: boolean }[] {
  const cardio = e.cardio ?? cardioByName(e.name);
  const timed = isTimed(e);
  const side = !cardio && (e.perSide ?? perSideByName(e.name)) ? '/str.' : '';
  return mergeGroups(e.groups).map((g) => {
    const n = Number(g.sets) || 1;
    const pre = PREFIX[g.type] ? `${PREFIX[g.type]} ` : '';
    const warm = g.type === 'Rozgrzewka' || g.type === 'Schłodzenie' || g.type === 'Przerwa';
    if (cardio) {
      const d = parseDur(g.reps);
      const km = parseKm(g.load);
      const what = [km != null ? fmtKm(km) : g.load.trim(), d != null ? fmtDur(d) : g.reps.trim()].filter(Boolean).join(' / ') || '?';
      return { warm, text: `${pre}${n > 1 ? `${n} × ` : ''}${what}${g.pace ? ` · ${g.pace}` : ''}${g.rpe ? ` @${g.rpe}` : ''}${g.rest && n > 1 ? ` · p. ${g.rest}` : ''}` };
    }
    const reps = timed && secOf(g.reps) != null ? fmtSec(secOf(g.reps)!) : g.reps.trim() || '?';
    return { warm, text: `${pre}${n} × ${reps}${side}${g.load.trim() ? ` · ${kg(g.load)}` : ''}${g.rpe ? ` @${g.rpe}` : ''}` };
  });
}

/**
 * Plan jak arkusz: dla każdego treningu (A, B, …) tabela — wiersze to ćwiczenia, kolumny to tygodnie.
 * Progresję tydzień po tygodniu czyta się w jednym wierszu.
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
  // treningi łączone po nazwie (Trening A w każdym tygodniu), w kolejności z planu
  const slots: string[] = [];
  for (const w of plan.weeks) for (const k of w.workouts) if (!slots.includes(k.name)) slots.push(k.name);
  return (
    <div className="ptab-wrap">
      {slots.map((slot) => {
        const cols = plan.weeks.map((w) => ({ week: w, k: w.workouts.find((x) => x.name === slot) })).filter((c) => c.k);
        // ćwiczenia: kolejność z pierwszego tygodnia, nowe dopisane na końcu
        const rows: { name: string; label: string; first: PlanExercise }[] = [];
        for (const c of cols) {
          const labels = exerciseLabels(c.k!.exercises);
          c.k!.exercises.forEach((e, i) => {
            if (e.name.trim() && !rows.some((r) => r.name === e.name)) rows.push({ name: e.name, label: labels[i], first: e });
          });
        }
        const next = cols.find((c) => c.k!.id === nextId);
        return (
          <section key={slot} className="ptab">
            <div className="ptab-head">
              <strong>{slot}</strong>
              {next && (
                <span className="plan-workout-actions">
                  <Tag tone="accent">następny: {next.week.name}</Tag>
                  {onLive && (
                    <button className="btn btn-primary btn-sm" onClick={() => onLive(next.k!.id)}>
                      ▶ Prowadź
                    </button>
                  )}
                  {onAthlete && (
                    <button className="btn btn-secondary btn-sm" onClick={() => onAthlete(next.k!.id)}>
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
                      <th className="ptab-rest">Przerwa</th>
                      {cols.map(({ week, k }) => (
                        <th key={week.id} className={`${k!.id === nextId ? 'is-next' : ''} ${done.has(k!.id) && k!.id !== nextId ? 'is-done' : ''}`}>
                          {week.name}
                          {k!.id === nextId ? ' ▶' : done.has(k!.id) ? ' ✓' : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.name} className={/\d$/.test(r.label) && !r.label.endsWith('1') ? 'ptab-linked' : ''}>
                        <th scope="row" className="ptab-ex">
                          <span className="ex-label">{r.label}</span> {r.name}
                          {r.first.notes && <span className="ptab-note">{r.first.notes}</span>}
                        </th>
                        <td className="ptab-rest">{r.first.rest || '—'}</td>
                        {cols.map(({ week, k }) => {
                          const e = k!.exercises.find((x) => x.name === r.name);
                          return (
                            <td key={week.id} className={k!.id === nextId ? 'is-next' : ''}>
                              {e ? (
                                exerciseLines(e).map((l, i) => (
                                  <div key={i} className={l.warm ? 'ptab-warm' : ''}>
                                    {l.text}
                                  </div>
                                ))
                              ) : (
                                <span className="muted">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
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
