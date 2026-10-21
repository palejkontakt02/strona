import { Card, Empty, Icon, Tag } from '../../components/ui';
import type { Client, Plan } from '../../domain';
import { extraPlanOf, plansOf, sessionsOf } from '../../data/ops';
import { useStore } from '../../data/store';
import { fmtDate, plural } from '../../format';
import { currentPlan, nextWorkout } from '../../lib/plan';
import { useNav } from '../../nav';
import { useState } from 'react';
import type { PlanWorkout, TrainingSession } from '../../domain';
import { WorkoutPreview } from '../../athlete/WorkoutPreview';
import { SessionSheet } from '../../athlete/History';
import { newPlan } from './Plans';

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
  // Treningi zrobione bez planu (np. wklejone z notatki, „pusty trening”) — też do podglądu i powtórki.
  const adhoc = sessions.filter((s) => !s.planId || !db.plans.some((p) => p.id === s.planId)).slice(0, 12);
  const lastSession = (p: Plan, id: string) => sessions.find((s) => s.planId === p.id && s.workoutId === id);
  const last = (p: Plan, id: string) => lastSession(p, id)?.date;
  const [preview, setPreview] = useState<{ workout: PlanWorkout; plan: Plan } | null>(null);
  const [shown, setShown] = useState<TrainingSession | null>(null);

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
          <button className="btn btn-secondary btn-sm" onClick={() => openModal({ kind: 'assign', clientId: client.id })}>
            + Zadaj trening
          </button>
        </div>
      }
    >
      {groups.length === 0 && adhoc.length === 0 ? (
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
                  <li key={k.id} className={`row wl-row ${isNext ? 'is-next' : ''}`}>
                    <div className="grow">
                      <strong>{k.name}</strong>{' '}
                      {isNext ? <Tag tone="accent">następny</Tag> : dn ? <Tag tone="ok">✓ {fmtDate(dn)}</Tag> : null}
                      <div className="muted small">{n ? `${n} ${plural(n, 'ćwiczenie', 'ćwiczenia', 'ćwiczeń')}` : 'brak ćwiczeń — dodaj je w edycji'}</div>
                    </div>
                    <span className="wl-actions">
                      {/* start od razu przy następnym (i dodatkowych); pozostałe — z podglądu */}
                      {n > 0 && (isNext || g.plan.extra) && (
                        <>
                          <button className="btn btn-primary btn-sm" onClick={() => startLive(client.id, undefined, undefined, { planId: g.plan.id, workoutId: k.id })}>
                            ▶ Prowadź
                          </button>
                          <button className="btn btn-secondary btn-sm" onClick={() => startAthlete(client.id, { planId: g.plan.id, workoutId: k.id })}>
                            Jako zawodnik
                          </button>
                        </>
                      )}
                      <button className="btn btn-ghost btn-sm" onClick={() => setPreview({ workout: k, plan: g.plan })} title="Ćwiczenia, serie i start jako trener lub podopieczny">
                        <Icon name="eye" size={15} /> {isNext || g.plan.extra ? 'Podgląd' : 'Podgląd i start'}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => openModal({ kind: 'plan', plan: g.plan, focusWorkoutId: k.id })}>
                        <Icon name="edit" size={15} /> Edytuj
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
      {adhoc.length > 0 && (
        <div className="wl-group">
          <div className="wl-label">Wykonane bez planu</div>
          <ul className="rows">
            {adhoc.map((s) => (
              <li key={s.id} className="row wl-row">
                <div className="grow">
                  <strong>{s.workoutName || 'Trening'}</strong> <Tag tone="ok">✓ {fmtDate(s.date)}</Tag>
                  <div className="muted small">
                    {(() => {
                      const ex = s.exercises.length;
                      const sets = s.exercises.reduce((a, e) => a + (e.setsLog?.filter((x) => !x.warmup).length ?? (parseInt(e.sets ?? '', 10) || 0)), 0);
                      return `${ex} ${plural(ex, 'ćwiczenie', 'ćwiczenia', 'ćwiczeń')} · ${sets} ${plural(sets, 'seria', 'serie', 'serii')}`;
                    })()}
                  </div>
                </div>
                <span className="wl-actions">
                  {s.exercises.length > 0 && (
                    <>
                      <button className="btn btn-primary btn-sm" onClick={() => startLive(client.id, undefined, undefined, { repeatSessionId: s.id })}>
                        ▶ Prowadź
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => startAthlete(client.id, { repeatSessionId: s.id })}>
                        Jako zawodnik
                      </button>
                    </>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => setShown(s)}>
                    <Icon name="eye" size={15} /> Podgląd
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => openModal({ kind: 'session', session: s })}>
                    <Icon name="edit" size={15} /> Edytuj
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {preview && (
        <WorkoutPreview
          workout={preview.workout}
          done={last(preview.plan, preview.workout.id)}
          extra={preview.plan.extra}
          session={lastSession(preview.plan, preview.workout.id)}
          onClose={() => setPreview(null)}
          onShowDone={() => setShown(lastSession(preview.plan, preview.workout.id) ?? null)}
          onStart={preview.workout.exercises.some((e) => e.name) ? () => startAthlete(client.id, { planId: preview.plan.id, workoutId: preview.workout.id }) : undefined}
          onTrainer={() => startLive(client.id, undefined, undefined, { planId: preview.plan.id, workoutId: preview.workout.id })}
        />
      )}
      {shown && (
        <SessionSheet
          s={shown}
          onClose={() => setShown(null)}
          onEdit={() => (setShown(null), setPreview(null), openModal({ kind: 'session', session: shown }))}
          onAssign={(other) => (setShown(null), setPreview(null), openModal({ kind: 'assign', clientId: other ? undefined : client.id, sessionId: shown.id }))}
        />
      )}
    </Card>
  );
}
