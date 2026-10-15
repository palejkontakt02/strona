import { useState } from 'react';
import { Field, Icon, IconBtn, Modal } from '../components/ui';
import { SET_TYPES, type Plan, type PlanExercise, type PlanWorkout, type SetGroup, type SetType } from '../domain';
import { cloneWeek, savePlan } from '../data/ops';
import { useStore } from '../data/store';
import { uid } from '../format';
import { exerciseLabels, moveInBlocks, removeFromBlocks, setCountLabel } from '../lib/plan';
import { useNav, type ModalState } from '../nav';

/**
 * Wpis w serii uzupełnia kolejne puste serie tego samego typu („3 × 10” wpisuje się raz):
 * kopiowane jest tylko tam, gdzie pole było puste albo równe poprzedniej wartości.
 */
function fillDown(groups: SetGroup[], gi: number, key: 'reps' | 'load', value: string) {
  const before = groups[gi][key];
  groups[gi][key] = value;
  for (let j = gi + 1; j < groups.length; j++) {
    const g = groups[j];
    if (g.type !== groups[gi].type) break;
    if (g[key] === '' || g[key] === before) g[key] = value;
    else break;
  }
}

const newRow = (type: SetType = 'Robocze', from?: SetGroup): SetGroup => ({ type, sets: '1', reps: from?.reps ?? '', load: from?.load ?? '', rpe: from?.rpe ?? '' });
const newExercise = (): PlanExercise => ({ id: uid(), name: '', rest: '2:00', notes: '', groups: [newRow(), newRow(), newRow()] });

export function PlanEditor({ m }: { m: Extract<ModalState, { kind: 'plan' }> }) {
  const { db, apply, ask } = useStore();
  const { closeModal } = useNav();
  // Edytujemy kopię (draft) i zapisujemy całość na końcu.
  const [p, setP] = useState<Plan>(() => structuredClone(m.plan));
  // Rozwinięty tylko pierwszy tydzień — reszta na kliknięcie (długie plany).
  const [open, setOpen] = useState<Set<string>>(() => {
    const focus = m.focusWorkoutId && m.plan.weeks.find((w) => w.workouts.some((k) => k.id === m.focusWorkoutId));
    return new Set((focus ? [focus] : m.plan.weeks.slice(0, 1)).map((w) => w.id));
  });
  const toggle = (id: string) => setOpen((o) => (o.has(id) ? new Set([...o].filter((x) => x !== id)) : new Set([...o, id])));

  const upd = (fn: (draft: Plan) => void) =>
    setP((cur) => {
      const next = structuredClone(cur);
      fn(next);
      return next;
    });

  const findWorkout = (d: Plan, wi: number, ki: number): PlanWorkout => d.weeks[wi].workouts[ki];

  const save = async () => {
    const clean = structuredClone(p);
    for (const w of clean.weeks)
      for (const k of w.workouts) for (let i = k.exercises.length - 1; i >= 0; i--) if (!k.exercises[i].name.trim()) k.exercises = removeFromBlocks(k.exercises, i);
    await apply(savePlan(db, clean), clean.extra ? 'Dodatkowe treningi zapisane.' : m.isNew ? 'Plan utworzony.' : 'Plan zapisany.');
    closeModal();
  };

  const close = async () => {
    if (JSON.stringify(p) === JSON.stringify(m.plan) || (await ask('Zamknąć bez zapisywania zmian w planie?', { confirm: 'Zamknij' }))) closeModal();
  };

  return (
    <Modal wide title={p.extra ? 'Dodatkowe treningi' : m.isNew ? 'Nowy plan' : 'Edycja planu'} onClose={close} onSubmit={save} submitLabel="Zapisz">
      {p.extra && <p className="muted small">Jednostki poza planem — podopieczny widzi je osobno i może je zrobić w każdej chwili. Kolejność planu się nie zmienia.</p>}
      <div className="form-grid form-grid-3" style={p.extra ? { display: 'none' } : undefined}>
        <Field label="Nazwa planu">
          <input className="input" value={p.name} onChange={(e) => upd((d) => void (d.name = e.target.value))} required />
        </Field>
        <Field label="Start">
          <input className="input" type="date" value={p.startDate ?? ''} onChange={(e) => upd((d) => void (d.startDate = e.target.value || undefined))} />
        </Field>
        <div className="field check-row self-end">
          <label className="check">
            <input type="checkbox" checked={p.active} onChange={(e) => upd((d) => void (d.active = e.target.checked))} /> Plan aktywny
          </label>
        </div>
        <Field label="Notatki do planu" wide>
          <input className="input" value={p.notes ?? ''} onChange={(e) => upd((d) => void (d.notes = e.target.value || undefined))} />
        </Field>
      </div>
      <p className="muted small">
        Ciężar w serii: <code>100</code> = kg · <code>75%</code> = % szacowanego 1RM · <code>-10%</code> / <code>+4%</code> = względem poprzedniej serii · puste = dobór z RPE na podstawie historii.
        Tempo wpisz w uwagach, np. <code>3-1-X-0</code>. Superseria / obwód: „+ połącz z poprzednim” — ćwiczenia bloku (A1, A2, A3) robi się na zmianę, a przerwa liczy się po całej rundzie.
      </p>

      {p.weeks.map((week, wi) => (
        <section key={week.id} className="pe-week">
          <div className="pe-week-head">
            <button type="button" className="icon-btn" aria-expanded={open.has(week.id)} aria-label={open.has(week.id) ? 'Zwiń tydzień' : 'Rozwiń tydzień'} onClick={() => toggle(week.id)}>
              <Icon name={open.has(week.id) ? 'chevD' : 'chevR'} />
            </button>
            <input className="input pe-title" value={week.name} onChange={(e) => upd((d) => void (d.weeks[wi].name = e.target.value))} aria-label="Nazwa tygodnia" />
            {!open.has(week.id) && (
              <span className="muted small hide-mobile">
                {week.workouts.length} {week.workouts.length === 1 ? 'trening' : 'treningi'}: {week.workouts.map((k) => k.name).join(', ')}
              </span>
            )}
            <span className="grow" />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const copy = cloneWeek(p.weeks[wi], `${p.weeks[wi].name} (kopia)`);
                upd((d) => void d.weeks.splice(wi + 1, 0, copy));
                setOpen((o) => new Set([...o, copy.id]));
              }}
            >
              Duplikuj tydzień
            </button>
            <IconBtn
              icon="trash"
              label="Usuń tydzień"
              danger
              onClick={async () => {
                if (await ask(`Usunąć „${week.name}” z planu?`)) upd((d) => void d.weeks.splice(wi, 1));
              }}
            />
          </div>

          {open.has(week.id) && week.workouts.map((k, ki) => (
            <div key={k.id} className="pe-workout card">
              <div className="pe-week-head">
                <input className="input pe-title" value={k.name} onChange={(e) => upd((d) => void (findWorkout(d, wi, ki).name = e.target.value))} aria-label="Nazwa jednostki" />
                <IconBtn
                  icon="trash"
                  label="Usuń trening z planu"
                  danger
                  onClick={async () => {
                    if (await ask(`Usunąć „${k.name}” z planu? Zapisane treningi zostaną.`)) upd((d) => void d.weeks[wi].workouts.splice(ki, 1));
                  }}
                />
              </div>

              {k.exercises.map((e, ei, all) => {
                const setEx = (fn: (x: PlanExercise) => void) => upd((d) => fn(findWorkout(d, wi, ki).exercises[ei]));
                const labels = exerciseLabels(all);
                const inBlock = labels[ei].length > 1 && /\d$/.test(labels[ei]);
                return (
                  <div key={e.id} className="pe-ex-wrap">
                    {ei > 0 && (
                      <button
                        type="button"
                        className={`pe-link ${e.linked ? 'on' : ''}`}
                        aria-pressed={!!e.linked}
                        onClick={() => setEx((x) => void (x.linked = !x.linked))}
                        title="Ćwiczenia w bloku robi się na zmianę (A1 → A2 → A3), przerwa po całej rundzie"
                      >
                        {e.linked ? `⛓ w bloku z ${labels[ei - 1]} · rozłącz` : '+ połącz z poprzednim (superseria / obwód)'}
                      </button>
                    )}
                  <div className={`pe-ex ${inBlock ? 'in-block' : ''}`}>
                    <div className="pe-ex-head">
                      <span className="ex-label">{labels[ei]}</span>
                      <input className="input" list="lib-exercises" value={e.name} placeholder="Ćwiczenie" onChange={(ev) => setEx((x) => void (x.name = ev.target.value))} aria-label="Ćwiczenie" />
                      <span className="muted small pe-rest-lbl">przerwa</span>
                      <input
                        className="input pe-rest"
                        value={e.rest ?? ''}
                        placeholder={inBlock && all[ei + 1]?.linked ? 'Przejście' : 'Przerwa'}
                        title={inBlock ? (all[ei + 1]?.linked ? 'Czas przejścia do następnego ćwiczenia bloku (puste = od razu)' : 'Przerwa po całej rundzie bloku') : 'Przerwa między seriami'}
                        onChange={(ev) => setEx((x) => void (x.rest = ev.target.value))} aria-label="Przerwa" />
                      <span className="muted small nowrap">{setCountLabel(e.groups)}</span>
                      <IconBtn
                        icon="up"
                        label="Przesuń ćwiczenie w górę"
                        onClick={() =>
                          ei > 0 &&
                          upd((d) => {
                            const k = findWorkout(d, wi, ki);
                            k.exercises = moveInBlocks(k.exercises, ei, -1);
                          })
                        }
                      />
                      <IconBtn icon="trash" label="Usuń ćwiczenie" danger onClick={() =>
                          upd((d) => {
                            const k = findWorkout(d, wi, ki);
                            k.exercises = removeFromBlocks(k.exercises, ei);
                          })
                        }
                      />
                    </div>
                    <input className="input pe-notes" value={e.notes ?? ''} placeholder="Uwagi / tempo" onChange={(ev) => setEx((x) => void (x.notes = ev.target.value))} aria-label="Uwagi" />
                    <div className="pe-sets">
                      <div className="pe-set pe-set-head">
                        <span>#</span>
                        <span>Typ</span>
                        <span>Powt.</span>
                        <span>Ciężar</span>
                        <span>RPE</span>
                        <span />
                      </div>
                      {e.groups.map((g, gi) => (
                        <div key={gi} className={`pe-set ${g.type === 'Rozgrzewka' ? 'is-warmup' : ''}`}>
                          <span className="muted small">{gi + 1}</span>
                          <select className="input" value={g.type} onChange={(ev) => setEx((x) => void (x.groups[gi].type = ev.target.value as SetType))} aria-label="Typ serii">
                            {SET_TYPES.map((t) => (
                              <option key={t}>{t}</option>
                            ))}
                          </select>
                          <input className="input" value={g.reps} onChange={(ev) => setEx((x) => fillDown(x.groups, gi, 'reps', ev.target.value))} aria-label="Powtórzenia" />
                          <input className="input" value={g.load} onChange={(ev) => setEx((x) => fillDown(x.groups, gi, 'load', ev.target.value))} aria-label="Ciężar" />
                          <input className="input" inputMode="decimal" value={g.rpe} onChange={(ev) => setEx((x) => void (x.groups[gi].rpe = ev.target.value))} aria-label="RPE" />
                          <IconBtn icon="x" label="Usuń serię" onClick={() => setEx((x) => void x.groups.splice(gi, 1))} />
                        </div>
                      ))}
                      <div className="pe-set-actions">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEx((x) => void x.groups.push(newRow(x.groups.at(-1)?.type === 'Rozgrzewka' ? 'Robocze' : x.groups.at(-1)?.type ?? 'Robocze', x.groups.at(-1))))}>
                          + seria
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEx((x) => void x.groups.unshift(newRow('Rozgrzewka')))}>
                          + rozgrzewkowa
                        </button>
                      </div>
                    </div>
                  </div>
                  </div>
                );
              })}
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => upd((d) => void findWorkout(d, wi, ki).exercises.push(newExercise()))}>
                + Ćwiczenie
              </button>
            </div>
          ))}
          {open.has(week.id) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => upd((d) => void d.weeks[wi].workouts.push({ id: uid(), name: `Trening ${String.fromCharCode(65 + d.weeks[wi].workouts.length)}`, exercises: [] }))}>
            + Trening w tym tygodniu
          </button>}
        </section>
      ))}
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => {
          const id = uid();
          upd((d) => void d.weeks.push({ id, name: `Tydzień ${d.weeks.length + 1}`, workouts: [] }));
          setOpen((o) => new Set([...o, id]));
        }}
      >
        + Tydzień
      </button>
    </Modal>
  );
}
