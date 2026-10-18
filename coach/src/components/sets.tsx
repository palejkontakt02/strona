import type { SetGroup } from '../domain';
import { expandSets } from '../lib/plan';

const kg = (load: string) => (/^\d+([.,]\d+)?$/.test(load) ? `${load} kg` : load);

/** Serie z planu pokazane pojedynczo: „R 5×60 kg”, „1 5×100 kg @8”, „2 5×100 kg @8”… */
export function PlanSets({ groups, perSide, cardio }: { groups: SetGroup[]; perSide?: boolean; cardio?: boolean }) {
  let n = 0;
  return (
    <div className="hist-sets">
      {expandSets(groups).map((g, j) => {
        const warm = g.type === 'Rozgrzewka';
        if (!warm) n++;
        return (
          <span key={j} className={`set-chip ${warm ? 'warm' : ''}`} title={g.type}>
            <i>{warm ? 'R.' : `${n}.`}</i> {cardio ? [g.reps && (/\d$/.test(g.reps.trim()) ? `${g.reps} min` : g.reps), g.load && (/\d$/.test(g.load.trim()) ? `${g.load} km` : g.load)].filter(Boolean).join(' · ') || '?' : g.load ? `${g.reps || '?'}${perSide ? '/str.' : ''} × ${kg(g.load)}` : /^\d+([–-]\d+)?$/.test(g.reps.trim()) ? `${g.reps} powt.${perSide ? '/str.' : ''}` : `${g.reps || '?'}${perSide ? '/str.' : ''}`}
            {g.rpe && <i> @{g.rpe}</i>}
            {g.type !== 'Robocze' && !warm && <i> {g.type.toLowerCase()}</i>}
          </span>
        );
      })}
    </div>
  );
}
