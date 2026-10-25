import type { SetLog, TrainingSession } from '../domain';
import { num, repsN, secOf, sidesOf, sumReps, timeUnit } from './parse';
import { tonnage } from './load';

/**
 * Odtwarzacz treningu: „ostatnio 60×8” przy każdej serii, strzałka względem poprzedniego razu,
 * rozpoznanie ćwiczeń bez ciężaru i porównanie całego treningu z poprzednim wykonaniem.
 * Same czyste funkcje (testy: lastResult.test.ts).
 */

const nf = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 });
const fmt = (n: number) => nf.format(n);
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Serie robocze z ostatniego wykonania ćwiczenia (sesje do daty `before` włącznie, bez `excludeId`). */
export function lastExerciseLog(history: TrainingSession[], name: string, opts: { before?: string; excludeId?: string } = {}): SetLog[] {
  const key = norm(name);
  if (!key) return [];
  const cand = history
    .filter((s) => s.id !== opts.excludeId && (!opts.before || s.date <= opts.before))
    .sort((a, b) => b.date.localeCompare(a.date));
  for (const s of cand) {
    const e = s.exercises.find((x) => !x.cardio && norm(x.name) === key && (x.setsLog?.some((l) => !l.warmup) || (!x.setsLog?.length && repsN(x.sets))));
    if (!e) continue;
    if (e.setsLog?.length) return e.setsLog.filter((l) => !l.warmup);
    // zapis trenera bez serii pojedynczo („3 × 8 × 60 kg”) — każda seria taka sama
    const n = Math.min(20, Math.round(repsN(e.sets) ?? 0));
    const unit = timeUnit(e.reps) ?? undefined;
    const reps = unit === 's' ? secOf(e.reps) ?? repsN(e.reps) : repsN(e.reps);
    const load = num(e.load);
    if (reps == null && load == null) continue;
    return Array.from({ length: n }, () => ({ reps: reps ?? undefined, load: load ?? undefined, unit }));
  }
  return [];
}

/** Numer serii roboczej (bez rozgrzewek) dla wiersza `i` — ta sama seria w poprzednim wykonaniu. */
export function workIndex(sets: { warmup: boolean }[], i: number): number | null {
  if (!sets[i] || sets[i].warmup) return null;
  return sets.slice(0, i).filter((x) => !x.warmup).length;
}

/** Wynik serii z poprzedniego razu, np. „60×8”, „62,5×8/7”, „8 powt.”, „30 s”. */
export function fmtLast(x: SetLog | undefined): string | null {
  if (!x || (x.reps == null && x.load == null)) return null;
  const r = x.reps != null ? `${fmt(x.reps)}${x.repsR != null ? `/${fmt(x.repsR)}` : ''}` : '';
  const reps = r && (x.unit === 's' ? `${r} s` : x.unit === 'min' ? `${r} min` : r);
  if (x.load != null && x.load > 0) return reps ? `${fmt(x.load)}×${reps}` : `${fmt(x.load)} kg`;
  return reps ? (x.unit ? reps : `${reps} powt.`) : null;
}

/** Wartości do pól serii po stuknięciu w „ostatnio …”. */
export function fillFromLast(x: SetLog): { reps: string; load: string } {
  const reps = x.reps == null ? '' : x.repsR != null ? `${fmt(x.reps)}/${fmt(x.repsR)}` : fmt(x.reps);
  return { reps: reps.replace(/\s/g, ''), load: x.load != null && x.load > 0 ? fmt(x.load).replace(/\s/g, '') : '' };
}

export interface Delta {
  dir: 'up' | 'down' | 'same';
  text: string;
}

/** Powtórzenia/czas z pola serii jako liczba (na stronę: średnia z obu stron). */
function repsValue(v: string, unit?: 's' | 'min'): number | null {
  const lr = sidesOf(v);
  if (lr) return (lr[0] + lr[1]) / 2;
  if (unit === 's') return secOf(v) ?? num(v);
  if (unit === 'min') return num(v);
  return sumReps(v);
}

/**
 * Zmiana względem tej samej serii poprzednim razem: najpierw ciężar, potem powtórzenia (czas).
 * „▲ +2,5 kg”, „▼ −1 powt.”, „= jak ostatnio”. Brak porównania → [].
 */
export function resultDelta(prev: SetLog | undefined, cur: { load: string; reps: string; unit?: 's' | 'min' }): Delta[] {
  if (!prev || !cur.reps.trim()) return [];
  const out: Delta[] = [];
  const cl = num(cur.load);
  const pl = prev.load ?? null;
  if (cl != null && pl != null && Math.abs(cl - pl) >= 0.01) {
    const d = Math.round((cl - pl) * 100) / 100;
    out.push({ dir: d > 0 ? 'up' : 'down', text: `${d > 0 ? '▲ +' : '▼ −'}${fmt(Math.abs(d))} kg` });
  }
  const cr = repsValue(cur.reps, cur.unit);
  const pr = prev.reps != null ? (prev.repsR != null ? (prev.reps + prev.repsR) / 2 : prev.reps) : null;
  const sameUnit = (cur.unit ?? null) === (prev.unit ?? null);
  if (cr != null && pr != null && sameUnit && Math.abs(cr - pr) >= 0.01) {
    const d = Math.round((cr - pr) * 10) / 10;
    const u = cur.unit === 's' ? 's' : cur.unit === 'min' ? 'min' : 'powt.';
    out.push({ dir: d > 0 ? 'up' : 'down', text: `${d > 0 ? '▲ +' : '▼ −'}${fmt(Math.abs(d))} ${u}` });
  }
  if (!out.length && cr != null && pr != null && sameUnit && (cl == null) === (pl == null)) out.push({ dir: 'same', text: '= jak ostatnio' });
  return out;
}

/** Ćwiczenia zwykle bez ciężaru (masa ciała, skoki, deski, mobilność). */
const BODYWEIGHT_RE =
  /pomp(k|ek)|podciąg|\bdip|skok|wskok|wyskok|przeskok|\bhop\b|\bcmj\b|drop jump|burpee|pajac|skip\b|brzuszk|spięci|\bdesk|plank|dead ?bug|martwy robak|bird ?dog|hollow|superman|mountain climber|wspinacz|mostek|glute bridge|nożyc|mobiliz|rozciąg|knee-to-wall|90\/90|masa ciała|masą ciała|\bbw\b|bez obciążenia|copenhagen|nordic/i;
const NO_LOAD_CATS = new Set(['Plyometria', 'Mobilność i rehab']);

/**
 * Ćwiczenie bez kolumny kg: żadna seria nie ma ciężaru (ani w planie, ani poprzednio),
 * a z nazwy / kategorii / trybu „na czas” wynika masa ciała.
 */
export function isNoLoad(
  e: { name: string; cardio?: boolean; timed?: boolean; sets: { load: string; spec: string; sug: string }[] },
  opts: { cat?: string; last?: SetLog[] } = {},
): boolean {
  if (e.cardio) return false;
  if (e.sets.some((s) => s.load.trim() || /\d/.test(s.spec) || /\d/.test(s.sug))) return false;
  if (opts.last?.some((x) => (x.load ?? 0) > 0)) return false;
  return !!e.timed || (!!opts.cat && NO_LOAD_CATS.has(opts.cat)) || BODYWEIGHT_RE.test(e.name);
}

export interface WorkoutStats {
  /** Serie robocze zaliczone. */
  sets: number;
  /** Tonaż (kg). */
  tonnage: number;
  /** Ćwiczenia z co najmniej jedną serią. */
  exercises: number;
}

export function workoutStats(s: TrainingSession): WorkoutStats {
  const work = s.exercises.map((e) => (e.setsLog ? e.setsLog.filter((x) => !x.warmup && !(e.cardio && (x.label === 'Schłodzenie' || x.label === 'Przerwa'))).length : Number(e.sets) || 0));
  return { sets: work.reduce((a, n) => a + n, 0), tonnage: Math.round(tonnage(s)), exercises: work.filter((n) => n > 0).length };
}

/** Poprzednie wykonanie tego samego treningu: ten sam trening z planu, a bez planu — ta sama nazwa. */
export function previousWorkout(history: TrainingSession[], s: TrainingSession): TrainingSession | undefined {
  const same = (x: TrainingSession) =>
    s.workoutId ? x.workoutId === s.workoutId && (!s.planId || x.planId === s.planId) : !!s.workoutName && !x.workoutId && norm(x.workoutName ?? '') === norm(s.workoutName);
  return history
    .filter((x) => x.id !== s.id && x.clientId === s.clientId && x.date <= s.date && same(x))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}

/** Różnica do poprzedniego wykonania: tonaż i liczba serii. */
export function compareWorkouts(cur: WorkoutStats, prev: WorkoutStats | undefined): { tonnage: number; sets: number } | null {
  return prev ? { tonnage: cur.tonnage - prev.tonnage, sets: cur.sets - prev.sets } : null;
}

/** „+1 250 kg”, „−3”, „0” — znak minus typograficzny. */
export function signed(n: number, unit = ''): string {
  const t = `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;
  return unit ? `${t} ${unit}` : t;
}

/** Domyślny wysiłek całego treningu (0–10) z RPE serii roboczych; brak RPE → null. */
export function srpeFromSets(rpes: (string | number | undefined)[]): number | null {
  const v = rpes.map((r) => num(r)).filter((x): x is number => x != null && x >= 1 && x <= 10);
  if (!v.length) return null;
  return Math.max(0, Math.min(10, Math.round(v.reduce((a, x) => a + x, 0) / v.length)));
}
