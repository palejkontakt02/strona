import type { Plan, PlanWorkout, SessionExercise, TrainingSession } from '../domain';
import { inPlanPass } from './plan';
import type { GridCell } from './planGrid';

/**
 * Wykonanie obok planu: dla każdej kolumny tabeli planu (tydzień danej jednostki) — zapis treningu
 * z bieżącego przejścia planu, rozpisany na te same klucze co komórki planu (rozgrzewki „R1”, „R2”…, serie „1”, „2”…).
 */
export interface ColActual {
  session: TrainingSession;
  /** Ćwiczenie (po nazwie) → klucz serii → wykonanie. */
  ex: Map<string, Map<string, GridCell>>;
}

const kgText = (v: number) => `${String(Math.round(v * 100) / 100).replace('.', ',')} kg`;

function setsOf(e: SessionExercise): Map<string, GridCell> {
  const out = new Map<string, GridCell>();
  const logs = e.setsLog ?? [];
  if (!logs.length) {
    // zapis skrócony („3 × 8 · 60 kg”) — rozpisany na serie
    const n = Math.min(20, Math.max(1, Number(e.sets) || 1));
    if (!e.reps && !e.load) return out;
    for (let i = 1; i <= n; i++) out.set(String(i), { reps: e.reps ?? '', load: e.load ? (/^\d+([.,]\d+)?$/.test(e.load.trim()) ? `${e.load.trim().replace('.', ',')} kg` : e.load) : '', rpe: e.rpe ?? '', warm: false });
    return out;
  }
  let w = 0;
  let n = 0;
  for (const x of logs) {
    const warm = !!x.warmup;
    const key = warm ? `R${++w}` : String(++n);
    let reps = x.reps != null ? String(x.reps) : '';
    if (x.unit === 's' && x.reps != null) reps = `${x.reps} s`;
    else if (x.unit === 'min' && x.reps != null) reps = `${String(x.reps).replace('.', ',')} min`;
    else if (x.complex) reps = x.complex;
    if (x.repsR != null) reps = `${reps.replace(/ s$/, '')}/${x.repsR}${x.unit === 's' ? ' s' : ''}`;
    out.set(key, { reps, load: x.load != null ? kgText(x.load) : x.dist ? `${String(x.dist).replace('.', ',')} km` : '', rpe: x.rpe != null ? String(x.rpe).replace('.', ',') : '', warm });
  }
  return out;
}

/** Ostatni zapis jednostki `k` z bieżącego przejścia planu (przerwany z bólu też — widać, ile zrobił). */
export function sessionFor(plan: Plan, k: PlanWorkout, sessions: TrainingSession[]): TrainingSession | undefined {
  return sessions
    .filter((s) => s.planId === plan.id && s.workoutId === k.id && inPlanPass(plan, s))
    .sort((a, b) => (b.date + (b.createdAt ?? '')).localeCompare(a.date + (a.createdAt ?? '')))[0];
}

/** Wykonanie dla kolumn tabeli planu (null — jednostka jeszcze niezrobiona). */
export function colActuals(plan: Plan, cols: { k: PlanWorkout }[], sessions: TrainingSession[]): (ColActual | null)[] {
  return cols.map(({ k }) => {
    const s = sessionFor(plan, k, sessions);
    if (!s) return null;
    const ex = new Map<string, Map<string, GridCell>>();
    for (const e of s.exercises) if (e.name.trim() && !ex.has(e.name.trim())) ex.set(e.name.trim(), setsOf(e));
    return { session: s, ex };
  });
}
