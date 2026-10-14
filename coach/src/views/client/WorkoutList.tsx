import { Card, Empty, IconBtn, Tag } from '../../components/ui';
import type { Client, Plan } from '../../domain';
import { extraPlanOf, newExtraPlan, plansOf, sessionsOf } from '../../data/ops';
import { useStore } from '../../data/store';
import { fmtDate, uid } from '../../format';
import { currentPlan, nextWorkout } from '../../lib/plan';
import { useNav } from '../../nav';
import { newPlan } from './Plans';

/** Edytor dodatkowych treningów z nową, pustą jednostką na końcu. */
export function extraWithNewWorkout(clientId: string, extra?: Plan): Plan {
  const base = extra ?? newExtraPlan(clientId);
  const weeks = base.weeks.length ? base.weeks : [{ id: uid(), name: 'Dodatkowe', workouts: [] }];
  const n = weeks.reduce((a, w) => a + w.workouts.length, 0);
  return { ...base, weeks: weeks.map((w, i) => (i === weeks.length - 1 ? { ...w, workouts: [...w.workouts, { id: uid(), name: `Trening dodatkowy ${n + 1}`, exercises: [] }] } : w)) };
}

/**
 * Wszystkie treningi podopiecznego w jednym miejscu: jednostki z aktywnego planu i dodatkowe (poza planem).
 * Przy każdej: prowadź (trener), jako zawodnik, edytuj.
 */
export function WorkoutList({ client }: { client: Client }) {
  const { db } = useStore();
  const { openModal, startLive, startAthlete } = useNav();
  const sessions = sessionsOf(db, client.id);
  const plan = currentPlan(plansOf(db, client.id));
  const extra = extraPlanOf(db, client.id);
  const nx = nextWorkout(plan, sessions);
  const groups: { plan: Plan; label: string; workouts: Plan['weeks'][number]['workouts'] }[] = [
    ...(plan ? plan.weeks.map((w) => ({ plan, label: `${plan.name} · ${w.name}`, workouts: w.workouts })) : []),
    ...(extra ? [{ plan: extra, label: 'Poza planem', workouts: extra.weeks.flatMap((w) => w.workouts) }] : []),
  ].filter((g) => g.workouts.length);
  const last = (p: Plan, id: string) => sessions.find((s) => s.planId === p.id && s.workoutId === id)?.date;

  return (
    <Card
      title="Wszystkie treningi"
      action={
        <div className="actions">
          {!plan && (
            <button className="btn btn-ghost btn-sm" onClick={() => openModal({ kind: 'plan', plan: newPlan(client.id), isNew: true })}>
              + Plan
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={() => openModal({ kind: 'plan', plan: extraWithNewWorkout(client.id, extra), isNew: !extra })}>
            + Trening poza planem
          </button>
        </div>
      }
    >
      {groups.length === 0 ? (
        <Empty>Brak treningów. Dodaj plan albo trening poza planem.</Empty>
      ) : (
        groups.map((g) => (
          <div key={g.label} className="wl-group">
            <div className="wl-label">{g.label}</div>
            <ul className="rows">
              {g.workouts.map((k) => {
                const n = k.exercises.filter((e) => e.name).length;
                const dn = last(g.plan, k.id);
                const isNext = !g.plan.extra && nx?.workout.id === k.id;
                return (
                  <li key={k.id} className="row wl-row">
                    <div className="grow">
                      <strong>{k.name}</strong>{' '}
                      {isNext ? <Tag tone="accent">następny</Tag> : dn ? <Tag tone="ok">✓ {fmtDate(dn)}</Tag> : null}
                      <div className="muted small">{n ? `${n} ćwiczeń` : 'brak ćwiczeń — dodaj je w edycji'}</div>
                    </div>
                    <span className="wl-actions">
                      {n > 0 && (
                        <>
                          <button className="btn btn-primary btn-sm" onClick={() => startLive(client.id, undefined, undefined, { planId: g.plan.id, workoutId: k.id })}>
                            ▶ Prowadź
                          </button>
                          <button className="btn btn-secondary btn-sm" onClick={() => startAthlete(client.id, { planId: g.plan.id, workoutId: k.id })}>
                            Jako zawodnik
                          </button>
                        </>
                      )}
                      <IconBtn icon="edit" label={`Edytuj „${k.name}”`} onClick={() => openModal({ kind: 'plan', plan: g.plan, focusWorkoutId: k.id })} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </Card>
  );
}
