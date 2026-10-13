import type { Plan, PlanWeek, PlanWorkout, SetGroup, TrainingSession } from '../domain';
import { repsN } from './parse';

const groupKey = (g: SetGroup) => [g.type, g.reps, g.load, g.rpe, g.rest || ''].join('|');
const isRange = (s: string | undefined) => /[-–]/.test(String(s || ''));

/** Łączy kolejne identyczne wiersze (type, reps, load, rpe, rest) w jeden blok z liczbą serii. Zakresy („3–4”) nie są łączone. */
export function mergeGroups(groups: SetGroup[]): SetGroup[] {
  const out: SetGroup[] = [];
  for (const g of groups) {
    const last = out[out.length - 1];
    if (last && groupKey(last) === groupKey(g) && !isRange(g.sets) && !isRange(last.sets)) {
      last.sets = String((repsN(last.sets) || 1) + (repsN(g.sets) || 1));
    } else {
      out.push({ ...g, sets: String(g.sets || 1) });
    }
  }
  return out;
}

/** „3 serie + 1 rozgrz.” */
export function setCountLabel(groups: SetGroup[]): string {
  const w = groups.filter((g) => g.type === 'Rozgrzewka').length;
  const r = groups.length - w;
  const pl = (n: number) => (n === 1 ? 'seria' : n >= 2 && n <= 4 ? 'serie' : 'serii');
  return `${r} ${pl(r)}${w ? ` + ${w} rozgrz.` : ''}`;
}

export interface PlanStep {
  week: PlanWeek;
  workout: PlanWorkout;
  index: number;
}

/** Jednostki planu w kolejności tydzień → jednostka. */
export function planSequence(plan: Plan): PlanStep[] {
  const out: PlanStep[] = [];
  for (const week of plan.weeks) for (const workout of week.workouts) out.push({ week, workout, index: out.length });
  return out;
}

/** Plan zawodnika: aktywny, w przeciwnym razie najnowszy. */
export function currentPlan(plans: Plan[]): Plan | null {
  return (
    plans.find((p) => p.active) ||
    [...plans].sort((a, b) => (b.updatedAt || b.startDate || '').localeCompare(a.updatedAt || a.startDate || ''))[0] ||
    null
  );
}

/**
 * Następny trening: pierwsza jednostka planu, której nie ma jeszcze w sesjach z tego planu.
 * Gdy wszystkie zrobione — ostatnia.
 */
export function nextWorkout(plan: Plan | null, sessions: TrainingSession[]): (PlanStep & { total: number }) | null {
  if (!plan) return null;
  const seq = planSequence(plan);
  if (seq.length === 0) return null;
  const done = new Set(sessions.filter((s) => s.planId === plan.id && s.workoutId).map((s) => s.workoutId));
  const nx = seq.find((x) => !done.has(x.workout.id)) || seq[seq.length - 1];
  return { ...nx, total: seq.length };
}

/** Podsumowanie ćwiczenia z serii (zgodność z widokami listy): liczba serii roboczych i parametry pierwszej. */
export function exerciseSummary(groups: SetGroup[]): { sets: string; reps: string; rpe: string; load: string } {
  const work = groups.filter((g) => g.type !== 'Rozgrzewka');
  const top = work[0];
  return {
    sets: String(work.reduce((a, g) => a + (repsN(g.sets) || 1), 0)),
    reps: top?.reps || '',
    rpe: top?.rpe || '',
    load: top && top.load && !/%/.test(top.load) && !Number.isNaN(parseFloat(top.load)) ? top.load : '',
  };
}
