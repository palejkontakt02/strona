import type { PlanWorkout, RunProfile } from '../domain';
import { cardioByName } from '../lib/run';
import { planRunTotals } from '../lib/running';
import { parseRest, repsN, secOf } from '../lib/parse';

/** Czas pracy jednej serii siłowej (s), gdy plan nie podaje czasu. */
const SET_WORK_SEC = 40;
/** Przerwa, gdy plan jej nie podaje (s). */
const DEFAULT_REST_SEC = 90;
/** Zmiana ćwiczenia: ustawienie sprzętu, przejście (s). */
const SWITCH_SEC = 60;

/**
 * Szacowany czas jednostki w minutach (zaokrąglony do 5) na ekran Dziś:
 * ostatni zapisany czas tej jednostki, a bez niego z serii i przerw z planu (bieg: z odcinków).
 * Null, gdy jednostka nie ma ćwiczeń.
 */
export function workoutMinutes(
  k: Pick<PlanWorkout, 'id' | 'exercises'>,
  sessions: { workoutId?: string; duration?: number; date: string }[],
  run?: RunProfile,
): number | null {
  const last = sessions.filter((s) => s.workoutId === k.id && s.duration && s.duration > 0).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (last?.duration) return round5(last.duration);
  const ex = k.exercises.filter((e) => e.name.trim());
  if (!ex.length) return null;
  let sec = 0;
  for (const e of ex) {
    if (e.cardio ?? cardioByName(e.name)) {
      sec += planRunTotals(e.groups, run).min * 60;
      continue;
    }
    for (const g of e.groups) {
      const n = Math.max(1, Math.round(repsN(g.sets) ?? 1));
      const t = secOf(g.reps);
      const work = t != null && /[:'s]|min/i.test(g.reps) ? t : SET_WORK_SEC;
      const rest = parseRest(g.rest ?? e.rest) || DEFAULT_REST_SEC;
      sec += n * work + Math.max(0, n - 1) * rest;
    }
    sec += SWITCH_SEC;
  }
  return sec > 0 ? round5(sec / 60) : null;
}

const round5 = (m: number) => Math.max(5, Math.round(m / 5) * 5);
