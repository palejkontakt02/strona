import type { TrainingSession } from '../domain';
import { numIn } from './parse';
import { parseDur, parseKm } from './running';

/** Szybki wpis biegu na Dziś („Biegłam / Biegłem”): km, czas, wysiłek, opcjonalnie tętno. Testy: podopieczny.test.ts. */

export interface QuickRunInput {
  km: string;
  time: string;
  effort: string;
  hr: string;
}

/** Czas biegu: „45:30” (mm:ss), „1:05:00” (h:mm:ss), „45” (minuty) → minuty. */
export const runMinutes = (v: string): number | null => parseDur(v.trim());

/** Pierwszy problem z formularza albo null. */
export function quickRunProblem(f: QuickRunInput): string | null {
  const km = parseKm(f.km.replace(/\s*km$/i, ''));
  if (km == null || km <= 0 || km > 300) return 'Wpisz dystans w km, np. 5 albo 7,5.';
  const min = runMinutes(f.time);
  if (min == null || min <= 0 || min > 48 * 60) return 'Wpisz czas: mm:ss (np. 32:15) albo h:mm:ss (np. 1:05:00).';
  const pace = min / km;
  if (pace < 2 || pace > 30) return 'Dystans i czas się nie zgadzają (tempo poza 2–30 min/km) — sprawdź, czy km nie są w metrach.';
  if (numIn(f.effort, 1, 10) == null) return 'Zaznacz wysiłek od 1 do 10.';
  if (f.hr.trim() && numIn(f.hr, 30, 240) == null) return 'Tętno średnie: od 30 do 240 (albo zostaw puste).';
  return null;
}

/** Trening samodzielny z jednym odcinkiem cardio — jak import z zegarka (czas w min w `reps`, km w `dist`). */
export function quickRunSession(f: QuickRunInput, o: { id: string; clientId: string; date: string; name: string }): TrainingSession {
  const km = parseKm(f.km.replace(/\s*km$/i, ''))!;
  const min = runMinutes(f.time)!;
  const hr = numIn(f.hr, 30, 240);
  const effort = numIn(f.effort, 1, 10)!;
  return {
    id: o.id,
    clientId: o.clientId,
    date: o.date,
    workoutName: o.name,
    charge: 'brak',
    duration: Math.max(1, Math.round(min)),
    srpe: effort,
    solo: true,
    notes: 'Szybki wpis biegu.',
    exercises: [{ name: 'Bieg', cardio: true, setsLog: [{ reps: Math.round(min * 100) / 100, unit: 'min', dist: km, ...(hr != null ? { hr: Math.round(hr) } : {}), rpe: effort, done: true }] }],
  };
}
