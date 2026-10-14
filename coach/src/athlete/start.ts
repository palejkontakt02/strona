import type { Db } from '../data/db';
import { plansOf, sessionsOf } from '../data/ops';
import { currentPlan, planSequence } from '../lib/plan';
import { buildRun, repeatRun, type Run } from '../lib/run';

/** Co uruchomić: jednostkę z planu albo powtórkę zapisanego treningu. */
export interface RunStart {
  planId?: string;
  workoutId?: string;
  repeatSessionId?: string;
}

/** Buduje trening do rozpoczęcia; zwraca komunikat, gdy się nie da. */
export function runFromStart(db: Db, clientId: string, st: RunStart, date: string): Run | string {
  const sessions = sessionsOf(db, clientId);
  if (st.repeatSessionId) {
    const s = sessions.find((x) => x.id === st.repeatSessionId);
    if (!s) return 'Nie znaleziono tego treningu.';
    if (s.exercises.length === 0) return 'Ten trening nie ma zapisanych ćwiczeń.';
    return repeatRun(s, date);
  }
  const plans = plansOf(db, clientId);
  const plan = plans.find((p) => p.id === st.planId) ?? currentPlan(plans);
  const step = plan && planSequence(plan).find((x) => x.workout.id === st.workoutId);
  if (!plan || !step) return 'Nie znaleziono treningu w planie.';
  if (!step.workout.exercises.some((e) => e.name)) return 'Ten trening nie ma jeszcze ćwiczeń.';
  const videos = Object.fromEntries(db.library.map((e) => [e.name, e.video]));
  return buildRun(plan, step.week.name, step.workout, sessions, videos, date);
}
