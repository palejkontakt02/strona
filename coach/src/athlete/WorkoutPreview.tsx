import { cardioByName, isTimed, perSideByName } from '../lib/run';
import { PlanSets } from '../components/sets';
import { Sheet } from '../components/Sheet';
import type { PlanWorkout } from '../domain';
import { fmtDay } from '../format';
import { exerciseLabels } from '../lib/plan';
import { StartButtons } from './StartButtons';

/**
 * Podgląd jednostki z planu: ćwiczenia (z blokami A1/A2), każda seria osobno, przerwy, uwagi.
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
  const labels = exerciseLabels(workout.exercises);
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
        <div className="hist-ex">
          {workout.exercises
            .filter((e) => e.name)
            .map((e, i) => (
              <div key={e.id} className={`hist-ex-row ${e.linked ? 'linked' : ''}`}>
                <b>
                  <span className="ex-label">{labels[i]}</span> {e.name}
                </b>
                <PlanSets groups={e.groups} perSide={e.perSide ?? perSideByName(e.name)} cardio={e.cardio ?? cardioByName(e.name)} timed={isTimed(e)} />
                <div className="muted small">{[e.rest && `przerwa ${e.rest}`, e.notes].filter(Boolean).join(' · ')}</div>
              </div>
            ))}
        </div>
        {onStart && <StartButtons onStart={onStart} onTrainer={onTrainer} />}
      </Sheet>
  );
}
