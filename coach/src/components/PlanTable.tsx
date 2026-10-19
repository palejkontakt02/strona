import { useState } from 'react';
import type { Plan, PlanExercise } from '../domain';
import { exerciseLabels, expandSets, mergeGroups } from '../lib/plan';
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

/** Serie ćwiczenia po kolei (każda osobno): numer („R”, „1”, „2”…) i opis „8 × 60 kg @7”. */
export function setCells(e: PlanExercise): { no: string; text: string; warm: boolean }[] {
  if (e.cardio ?? cardioByName(e.name)) return exerciseLines(e).map((l, i) => ({ no: l.warm ? '' : String(i + 1), ...l }));
  const timed = isTimed(e);
  const side = (e.perSide ?? perSideByName(e.name)) ? '/str.' : '';
  let n = 0;
  return expandSets(e.groups).map((g) => {
    const warm = g.type === 'Rozgrzewka';
    if (!warm) n++;
    const reps = timed && secOf(g.reps) != null ? fmtSec(secOf(g.reps)!) : g.reps.trim() || '?';
    const kind = !warm && g.type !== 'Robocze' && PREFIX[g.type] ? ` (${PREFIX[g.type]})` : '';
    return { no: warm ? 'R' : String(n), warm, text: `${reps}${side}${g.load.trim() ? ` × ${kg(g.load)}` : ''}${g.rpe ? ` @${g.rpe}` : ''}${kind}` };
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
  // rozgrzewki schowane — widać je po rozwinięciu (osobno dla każdego treningu)
  const [warmOpen, setWarmOpen] = useState<Set<string>>(new Set());
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
        const hasWarm = cols.some((c) => c.k!.exercises.some((e) => !(e.cardio ?? cardioByName(e.name)) && e.groups.some((g) => g.type === 'Rozgrzewka')));
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
                      <th className="ptab-no">Seria</th>
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
                    {rows.map((r) => {
                      // serie z każdego tygodnia wyrównane po numerze: najpierw rozgrzewki (R), potem serie robocze 1, 2, 3…
                      const per = cols.map(({ k }) => {
                        const e = k!.exercises.find((x) => x.name === r.name);
                        return e ? setCells(e) : null;
                      });
                      const isCardio = r.first.cardio ?? cardioByName(r.name);
                      const keyed = per.map((cells) => {
                        if (!cells) return null;
                        // bieg: odcinki po kolei (rozgrzewka, odcinki, schłodzenie)
                        if (isCardio) return new Map(cells.map((c, idx) => [`x${idx + 1}`, c] as const));
                        let w = 0;
                        return new Map(cells.map((c) => [c.warm && c.no !== '' ? `R${++w}` : c.no || `x${++w}`, c] as const));
                      });
                      const warmN = Math.max(0, ...keyed.map((m) => (m ? [...m.keys()].filter((k) => k.startsWith('R')).length : 0)));
                      const workN = Math.max(0, ...keyed.map((m) => (m ? [...m.keys()].filter((k) => /^\d+$/.test(k)).length : 0)));
                      const otherN = Math.max(0, ...keyed.map((m) => (m ? [...m.keys()].filter((k) => k.startsWith('x')).length : 0)));
                      const keys = [...Array.from({ length: showWarm ? warmN : 0 }, (_, i) => `R${i + 1}`), ...Array.from({ length: workN }, (_, i) => String(i + 1)), ...Array.from({ length: otherN }, (_, i) => `x${i + 1}`)];
                      const n = Math.max(1, keys.length);
                      const rowNo = (key: string | undefined) => (!key ? '' : key.startsWith('R') ? (warmN > 1 ? key : 'R') : key.startsWith('x') ? (isCardio ? key.slice(1) : '') : key);
                      const linked = /\d$/.test(r.label) && !r.label.endsWith('1');
                      return Array.from({ length: n }, (_, i) => (
                        <tr key={`${r.name}-${i}`} className={`${linked ? 'ptab-linked' : ''} ${i === 0 ? 'ptab-first' : ''}`}>
                          {i === 0 && (
                            <th scope="row" className="ptab-ex" rowSpan={n}>
                              <span className="ex-label">{r.label}</span> {r.name}
                              {r.first.notes && <span className="ptab-note">{r.first.notes}</span>}
                            </th>
                          )}
                          <td className="ptab-no">{rowNo(keys[i])}</td>
                          {i === 0 && (
                            <td className="ptab-rest" rowSpan={n}>
                              {r.first.rest || '—'}
                            </td>
                          )}
                          {keyed.map((cells, ci) => {
                            const c = cells?.get(keys[i]);
                            return (
                              <td key={cols[ci].week.id} className={`${cols[ci].k!.id === nextId ? 'is-next' : ''} ${c?.warm ? 'ptab-warm' : ''}`}>
                                {cells == null ? (i === 0 ? <span className="muted">—</span> : null) : c ? c.text : null}
                              </td>
                            );
                          })}
                        </tr>
                      ));
                    })}
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
