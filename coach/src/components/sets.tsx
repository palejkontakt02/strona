import type { SetGroup } from '../domain';
import { expandSets, mergeGroups } from '../lib/plan';
import { fmtDur, fmtKm, parseDur, parseKm } from '../lib/running';

const kg = (load: string) => (/^\d+([.,]\d+)?$/.test(load) ? `${load} kg` : load);

/** Serie z planu pokazane pojedynczo: „R 5×60 kg”, „1 5×100 kg @8”, „2 5×100 kg @8”… */
/** Bieg / cardio: bloki odcinków — „R 15 min · Z2”, „6 × 800 m · Z5”, „S 10 min · Z1”. */
function CardioSets({ groups }: { groups: SetGroup[] }) {
  return (
    <div className="hist-sets">
      {mergeGroups(groups).map((g, j) => {
        const n = Number(g.sets) || 1;
        const d = parseDur(g.reps);
        const km = parseKm(g.load);
        const what = [km != null ? fmtKm(km) : g.load, d != null ? fmtDur(d) : g.reps].filter(Boolean).join(' / ') || '?';
        const tag = g.type === 'Rozgrzewka' ? 'R.' : g.type === 'Schłodzenie' ? 'S.' : n > 1 ? `${n} ×` : '';
        return (
          <span key={j} className={`set-chip ${g.type === 'Robocze' ? '' : 'warm'}`} title={g.type === 'Robocze' ? 'Odcinek' : g.type}>
            {tag && <i>{tag}</i>} {what}
            {g.pace && <i> · {g.pace}</i>}
            {g.rpe && <i> @{g.rpe}</i>}
          </span>
        );
      })}
    </div>
  );
}

export function PlanSets({ groups, perSide, cardio }: { groups: SetGroup[]; perSide?: boolean; cardio?: boolean }) {
  if (cardio) return <CardioSets groups={groups} />;
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
