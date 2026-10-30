import type { SetGroup } from '../domain';
import { resolveLoad, type ResolvedLoad } from './strength';

const key = (g: SetGroup) => [g.type, g.reps, g.load, g.rpe, g.rest || '', g.pace || ''].join('|');

/**
 * Ciężary serii planu po kolei — tak jak liczy je odtwarzacz (lib/run.ts): „75%” z maksa,
 * „-10%” od serii przed blokiem identycznych serii (back-off 3 × −10% = każda −10% od top setu, bez kumulacji),
 * w drop secie od poprzedniej serii, puste pole — dobór z RPE przy znanym maksie (e1RM).
 */
export function planLoads(groups: SetGroup[], max: number | null, round?: (v: number) => number, maxLabel?: string): ResolvedLoad[] {
  let prev: number | null = null;
  let ref: number | null = null;
  return groups.map((g, i) => {
    if (i === 0 || key(groups[i - 1]) !== key(g)) ref = prev;
    const pct = /^\s*\d+(?:[.,]\d+)?\s*%/.test(g.load || '');
    const r = pct ? resolveLoad(g.load, max, g.reps, g.rpe, null, { round, maxLabel }) : resolveLoad(g.load, max, g.reps, g.rpe, g.type === 'Drop set' ? prev : ref, { round, maxLabel });
    if (r.load != null) prev = r.load;
    return r;
  });
}
