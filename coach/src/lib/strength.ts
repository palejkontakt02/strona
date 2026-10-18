import type { SessionExercise, SetLog, TrainingSession } from '../domain';
import { num, repsN } from './parse';

export const round25 = (v: number) => Math.round(v / 2.5) * 2.5;

/** RIR = 10 − RPE (min. 0). Brak RPE → `fallback`. */
function rirOf(rpe: unknown, fallback: number): number {
  const r = num(rpe);
  return r != null ? Math.max(0, 10 - r) : fallback;
}

/**
 * e1RM wg Epleya z uwzględnieniem RIR: kg × (1 + (powt + RIR)/30).
 * powt + RIR = 1 → kg; powt + RIR > 15 → null (zbyt niepewne).
 */
export function e1rmRPE(load: unknown, reps: unknown, rpe: unknown, fallbackRir = 0): number | null {
  const l = num(load);
  const r = repsN(reps);
  if (!l || !r) return null;
  const rir = rirOf(rpe, fallbackRir);
  if (r + rir > 15) return null;
  return r + rir === 1 ? l : l * (1 + (r + rir) / 30);
}

/** Ciężar pod cel: e1RM / (1 + (powt + RIR_cel)/30), zaokrąglony do 2,5 kg. Brak RPE → RIR 2. */
export function loadFor(e1: number, reps: unknown, rpe: unknown): number {
  const r = repsN(reps) || 1;
  const rir = rirOf(rpe, 2);
  return round25(r + rir === 1 ? e1 : e1 / (1 + (r + rir) / 30));
}

function workSets(e: SessionExercise): SetLog[] {
  return (e.setsLog || []).filter((s) => !s.warmup && s.done !== false && !s.complex && !s.unit); // serie na czas nie liczą się do siły
}

/** Najlepszy e1RM ćwiczenia w sesji: max z serii roboczych, a bez serii — z podsumowania. */
export function exerciseE1(e: SessionExercise): number | null {
  const sets = workSets(e);
  if (sets.length === 0) return e.setsLog?.length || String(e.reps ?? '').includes('+') ? null : e1rmRPE(e.load, e.reps, e.rpe);
  let best: number | null = null;
  for (const s of sets) {
    const v = e1rmRPE(s.load, s.reps, s.rpe);
    if (v != null && (best == null || v > best)) best = v;
  }
  return best;
}

/** Seria z najwyższym e1RM (do wyświetlenia rekordu). */
export function bestSet(e: SessionExercise): { load: unknown; reps: unknown } {
  const sets = (e.setsLog || []).filter((s) => !s.warmup);
  if (sets.length === 0) return { load: e.load, reps: e.reps };
  let best = sets[0];
  let bv = -1;
  for (const s of sets) {
    const v = e1rmRPE(s.load, s.reps, s.rpe) || 0;
    if (v > bv) {
      bv = v;
      best = s;
    }
  }
  return { load: best.load, reps: best.reps };
}

export interface ResolvedLoad {
  load: number | null;
  why: string;
}

/**
 * Zapis ciężaru w serii planu:
 * „100” = kg · „75%” = % e1RM · „-10%”/„+4%” = względem poprzedniej serii · puste = dobór z RPE (jeśli jest historia).
 */
export function resolveLoad(
  spec: string | undefined,
  e1: number | null,
  reps: unknown,
  rpe: unknown,
  prev: number | null,
): ResolvedLoad {
  const sp = String(spec || '').replace(',', '.').trim();
  const rel = sp.match(/^([+-])\s*(\d+(?:\.\d+)?)\s*%/);
  if (rel) {
    const p = (rel[1] === '-' ? -1 : 1) * Number(rel[2]);
    return prev != null
      ? { load: round25(prev * (1 + p / 100)), why: `${p > 0 ? '+' : ''}${p}% od poprzedniej serii` }
      : { load: null, why: `${rel[0]} od poprzedniej serii` };
  }
  const pc = sp.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pc) {
    return e1
      ? { load: round25((e1 * Number(pc[1])) / 100), why: `${pc[1]}% szac. 1RM` }
      : { load: null, why: `${pc[1]}% 1RM – brak historii, dobierz ciężar` };
  }
  const kg = num(sp);
  if (kg != null) return { load: kg, why: '' };
  if (e1 && repsN(reps)) {
    const target = rpe || 8;
    return { load: loadFor(e1, reps, target), why: `dobrane z historii do RPE ${String(target)}` };
  }
  return { load: null, why: '' };
}

export interface PersonalRecord {
  date: string;
  name: string;
  load: unknown;
  reps: unknown;
  e1: number;
  gain: number;
}

/**
 * Rekordy: chronologicznie per ćwiczenie; rekord = e1RM > dotychczasowe max + 0,05.
 * Pierwszy wynik ćwiczenia ustala punkt odniesienia (nie jest rekordem). Wynik: od najnowszych.
 */
export function records(sessions: TrainingSession[]): PersonalRecord[] {
  const asc = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
  const best: Record<string, number> = {};
  const out: PersonalRecord[] = [];
  for (const s of asc) {
    for (const e of s.exercises) {
      const v = exerciseE1(e);
      if (v == null) continue;
      const b = best[e.name];
      if (b != null && v > b + 0.05) {
        const bs = bestSet(e);
        out.push({ date: s.date, name: e.name, load: bs.load, reps: bs.reps, e1: v, gain: v - b });
      }
      if (b == null || v > b) best[e.name] = v;
    }
  }
  return out.reverse();
}

/** Przebieg e1RM ćwiczenia w czasie (max dzienny, 0,1 kg). */
export function e1Series(sessions: TrainingSession[], name: string): { x: string; y: number }[] {
  const by: Record<string, number> = {};
  for (const s of sessions) {
    for (const e of s.exercises) {
      if (e.name !== name) continue;
      const v = exerciseE1(e);
      if (v != null) by[s.date] = Math.max(by[s.date] || 0, Math.round(v * 10) / 10);
    }
  }
  return Object.entries(by)
    .map(([x, y]) => ({ x, y }))
    .sort((a, b) => a.x.localeCompare(b.x));
}

/** Najlepszy dotychczasowy e1RM ćwiczenia (do podpowiedzi ciężaru). */
export function bestE1(sessions: TrainingSession[], name: string): number | null {
  let best: number | null = null;
  for (const s of sessions)
    for (const e of s.exercises) {
      if (e.name !== name) continue;
      const v = exerciseE1(e);
      if (v != null && (best == null || v > best)) best = v;
    }
  return best;
}

/**
 * e1RM do podpowiedzi ciężaru: najlepszy wynik z ostatnich `weeks` tygodni (licząc od ostatniego
 * treningu tego ćwiczenia), serie bez RPE z zapasem 2 powtórzeń — lekki dzień techniczny nie zaniża podpowiedzi.
 */
export function recentE1(sessions: TrainingSession[], name: string, weeks = 6): number | null {
  const withEx = sessions.filter((s) => s.exercises.some((e) => e.name === name));
  if (!withEx.length) return null;
  const last = withEx.reduce((a, s) => (s.date > a ? s.date : a), withEx[0].date);
  const from = new Date(new Date(`${last}T12:00:00`).getTime() - weeks * 7 * 864e5).toISOString().slice(0, 10);
  let best: number | null = null;
  for (const s of withEx) {
    if (s.date < from) continue;
    for (const e of s.exercises) {
      if (e.name !== name) continue;
      const sets = workSets(e);
      const vals = sets.length ? sets.map((x) => e1rmRPE(x.load, x.reps, x.rpe, 2)) : [String(e.reps ?? '').includes('+') ? null : e1rmRPE(e.load, e.reps, e.rpe, 2)];
      for (const v of vals) if (v != null && (best == null || v > best)) best = v;
    }
  }
  return best ?? bestE1(sessions, name);
}

/**
 * Maks. z testu („1RM przysiad”, „Back Squat 1RM”, „max wyciskanie”) dla ćwiczenia z planu:
 * najnowszy wynik testu, którego nazwa (bez „1RM/max/kg”) zawiera się w nazwie ćwiczenia.
 */
export function testedMax(tests: { name: string; date: string; value?: number | string }[], exercise: string): { value: number; date: string } | null {
  // porównanie słów bez sprzętu i ozdobników: „1RM przysiad” = „Przysiad ze sztangą”, ale ≠ „Przysiad bułgarski”
  const STOP = new Set(['z', 'ze', 'na', 'sztangą', 'sztanga', 'sztangi', 'barbell', 'bb', 'klasyczny', 'klasyczne', 'klasyczna', 'tylny', 'test', 'kg', '1rm', 'rm', 'max', 'maks', 'maksymalny']);
  const words = (t: string) => new Set(t.toLowerCase().replace(/\(.*?\)|[^a-ząćęłńóśźż0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w)));
  const ex = words(exercise);
  let best: { value: number; date: string } | null = null;
  for (const t of tests) {
    if (!/\b(1\s*rm|rm|max|maks)/i.test(t.name)) continue;
    const key = words(t.name.replace(/1\s*rm/i, ''));
    const v = typeof t.value === 'number' ? t.value : parseFloat(String(t.value ?? '').replace(',', '.'));
    if (!key.size || !Number.isFinite(v) || v <= 0) continue;
    if (key.size !== ex.size || [...key].some((w) => !ex.has(w))) continue;
    if (!best || t.date > best.date) best = { value: v, date: t.date };
  }
  return best;
}
