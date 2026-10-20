import { WorkoutTable } from '../components/PlanTable';
import { Sheet } from '../components/Sheet';
import type { PlanWorkout, TrainingSession } from '../domain';
import { sessionToWorkout } from '../data/ops';
import { fmtClock } from '../lib/running';
import { fmtDay } from '../format';
import { StartButtons } from './StartButtons';

/** Wykonanie jako jednostka do tabeli; bieg: w kolumnie celu faktyczne tempo i tętno, RPE z zapisu. */
function doneWorkout(s: TrainingSession): PlanWorkout {
  const w = sessionToWorkout(s);
  const named = s.exercises.filter((e) => e.name.trim());
  return {
    ...w,
    exercises: w.exercises.map((e, i) => {
      const log = named[i]?.setsLog;
      if (!e.cardio || !log?.length) return e;
      return {
        ...e,
        groups: e.groups.map((g, j) => {
          const x = log[j];
          const pace = x?.dist && x.reps ? x.reps / x.dist : null;
          return { ...g, pace: [pace ? `${fmtClock(pace)}/km` : '', x?.hr ? `♥ ${x.hr}` : ''].filter(Boolean).join(' · ') || undefined, rpe: x?.rpe != null ? String(x.rpe) : '' };
        }),
      };
    }),
  };
}

/**
 * Podgląd jednostki: ta sama tabela co plan (wiersz na serię, ciężar, przerwa, uwagi; rozgrzewki po rozwinięciu).
 * Przy wykonanej jednostce — link do ostatniego zapisu.
 */
export function WorkoutPreview({
  workout,
  done,
  extra,
  onClose,
  onStart,
  onTrainer,
  onShowDone,
  session,
}: {
  workout: PlanWorkout;
  done?: string;
  extra?: boolean;
  onClose: () => void;
  onStart?: () => void;
  onTrainer?: () => void;
  /** Otwórz zapis ostatniego wykonania. */
  onShowDone?: () => void;
  /** Ostatni zapis — wykonane serie (powtórzenia, ciężar, RPE) obok planu. */
  session?: TrainingSession;
}) {
  return (
    <Sheet label={workout.name} onClose={onClose}>
        <div className="between">
          <div>
            <span className="eyebrow">{[extra ? 'poza planem' : 'trening z planu', done ? `wykonany ${fmtDay(done)}` : 'jeszcze niewykonany'].join(' · ')}</span>
            <h2>{workout.name}</h2>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Zamknij
          </button>
        </div>
        {done && onShowDone && (
          <button className="btn btn-secondary btn-block" onClick={onShowDone}>
            Zobacz, jak poszło {fmtDay(done)} ›
          </button>
        )}
        <WorkoutTable workout={{ ...workout, exercises: workout.exercises.filter((e) => e.name) }} done={session?.exercises.length ? doneWorkout(session) : undefined} doneName={session ? `Wykonano ${fmtDay(session.date)}` : undefined} />
        {onStart && <StartButtons onStart={onStart} onTrainer={onTrainer} />}
      </Sheet>
  );
}
