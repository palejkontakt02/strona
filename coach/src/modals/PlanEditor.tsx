import { cardioByName, isTimed, perSideByName } from '../lib/run';
import { emptyRunExercise, RUN_TEMPLATES } from '../lib/running';
import { RunBuilder, RunTargetList } from '../components/RunBuilder';

const CARDIO_TYPES: SetType[] = ['Rozgrzewka', 'Robocze', 'Schłodzenie'];
import { useState } from 'react';
import { Field, Icon, IconBtn, Modal } from '../components/ui';
import { SET_TYPES, type Plan, type PlanExercise, type PlanWorkout, type SetGroup, type SetType } from '../domain';
import { cloneWeek, nextWeekName, PROGRESSIONS, savePlan, type Progression } from '../data/ops';
import { useStore } from '../data/store';
import { fmtDay, uid } from '../format';
import { todayISO } from '../lib/dates';
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
  const { db, apply, ask, toast } = useStore();
  const { closeModal } = useNav();
  const client = db.clients.find((c) => c.id === m.plan.clientId);
  // Edytujemy kopię (draft) i zapisujemy całość na końcu.
  const [p, setP] = useState<Plan>(() => structuredClone(m.plan));
  // Rozwinięty tylko pierwszy tydzień — reszta na kliknięcie (długie plany).
  const [open, setOpen] = useState<Set<string>>(() => {
    const focus = m.focusWorkoutId && m.plan.weeks.find((w) => w.workouts.some((k) => k.id === m.focusWorkoutId));
    return new Set((focus ? [focus] : m.plan.weeks.slice(0, 1)).map((w) => w.id));
  });
  // poza planem: przy edycji jednego treningu pokazujemy tylko jego (reszta listy na żądanie)
  const [showAll, setShowAll] = useState(false);
  // ćwiczenia z rozwiniętym wyborem typu (cardio / na czas / na stronę)
  const [optsOpen, setOptsOpen] = useState<Set<string>>(new Set());
  const only = !!p.extra && !!m.focusWorkoutId && !showAll && p.weeks.some((w) => w.workouts.some((k) => k.id === m.focusWorkoutId));
  const extraCount = p.extra ? p.weeks.reduce((a, w) => a + w.workouts.length, 0) : 0;
  const isOpen = (id: string) => !!p.extra || open.has(id);
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
    const focused = clean.weeks.flatMap((w) => w.workouts).find((k) => k.id === m.focusWorkoutId);
    // przy błędzie zapisu edytor zostaje otwarty — zmiany nie przepadają
    if (await apply(savePlan(db, clean), clean.extra ? (only && focused ? `Zapisano „${focused.name}”${focused.date ? ` na ${fmtDay(focused.date)}` : ''}.` : 'Treningi poza planem zapisane.') : m.isNew ? 'Plan utworzony.' : 'Plan zapisany.')) closeModal();
  };

  const close = async () => {
    if (JSON.stringify(p) === JSON.stringify(m.plan) || (await ask('Zamknąć bez zapisywania zmian w planie?', { confirm: 'Zamknij' }))) closeModal();
  };

  return (
    <Modal wide title={p.extra ? (only ? 'Trening poza planem' : 'Treningi poza planem') : m.isNew ? 'Nowy plan' : 'Edycja planu'} onClose={close} onSubmit={save} submitLabel="Zapisz">
      {p.extra && (
        <p className="muted small">
          Poza planem — kolejność planu się nie zmienia. Z datą: podopieczny widzi trening na górze ekranu w tym dniu. Bez daty: na liście „poza planem”, do zrobienia w dowolnym momencie.
          {only && extraCount > 1 && (
            <>
              {' '}
              <button type="button" className="link" onClick={() => setShowAll(true)}>
                Pokaż wszystkie ({extraCount})
              </button>
            </>
          )}
        </p>
      )}
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
        Bieg: „🏃 + Bieg…” → własny (odcinki układasz sam) albo szablon do zmiany. Odcinek: czas (<code>40</code>, <code>3:00</code>) lub dystans (<code>800 m</code>), × powtórzeń, cel — strefa (<code>Z2</code>, <code>OWB1</code>), tempo (<code>5:30</code>, <code>5:20–5:40</code>), tętno (<code>140–150</code>) albo tempo startowe (<code>10K</code>, <code>HM</code>), przerwa po każdym (<code>2:00 trucht</code>, <code>200 m trucht</code>).
      </p>
      <RunTargetList />

      {p.weeks.map((week, wi) => (
        <section key={week.id} className="pe-week">
          {!p.extra && <div className="pe-week-head">
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
            {!p.extra && <select
              className="input input-sm dup-week"
              value=""
              aria-label="Duplikuj tydzień"
              onChange={(ev) => {
                const mode = ev.target.value as Progression;
                if (!mode) return;
                const name = nextWeekName(p.weeks, p.weeks[wi].name);
                const copy = cloneWeek(p.weeks[wi], name, mode);
                const same = JSON.stringify(cloneWeek(p.weeks[wi], name, 'none').workouts.map((k) => k.exercises.map((x) => x.groups))) === JSON.stringify(copy.workouts.map((k) => k.exercises.map((x) => x.groups)));
                if (mode !== 'none' && same) toast(mode === 'load2' || mode === 'load5' ? 'Ciężary w tym tygodniu liczą się z RPE / „−10%” — progresja ciężaru nic nie zmieniła. Użyj „+0,5 RPE” albo wpisz kg.' : 'Ta progresja nic nie zmieniła w tym tygodniu.');
                // „Tydzień N+1” na końcu planu; kopia bez numeru — zaraz za oryginałem
                upd((d) => void d.weeks.splice(name.endsWith('(kopia)') ? wi + 1 : d.weeks.length, 0, copy));
                setOpen((o) => new Set([...o, copy.id]));
              }}
            >
              <option value="">Duplikuj tydzień…</option>
              {PROGRESSIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {v === 'none' ? 'Kopia bez zmian' : `Kopia: ${l}`}
                </option>
              ))}
            </select>}
            <IconBtn
              icon="trash"
              label="Usuń tydzień"
              danger
              onClick={async () => {
                if (await ask(`Usunąć „${week.name}” z planu?`)) upd((d) => void d.weeks.splice(wi, 1));
              }}
            />
          </div>}

          {isOpen(week.id) && week.workouts.map((k, ki) => (only && k.id !== m.focusWorkoutId ? null :
            <div key={k.id} className="pe-workout card">
              <div className="pe-week-head">
                <input className="input pe-title" value={k.name} onChange={(e) => upd((d) => void (findWorkout(d, wi, ki).name = e.target.value))} aria-label="Nazwa jednostki" />
                {p.extra && (
                  <label className="pe-date pe-date-row" title="Podopieczny zobaczy ten trening na górze ekranu w wybranym dniu">
                    <span className="muted small">{k.date ? 'na dzień' : 'bez terminu · na dzień'}</span>
                    <input className="input input-sm" type="date" value={k.date ?? ''} onChange={(e) =>
                        upd((d) => {
                          const w = findWorkout(d, wi, ki);
                          w.date = e.target.value || undefined;
                          // nowy termin = nowe zadanie (wcześniejsze wykonania tego treningu się nie liczą)
                          w.assignedAt = w.date ? todayISO() : undefined;
                        })
                      } aria-label="Na dzień (puste = bez terminu)" />
                  </label>
                )}
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
                      <input className="input" list="lib-exercises" value={e.name} placeholder="Ćwiczenie" onChange={(ev) => setEx((x) => {
                        x.name = ev.target.value;
                        if (x.cardio == null && cardioByName(x.name) && x.rest === '2:00') x.rest = '';
                      })} aria-label="Ćwiczenie" />
                      {!(e.cardio ?? cardioByName(e.name)) || e.rest ? <><span className="muted small pe-rest-lbl">przerwa</span>
                      <input
                        className="input pe-rest"
                        value={e.rest ?? ''}
                        placeholder={inBlock && all[ei + 1]?.linked ? 'Przejście' : 'Przerwa'}
                        title={inBlock ? (all[ei + 1]?.linked ? 'Czas przejścia do następnego ćwiczenia bloku (puste = od razu)' : 'Przerwa po całej rundzie bloku') : 'Przerwa między seriami'}
                        onChange={(ev) => setEx((x) => void (x.rest = ev.target.value))} aria-label="Przerwa" /></> : <span className="grow" />}
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
                    {/* typ ćwiczenia schowany — na wierzchu tylko włączony */}
                    {!optsOpen.has(e.id) && (
                      <button type="button" className="link small ex-opts-btn" onClick={() => setOptsOpen((o) => new Set([...o, e.id]))}>
                        ⚙ Typ ćwiczenia
                      </button>
                    )}
                    {(optsOpen.has(e.id) || !!(e.cardio ?? cardioByName(e.name))) && <button type="button" className={`side-toggle ${e.cardio ?? cardioByName(e.name) ? 'on' : ''}`} aria-pressed={!!(e.cardio ?? cardioByName(e.name))} onClick={() => setEx((x) => {
                      x.cardio = !(x.cardio ?? cardioByName(x.name));
                      // bieg: przerwy są przy odcinkach — domyślne „2:00” siłowe by się wliczało
                      if (x.cardio && x.rest === '2:00') x.rest = '';
                    })}>
                      🫀 {e.cardio ?? cardioByName(e.name) ? 'Cardio / bieg — odcinki na czas lub dystans' : 'Cardio / bieg?'}
                    </button>}
{!(e.cardio ?? cardioByName(e.name)) && (optsOpen.has(e.id) || isTimed(e)) && (
                    <button
                      type="button"
                      className={`side-toggle ${isTimed(e) ? 'on' : ''}`}
                      aria-pressed={isTimed(e)}
                      onClick={() => setEx((x) => void (x.timed = !isTimed(x)))}
                      title="Ćwiczenie na czas (deska, wall sit, zwis): w kolumnie „Czas” sekundy, m:ss albo „2 min”"
                    >
                      ⏱ {isTimed(e) ? 'Na czas — w serii czas zamiast powtórzeń' : 'Na czas?'}
                    </button>
                    )}
{!(e.cardio ?? cardioByName(e.name)) && (optsOpen.has(e.id) || !!(e.perSide ?? perSideByName(e.name))) && (
                    <button type="button" className={`side-toggle ${e.perSide ?? perSideByName(e.name) ? 'on' : ''}`} aria-pressed={!!(e.perSide ?? perSideByName(e.name))} onClick={() => setEx((x) => void (x.perSide = !(x.perSide ?? perSideByName(x.name))))}>
                      ↔ {e.perSide ?? perSideByName(e.name) ? 'Powtórzenia na każdą stronę' : 'Na stronę? (jednostronne)'}
                    </button>
                    )}
                    {(() => {
                      const cardio = !!(e.cardio ?? cardioByName(e.name));
                      if (cardio) return <RunBuilder groups={e.groups} onChange={(gs) => setEx((x) => void (x.groups = gs))} profile={client?.run} dob={client?.dob} />;
                      return (
                    <div className="pe-sets">
                      <div className={`pe-set pe-set-head ${cardio ? 'cardio' : ''}`}>
                        <span>#</span>
                        <span>Typ</span>
                        <span>{cardio ? 'Czas (min / m:ss)' : isTimed(e) ? 'Czas (s / m:ss)' : 'Powt.'}</span>
                        <span>{cardio ? 'Dystans (km / m)' : 'Ciężar'}</span>
                        {cardio && <span title="Strefa (Z1–Z5, OWB1, BC2…) albo tempo min/km, np. 5:30">Strefa / tempo</span>}
                        <span>RPE</span>
                        <span />
                      </div>
                      {e.groups.map((g, gi) => (
                        <div key={gi} className={`pe-set ${cardio ? 'cardio' : ''} ${g.type === 'Rozgrzewka' || g.type === 'Schłodzenie' ? 'is-warmup' : ''}`}>
                          <span className="muted small">{gi + 1}</span>
                          <select className="input" value={g.type} onChange={(ev) => setEx((x) => void (x.groups[gi].type = ev.target.value as SetType))} aria-label="Typ serii">
                            {(cardio ? CARDIO_TYPES : SET_TYPES.filter((t) => t !== 'Schłodzenie' && t !== 'Przerwa')).map((t) => (
                              <option key={t} value={t}>
                                {cardio && t === 'Robocze' ? 'Odcinek' : t}
                              </option>
                            ))}
                          </select>
                          <input className="input" value={g.reps} placeholder={cardio ? 'np. 40 / 3:00' : isTimed(e) ? 'np. 45' : undefined} onChange={(ev) => setEx((x) => fillDown(x.groups, gi, 'reps', ev.target.value))} aria-label={cardio ? 'Czas' : 'Powtórzenia'} />
                          <input className="input" value={g.load} placeholder={cardio ? 'np. 800 m' : undefined} onChange={(ev) => setEx((x) => fillDown(x.groups, gi, 'load', ev.target.value))} aria-label={cardio ? 'Dystans' : 'Ciężar'} />
                          {cardio && <input className="input" list="run-zones" value={g.pace ?? ''} placeholder="Z2 / 5:30" onChange={(ev) => setEx((x) => void (x.groups[gi].pace = ev.target.value || undefined))} aria-label="Strefa albo tempo" />}
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
                        {cardio && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEx((x) => void x.groups.push({ ...newRow('Schłodzenie'), reps: '10', pace: 'Z1' }))}>
                            + schłodzenie
                          </button>
                        )}
                      </div>
                    </div>
                      );
                    })()}
                  </div>
                  </div>
                );
              })}
              <div className="actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => upd((d) => void findWorkout(d, wi, ki).exercises.push(newExercise()))}>
                  + Ćwiczenie
                </button>
                <select
                  className="input input-sm run-tpl-select"
                  value=""
                  aria-label="Dodaj bieg z szablonu"
                  onChange={(ev) => {
                    const v = ev.target.value;
                    const t = RUN_TEMPLATES.find((x) => x.id === v);
                    if (t || v === 'custom') upd((d) => void findWorkout(d, wi, ki).exercises.push(t ? t.make() : emptyRunExercise()));
                  }}
                >
                  <option value="">🏃 + Bieg…</option>
                  <option value="custom">Własny — ułożę odcinki</option>
                  {RUN_TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>
                      Szablon: {t.name} — {t.hint}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
          {isOpen(week.id) && !only && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => upd((d) => void d.weeks[wi].workouts.push({ id: uid(), name: p.extra ? `Trening dodatkowy ${extraCount + 1}` : `Trening ${String.fromCharCode(65 + d.weeks[wi].workouts.length)}`, exercises: [] }))}
            >
              {p.extra ? '+ Trening poza planem' : '+ Trening w tym tygodniu'}
            </button>
          )}
        </section>
      ))}
      {!p.extra && <button
        type="button"
        className="btn btn-secondary"
        onClick={() => {
          const id = uid();
          upd((d) => void d.weeks.push({ id, name: `Tydzień ${d.weeks.length + 1}`, workouts: [] }));
          setOpen((o) => new Set([...o, id]));
        }}
      >
        + Tydzień
      </button>}
    </Modal>
  );
}
