import type { Checkin, ISODate, TrainingSession, Wellness } from '../domain';
import { addDays, todayISO } from './dates';

export const WELLNESS_ITEMS: [keyof Wellness, string][] = [
  ['sleep', 'Sen'],
  ['energy', 'Energia'],
  ['muscle', 'Mięśnie'],
  ['stress', 'Stres'],
  ['mood', 'Nastrój'],
];

function values(w: Wellness | undefined): number[] | null {
  const v = WELLNESS_ITEMS.map(([k]) => w?.[k]).filter((x): x is number => x != null);
  return v.length === WELLNESS_ITEMS.length ? v : null;
}

/** Wellness = suma 5 pozycji (5–25), tylko gdy wszystkie wypełnione. */
export function wellnessTotal(w: Wellness | undefined): number | null {
  const v = values(w);
  return v ? v.reduce((a, b) => a + b, 0) : null;
}

/** Gotowość = średnia 5 pozycji (1–5). */
export function readiness(w: Wellness | undefined): number | null {
  const v = values(w);
  return v ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Norma gotowości: średnia z 28 dni przed dziś (check-iny + wellness z sesji, bez duplikatu dnia). */
export function readinessNorm(
  checkins: Checkin[],
  sessions: TrainingSession[],
  today: ISODate = todayISO(),
): number | null {
  const from = addDays(today, -28);
  const vals: number[] = [];
  const days = new Set<string>();
  for (const c of checkins) {
    if (c.date >= from && c.date < today) {
      const a = readiness(c);
      if (a != null) {
        vals.push(a);
        days.add(c.date);
      }
    }
  }
  for (const s of sessions) {
    if (s.date >= from && s.date < today && !days.has(s.date)) {
      const a = readiness(s.wellness);
      if (a != null) vals.push(a);
    }
  }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
