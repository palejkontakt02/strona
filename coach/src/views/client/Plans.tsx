import { cardioByName, perSideByName } from '../../lib/run';
import { Card, Empty, IconBtn, Tag } from '../../components/ui';
import type { Client, Plan } from '../../domain';
import { printPlan } from '../../lib/print';
import { clonePlan, extraPlanOf, plansOf, savePlan, sessionsOf } from '../../data/ops';
import { del } from '../../data/db';
import { useStore } from '../../data/store';
import { fmtDate, plural, uid } from '../../format';
import { todayISO } from '../../lib/dates';
import { doneInPass, exerciseLabels, mergeGroups, nextWorkout } from '../../lib/plan';
import { useNav } from '../../nav';
import { PlanSets } from '../../components/sets';
import { extraWithNewWorkout } from './WorkoutList';

export function groupSummary(e: Plan['weeks'][number]['workouts'][number]['exercises'][number]) {
  return mergeGroups(e.groups)
    .map((g) => `${g.type === 'Robocze' ? '' : g.type + ' '}${g.sets}×${g.reps || '?'}${g.load ? ' ' + g.load : ''}${g.rpe ? ' @' + g.rpe : ''}`)
    .join(' → ');
}

export function newPlan(clientId: string): Plan {
  return {
    id: uid(),
    clientId,
    name: 'Nowy plan',
    startDate: todayISO(),
    active: true,
    weeks: [{ id: uid(), name: 'Tydzień 1', workouts: [{ id: uid(), name: 'Trening A', exercises: [] }] }],
  };
}

export function ClientPlans({ client }: { client: Client }) {
  const { db, apply, ask } = useStore();
  const { openModal, startLive, startAthlete } = useNav();
  const plans = plansOf(db, client.id).sort((a, b) => Number(b.active) - Number(a.active) || (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const sessions = sessionsOf(db, client.id);
  const extra = extraPlanOf(db, client.id);
  const extraWorkouts = extra?.weeks.flatMap((w) => w.workouts) ?? [];
  const lastDone = (id: string) => sessions.find((s) => s.planId === extra?.id && s.workoutId === id)?.date;
  const addExtra = () => openModal({ kind: 'plan', plan: extraWithNewWorkout(client.id, extra), isNew: !extra });

  const removeExtra = async (id: string, name: string) => {
    if (!extra || !(await ask(`Usunąć „${name}” z dodatkowych treningów? Zapisane wcześniej treningi zostają w historii.`, { confirm: 'Usuń trening' }))) return;
    await apply(savePlan(db, { ...extra, weeks: extra.weeks.map((w) => ({ ...w, workouts: w.workouts.filter((k) => k.id !== id) })) }), `Usunięto „${name}”.`);
  };

  return (
    <>
      <div className="toolbar">
        <h3>Plany treningowe</h3>
        <div className="actions">
          {(() => {
            // gotowy plan innego podopiecznego jako szablon (kopia — oryginał zostaje bez zmian)
            const others = db.plans.filter((x) => x.clientId !== client.id && !x.extra);
            if (!others.length) return null;
            return (
              <select
                className="input input-sm"
                value=""
                aria-label="Skopiuj plan od innego podopiecznego"
                onChange={(e) => {
                  const src = others.find((x) => x.id === e.target.value);
                  if (!src) return;
                  const copy = { ...clonePlan(src, src.name), clientId: client.id, active: plans.length === 0 };
                  void apply(savePlan(db, copy), `Skopiowano plan „${src.name}” — możesz go dopasować.`);
                }}
              >
                <option value="">Plan od innego podopiecznego…</option>
                {others.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} — {db.clients.find((c) => c.id === x.clientId)?.name ?? ''}
                  </option>
                ))}
              </select>
            );
          })()}
          <button className="btn btn-primary" onClick={() => openModal({ kind: 'plan', plan: newPlan(client.id), isNew: true })}>
            + Nowy plan
          </button>
        </div>
      </div>
      {plans.length === 0 && <Empty>Ten podopieczny nie ma jeszcze planu treningowego.</Empty>}
      <div className="stack">
        {plans.map((p) => {
          const nx = nextWorkout(p, sessions);
          const done = doneInPass(p, sessions);
          return (
            <Card
              key={p.id}
              title={
                <>
                  {p.name} {p.active && <Tag tone="accent">Aktywny</Tag>}
                </>
              }
              action={
                <div className="actions">
                  {!p.active && (
                    <button className="btn btn-ghost btn-sm" onClick={() => apply(savePlan(db, { ...p, active: true }), 'Plan ustawiony jako aktywny.')}>
                      Ustaw aktywny
                    </button>
                  )}
                  <IconBtn icon="edit" label="Edytuj plan" onClick={() => openModal({ kind: 'plan', plan: p })} />
                  <IconBtn icon="copy" label="Duplikuj plan" onClick={() => apply(savePlan(db, clonePlan(p, `${p.name} (kopia)`)), 'Plan zduplikowany.')} />
                  <button className="btn btn-ghost btn-sm" onClick={() => printPlan(p, client, sessions)} title="Drukuj albo zapisz jako PDF">
                    🖨 Drukuj
                  </button>
                  <IconBtn
                    icon="trash"
                    label="Usuń plan"
                    danger
                    onClick={async () => {
                      if (await ask(`Usunąć plan „${p.name}”? Zapisane treningi zostaną.`)) await apply([del('plans', p.id)], 'Plan usunięty.');
                    }}
                  />
                </div>
              }
            >
              <p className="muted small">
                {p.startDate && `Start ${fmtDate(p.startDate)} · `}
                {p.weeks.length} tyg. · {(() => { const n = p.weeks.reduce((a, w) => a + w.workouts.length, 0); return `${n} ${plural(n, 'jednostka', 'jednostki', 'jednostek')}`; })()}
                {nx && p.active && ` · następny: ${nx.workout.name} (${nx.week.name})`}
              </p>
              {p.notes && <p className="small pre">{p.notes}</p>}
              {p.active && (
                <div className="plan-weeks">
                  {p.weeks.map((w) => (
                    <div key={w.id} className="plan-week">
                      <div className="plan-week-name">{w.name}</div>
                      {w.workouts.map((k) => (
                        <div key={k.id} className={`plan-workout ${done.has(k.id) ? 'is-done' : ''} ${nx?.workout.id === k.id ? 'is-next' : ''}`}>
                          <div className="plan-workout-head">
                            <strong>{k.name}</strong>
                            {nx?.workout.id === k.id ? <Tag tone="accent">następny</Tag> : done.has(k.id) ? <Tag tone="ok">✓ zrobione</Tag> : null}
                            {k.exercises.some((e) => e.name) && nx?.workout.id === k.id && (
                              <span className="plan-workout-actions">
                                <button className="btn btn-primary btn-sm" onClick={() => startLive(client.id, undefined, undefined, { planId: p.id, workoutId: k.id })}>
                                  ▶ Prowadź
                                </button>
                                <button className="btn btn-secondary btn-sm" onClick={() => startAthlete(client.id, { planId: p.id, workoutId: k.id })}>
                                  Jako zawodnik
                                </button>
                              </span>
                            )}
                          </div>
                          {k.exercises.length === 0 ? (
                            <p className="muted small">Brak ćwiczeń.</p>
                          ) : (
                            <ul className="plain">
                              {k.exercises.map((e, ei) => (
                                <li key={e.id} className={`plan-ex ${e.linked ? 'linked' : ''}`}>
                                  <span>
                                    <span className="ex-label">{exerciseLabels(k.exercises)[ei]}</span> {e.name}
                                  </span>
                                  <PlanSets groups={e.groups} perSide={e.perSide ?? perSideByName(e.name)} cardio={e.cardio ?? cardioByName(e.name)} />
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>
      <Card
        className="extra-card"
        title="Dodatkowe treningi"
        action={
          <div className="actions">
            {extra && <IconBtn icon="edit" label="Edytuj dodatkowe treningi" onClick={() => openModal({ kind: 'plan', plan: extra })} />}
            <button className="btn btn-secondary btn-sm" onClick={addExtra}>
              + Dodaj trening
            </button>
          </div>
        }
      >
        {extraWorkouts.length === 0 ? (
          <p className="muted small">Jednostki poza planem (np. dodatkowa siłownia, mobilność, kondycja). Podopieczny widzi je osobno i może zrobić w dowolnym momencie.</p>
        ) : (
          <div className="plan-week">
            {extraWorkouts.map((k) => (
              <div key={k.id} className="plan-workout">
                <div className="plan-workout-head">
                  <strong>{k.name}</strong>
                  {lastDone(k.id) && <Tag tone="ok">ostatnio {fmtDate(lastDone(k.id)!)}</Tag>}
                  <span className="row-inline">
                    <IconBtn icon="edit" label={`Edytuj ${k.name}`} onClick={() => openModal({ kind: 'plan', plan: extra!, focusWorkoutId: k.id })} />
                    <IconBtn icon="trash" label={`Usuń ${k.name}`} danger onClick={() => void removeExtra(k.id, k.name)} />
                  </span>
                  {k.exercises.some((e) => e.name) ? (
                    <span className="plan-workout-actions">
                      <button className="btn btn-primary btn-sm" onClick={() => startLive(client.id, undefined, undefined, { planId: extra!.id, workoutId: k.id })}>
                        ▶ Prowadź
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => startAthlete(client.id, { planId: extra!.id, workoutId: k.id })}>
                        Jako zawodnik
                      </button>
                    </span>
                  ) : (
                    <span className="muted small">brak ćwiczeń</span>
                  )}
                </div>
                {k.exercises.length > 0 && (
                  <ul className="plain">
                    {k.exercises.map((e, ei) => (
                      <li key={e.id} className={`plan-ex ${e.linked ? 'linked' : ''}`}>
                        <span>
                          <span className="ex-label">{exerciseLabels(k.exercises)[ei]}</span> {e.name}
                        </span>
                        <PlanSets groups={e.groups} perSide={e.perSide ?? perSideByName(e.name)} cardio={e.cardio ?? cardioByName(e.name)} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
