import type { Db } from '../data/db';
import { plansOf, sessionsOf } from '../data/ops';
import { currentPlan, nextWorkout, planSequence } from '../lib/plan';
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
    // powtórka treningu, który jest właśnie następnym w aktywnym planie (np. „C” z zeszłego tygodnia, a następny to „C”
    // z tego tygodnia) — zaliczamy jednostkę z TEGO tygodnia; inaczej powtórka bez przesuwania planu
    const cur = currentPlan(plansOf(db, clientId));
    const nx = cur ? nextWorkout(cur, sessions) : null;
    const srcName = (s.planId ? db.plans.find((p) => p.id === s.planId)?.weeks.flatMap((w) => w.workouts).find((k) => k.id === s.workoutId)?.name : undefined) ?? s.workoutName;
    const link = cur && nx && srcName && nx.workout.name.trim().toLowerCase() === srcName.trim().toLowerCase() ? { planId: cur.id, workoutId: nx.workout.id, weekName: nx.week.name, planName: cur.name } : null;
    const src = s.exercises.some((e) => e.cardio) ? db.plans.find((p) => p.id === s.planId && p.clientId === clientId) : undefined;
    const step = src && planSequence(src).find((x) => x.workout.id === s.workoutId);
    if (src && step && step.workout.exercises.some((e) => e.name)) {
      const videos = Object.fromEntries(db.library.map((e) => [e.name, e.video]));
      const r = buildRun(src, step.week.name, step.workout, sessions, videos, date, Date.now(), db.clients.find((c) => c.id === clientId)?.tests ?? []);
      return { ...r, planId: link?.planId ?? '', workoutId: link?.workoutId ?? '', ...(link ? { weekName: link.weekName, planName: link.planName } : {}), name: s.workoutName || r.name, repeatOf: { sessionId: s.id, date: s.date } };
    }
    const rr = { ...repeatRun(s, date), repeatOf: { sessionId: s.id, date: s.date } };
    return link ? { ...rr, planId: link.planId, workoutId: link.workoutId, weekName: link.weekName, planName: link.planName } : rr;
  }
  const plans = plansOf(db, clientId);
  const plan = db.plans.find((p) => p.id === st.planId && p.clientId === clientId) ?? currentPlan(plans);
  const step = plan && planSequence(plan).find((x) => x.workout.id === st.workoutId);
  if (!plan || !step) return 'Nie znaleziono treningu w planie.';
  if (!step.workout.exercises.some((e) => e.name)) return 'Ten trening nie ma jeszcze ćwiczeń.';
  const videos = Object.fromEntries(db.library.map((e) => [e.name, e.video]));
  const r = buildRun(plan, step.week.name, step.workout, sessions, videos, date, Date.now(), db.clients.find((c) => c.id === clientId)?.tests ?? []);
  if (plan.extra) {
    // zadany trening = kopia następnej jednostki planu (ta sama nazwa) — zalicza też plan (bez robienia go dwa razy)
    const cur = currentPlan(plans);
    const nx = cur ? nextWorkout(cur, sessions) : null;
    if (cur && nx && nx.workout.name.trim().toLowerCase() === step.workout.name.trim().toLowerCase())
      return { ...r, planId: cur.id, workoutId: nx.workout.id, planName: cur.name, weekName: nx.week.name, extraOf: { planId: plan.id, workoutId: step.workout.id } };
    return { ...r, planName: 'Trening dodatkowy', weekName: '' };
  }
  return r;
}
