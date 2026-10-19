import { WorkoutTable } from '../components/PlanTable';
import { Sheet } from '../components/Sheet';
import type { PlanWorkout } from '../domain';
import { fmtDay } from '../format';
import { StartButtons } from './StartButtons';

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
}: {
  workout: PlanWorkout;
  done?: string;
  extra?: boolean;
  onClose: () => void;
  onStart?: () => void;
  onTrainer?: () => void;
  /** Otwórz zapis ostatniego wykonania. */
  onShowDone?: () => void;
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
        <WorkoutTable workout={{ ...workout, exercises: workout.exercises.filter((e) => e.name) }} />
        {onStart && <StartButtons onStart={onStart} onTrainer={onTrainer} />}
      </Sheet>
  );
}
