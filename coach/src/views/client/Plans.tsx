import { Card, Empty, IconBtn, Tag } from '../../components/ui';
import type { Client, Plan } from '../../domain';
import { printPlan } from '../../lib/print';
import { clonePlan, extraPlanOf, extraState, plansOf, savePlan, sessionsOf, type ExtraState } from '../../data/ops';
import { useState } from 'react';
import { del } from '../../data/db';
import { useStore } from '../../data/store';
import { fmtDate, plural, uid } from '../../format';
import { todayISO } from '../../lib/dates';
import { doneInPass, nextWorkout } from '../../lib/plan';
import { useNav } from '../../nav';
import { PlanTable, WorkoutTable } from '../../components/PlanTable';

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
  const today = todayISO();
  const addExtra = () => openModal({ kind: 'assign', clientId: client.id });
  // zadane na dzień i już wykonane chowamy pod „Wykonane”, żeby lista nie rosła bez końca
  const states = new Map(extraWorkouts.map((k) => [k.id, extraState(k, extra?.id, sessions, today)]));
  const [showDone, setShowDone] = useState(false);
  const doneDated = extraWorkouts.filter((k) => states.get(k.id)!.state === 'done');
  const visibleExtra = extraWorkouts
    .filter((k) => showDone || states.get(k.id)!.state !== 'done')
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));

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
                <PlanTable
                  plan={p}
                  done={done}
                  nextId={nx?.workout.id}
                  onLive={(id) => startLive(client.id, undefined, undefined, { planId: p.id, workoutId: id })}
                  onAthlete={(id) => startAthlete(client.id, { planId: p.id, workoutId: id })}
                />
              )}
            </Card>
          );
        })}
      </div>
      <Card
        className="extra-card"
        title="Treningi poza planem"
        action={
          <div className="actions">
            {extra && extraWorkouts.length > 1 && <IconBtn icon="edit" label="Edytuj wszystkie treningi poza planem" onClick={() => openModal({ kind: 'plan', plan: extra })} />}
            <button className="btn btn-primary btn-sm" onClick={addExtra}>
              + Zadaj trening
            </button>
          </div>
        }
      >
        {extraWorkouts.length === 0 ? (
          <p className="muted small">Trening na konkretny dzień (np. jutro bieg, w sobotę mobilność) albo do zrobienia w dowolnym momencie. Plan i jego kolejność się nie zmieniają.</p>
        ) : (
          <div className="plan-week">
            {visibleExtra.map((k) => (
              <div key={k.id} className={`plan-workout ${states.get(k.id)!.state === 'done' ? 'is-done' : ''}`}>
                <div className="plan-workout-head">
                  <strong>{k.name}</strong>
                  <ExtraTag st={states.get(k.id)!} />
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
                {k.exercises.length > 0 && <WorkoutTable workout={k} colName={k.date ? `na ${fmtDate(k.date)}` : 'Plan'} />}
              </div>
            ))}
            {doneDated.length > 0 && (
              <button className="link small" onClick={() => setShowDone(!showDone)}>
                {showDone ? 'Ukryj wykonane' : `Pokaż wykonane zadane (${doneDated.length})`}
              </button>
            )}
          </div>
        )}
      </Card>
    </>
  );
}

/** Stan treningu poza planem: na dzień / zaległy / wykonany / bez terminu (ostatnio). */
export function ExtraTag({ st }: { st: ExtraState }) {
  if (st.state === 'done') return <Tag tone="ok">✓ wykonany {fmtDate(st.date!)}</Tag>;
  if (st.state === 'overdue') return <Tag tone="warn">zaległy · był na {fmtDate(st.date!)}</Tag>;
  if (st.state === 'due') return <Tag tone="accent">na {fmtDate(st.date!)}</Tag>;
  return <Tag tone="muted">bez terminu{st.date ? ` · ostatnio ${fmtDate(st.date)}` : ''}</Tag>;
}
