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
    // bieg z planu: powtórka z jednostki (cele, strefy, przerwy, bloki), bez przesuwania postępu planu; siła — z zapisanych ciężarów
    const src = s.exercises.some((e) => e.cardio) ? db.plans.find((p) => p.id === s.planId && p.clientId === clientId) : undefined;
    const step = src && planSequence(src).find((x) => x.workout.id === s.workoutId);
    if (src && step && step.workout.exercises.some((e) => e.name)) {
      const videos = Object.fromEntries(db.library.map((e) => [e.name, e.video]));
      const r = buildRun(src, step.week.name, step.workout, sessions, videos, date, Date.now(), db.clients.find((c) => c.id === clientId)?.tests ?? []);
      return { ...r, planId: '', workoutId: '', name: s.workoutName || r.name };
    }
    return repeatRun(s, date);
  }
  const plans = plansOf(db, clientId);
  const plan = db.plans.find((p) => p.id === st.planId && p.clientId === clientId) ?? currentPlan(plans);
  const step = plan && planSequence(plan).find((x) => x.workout.id === st.workoutId);
  if (!plan || !step) return 'Nie znaleziono treningu w planie.';
  if (!step.workout.exercises.some((e) => e.name)) return 'Ten trening nie ma jeszcze ćwiczeń.';
  const videos = Object.fromEntries(db.library.map((e) => [e.name, e.video]));
  const r = buildRun(plan, step.week.name, step.workout, sessions, videos, date, Date.now(), db.clients.find((c) => c.id === clientId)?.tests ?? []);
  return plan.extra ? { ...r, planName: 'Trening dodatkowy', weekName: '' } : r;
}
