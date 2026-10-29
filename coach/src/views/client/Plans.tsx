import { Card, Empty, Icon, IconBtn, Tag } from '../../components/ui';
import type { Client, Plan } from '../../domain';
import { printPlan } from '../../lib/print';
import { extraPlanOf, extraState, plansOf, savePlan, sessionsOf, type ExtraState } from '../../data/ops';
import { useState } from 'react';
import { del, put } from '../../data/db';
import { useStore } from '../../data/store';
import { fmtDate, fmtShort, plural, uid } from '../../format';
import { daysBetween, todayISO, weekStart } from '../../lib/dates';
import { isTemplate, nextMonday, planFromTemplate, templateFromPlan, templatesOf } from '../../lib/analytics';
import { doneInPass, nextDate, nextWorkout, planStatus } from '../../lib/plan';
import { Sheet } from '../../components/Sheet';
import { fmtWeekdayDate } from '../../lib/planGrid';
import { useNav } from '../../nav';
import { PlanTable, WorkoutTable } from '../../components/PlanTable';
import { AbsenceNotice, LoadSuggestPanel, QuickShift, ShiftPanel } from '../../components/PlanTools';
import { PlanImport } from '../../components/PlanImport';
import { nextBlock, nextBlockName, planDates, shiftPlanFrom } from '../../lib/planShift';
import { csvFileName, planToCsv } from '../../lib/sheetImport';

/** Plik CSV do pobrania (eksport planu). */
function downloadCsv(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const { db, apply, ask, toast } = useStore();
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
  // „Przesuń plan” (id planu + ewentualnie gotowe ustawienia z nieobecności) i import z arkusza
  const [shift, setShift] = useState<{ planId: string; preset?: { from: string; days: number } } | null>(null);
  const [importing, setImporting] = useState(false);
  const doneDated = extraWorkouts.filter((k) => states.get(k.id)!.state === 'done');
  const visibleExtra = extraWorkouts
    .filter((k) => showDone || states.get(k.id)!.state !== 'done')
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));

  const removeExtra = async (id: string, name: string) => {
    if (!extra || !(await ask(`Usunąć „${name}” z dodatkowych treningów? Zapisane wcześniej treningi zostają w historii.`, { confirm: 'Usuń trening' }))) return;
    await apply(savePlan(db, { ...extra, weeks: extra.weeks.map((w) => ({ ...w, workouts: w.workouts.filter((k) => k.id !== id) })) }), `Usunięto „${name}”.`);
  };

  const activePlan = plans.find((x) => x.active && !x.extra);
  const [menu, setMenu] = useState<string | null>(null);
  const menuPlan = plans.find((x) => x.id === menu);

  // kolejny blok: start od poniedziałku po końcu tego planu, nieaktywny do czasu „Ustaw aktywny”
  const dupPlan = (p: Plan) => {
    const b = nextBlock(p);
    void apply(savePlan(db, b), `Utworzono „${b.name}”${b.startDate ? ` — start ${fmtDate(b.startDate)}` : ''}. Plan jest nieaktywny — „Ustaw aktywny”, gdy zacznie się blok.`);
  };
  const saveTemplate = (p: Plan) => {
    const taken = templatesOf(db.plans).some((t) => t.name === p.name);
    void apply([put('plans', templateFromPlan(p, taken ? `${p.name} (${fmtDate(todayISO())})` : p.name))], `Zapisano szablon „${p.name}” — znajdziesz go w „Nowy plan z szablonu…” i w Ćwiczeniach.`);
  };
  const removePlan = async (p: Plan) => {
    if (await ask(`Usunąć plan „${p.name}”? Zapisane treningi zostaną.`)) await apply([del('plans', p.id)], 'Plan usunięty.');
  };
  // zakończony plan → kolejny blok od najbliższego poniedziałku, od razu aktywny (z cofnięciem)
  const nextBlockNow = async (p: Plan) => {
    const b: Plan = { ...nextBlock(p, today), active: true };
    if (!(await apply(savePlan(db, b)))) return;
    toast(`Utworzono „${b.name}”${b.startDate ? ` — start ${fmtDate(b.startDate)}` : ''}. Teraz to plan aktywny.`, {
      label: 'Cofnij',
      run: () => void apply([del('plans', b.id), put('plans', p)], 'Cofnięto nowy blok.'),
    });
  };
  // ten sam plan od nowa: cały plan przesunięty o pełne tygodnie na najbliższy poniedziałek (z cofnięciem)
  const restartDates = async (p: Plan) => {
    const first = planDates(p).map((x) => x.date).sort()[0];
    const days = p.startDate ? daysBetween(weekStart(p.startDate), nextMonday(today)) : 0;
    if (!first || days <= 0) return openModal({ kind: 'plan', plan: p });
    const moved = shiftPlanFrom(p, first, days);
    if (!(await apply(savePlan(db, moved)))) return;
    toast(`Plan „${p.name}” zaczyna się od nowa ${fmtDate(moved.startDate ?? nextMonday(today))}.`, {
      label: 'Cofnij',
      run: () => void apply([put('plans', p)], 'Cofnięto zmianę dat.'),
    });
  };

  return (
    <>
      <div className="toolbar">
        <h3>Plany treningowe</h3>
        <div className="actions">
          {(() => {
            // plan z szablonu: start od najbliższego poniedziałku, szablon bez zmian
            const tpls = templatesOf(db.plans);
            if (!tpls.length) return null;
            return (
              <select
                className="input input-sm plan-src-select"
                value=""
                aria-label="Nowy plan z szablonu"
                onChange={(e) => {
                  const src = tpls.find((x) => x.id === e.target.value);
                  if (!src) return;
                  void apply(savePlan(db, planFromTemplate(src, client.id, todayISO(), plans.length === 0)), `Plan „${src.name}” z szablonu — start ${fmtDate(nextMonday(todayISO()))}. Możesz go dopasować.`);
                }}
              >
                <option value="">Nowy plan z szablonu…</option>
                {tpls.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} · {x.weeks.length} tyg.
                  </option>
                ))}
              </select>
            );
          })()}
          {(() => {
            // gotowy plan innego podopiecznego jako szablon (kopia — oryginał zostaje bez zmian)
            const who = (x: Plan) => db.clients.find((c) => c.id === x.clientId)?.name ?? '';
            const others = db.plans.filter((x) => x.clientId !== client.id && !x.extra && !isTemplate(x) && db.clients.some((c) => c.id === x.clientId)).sort((a, b) => who(a).localeCompare(who(b), 'pl') || a.name.localeCompare(b.name, 'pl'));
            if (!others.length) return null;
            return (
              <select
                className="input input-sm plan-src-select"
                value=""
                aria-label="Skopiuj plan od innego podopiecznego"
                onChange={(e) => {
                  const src = others.find((x) => x.id === e.target.value);
                  if (!src) return;
                  // start od najbliższego poniedziałku (nie data innego podopiecznego); daty jednostek przesunięte o tyle samo
                  void apply(savePlan(db, planFromTemplate(src, client.id, todayISO(), plans.length === 0)), `Skopiowano plan „${src.name}” — możesz go dopasować.`);
                }}
              >
                <option value="">Plan od innego podopiecznego…</option>
                {others.map((x) => (
                  <option key={x.id} value={x.id}>
                    {who(x)} — {x.name}
                  </option>
                ))}
              </select>
            );
          })()}
          <button className="btn btn-secondary pl-import-btn" onClick={() => setImporting(true)} title="Wklej zakres z Excela / Arkuszy Google albo wybierz plik CSV / XLSX">
            <Icon name="download" size={16} /> Import z arkusza
          </button>
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
          const st = p.active && !p.extra ? planStatus(p, today) : null;
          const nd = nx && p.active ? nextDate(p, nx, today) : undefined;
          return (
            <Card
              key={p.id}
              className={`plan-card ${p.active ? 'is-active' : ''}`}
              title={
                <>
                  {p.name} {p.active && <Tag tone="accent">Aktywny</Tag>}
                </>
              }
              action={
                <div className="actions pl-actions">
                  {!p.active && (
                    <button className="btn btn-ghost btn-sm" onClick={() => apply(savePlan(db, { ...p, active: true }), 'Plan ustawiony jako aktywny.')}>
                      Ustaw aktywny
                    </button>
                  )}
                  <IconBtn icon="edit" label="Edytuj plan" onClick={() => openModal({ kind: 'plan', plan: p })} />
                  {p.active && (
                    <button className="btn btn-ghost btn-sm" aria-expanded={shift?.planId === p.id} onClick={() => setShift(shift?.planId === p.id ? null : { planId: p.id })} title="Przesuń daty jednostek od wybranego dnia (np. choroba, urlop)">
                      <Icon name="cal" size={16} /> Przesuń plan
                    </button>
                  )}
                  {/* rzadsze akcje: na komputerze w rzędzie, na telefonie w arkuszu „⋯” */}
                  <span className="pl-rare">
                    <IconBtn icon="copy" label="Duplikuj plan" onClick={() => dupPlan(p)} />
                    <button className="btn btn-ghost btn-sm" title="Kopia planu do biblioteki szablonów — przypiszesz ją innym podopiecznym" onClick={() => saveTemplate(p)}>
                      Zapisz jako szablon
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => printPlan(p, client, sessions)} title="Drukuj albo zapisz jako PDF">
                      <Icon name="print" size={16} /> Drukuj
                    </button>
                    {p.active && (
                      <button className="btn btn-ghost btn-sm" onClick={() => printPlan(p, client, sessions, { nextWeek: true })} title="Tylko tydzień następnej jednostki, z pustą kolumną „Zrobiono” do wpisania wykonania">
                        <Icon name="print" size={16} /> Następny tydzień
                      </button>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => downloadCsv(csvFileName(p), planToCsv(p))} title="Plik CSV do Excela / Arkuszy Google (średnik, przecinek dziesiętny) — da się go wczytać z powrotem">
                      <Icon name="download" size={16} /> CSV
                    </button>
                    <IconBtn icon="trash" label="Usuń plan" danger onClick={() => void removePlan(p)} />
                  </span>
                  <button type="button" className="icon-btn pl-more" aria-label="Więcej akcji planu" title="Więcej: duplikuj, szablon, druk, CSV, usuń" aria-haspopup="dialog" onClick={() => setMenu(p.id)}>
                    <Icon name="more" size={18} />
                  </button>
                </div>
              }
            >
              <p className="muted small">
                {p.startDate && `Start ${fmtDate(p.startDate)} · `}
                {p.weeks.length} tyg. · {(() => { const n = p.weeks.reduce((a, w) => a + w.workouts.length, 0); return `${n} ${plural(n, 'jednostka', 'jednostki', 'jednostek')}`; })()}
                {nx && p.active && ` · następny: ${nx.workout.name} (${nx.week.name})${nd ? ` · ${fmtWeekdayDate(nd)}` : ''}`}
              </p>
              {st?.ended && st.endDate && (
                <div className="warn-box pl-ended" role="status">
                  <Icon name="alert" size={16} />
                  <span className="pl-ended-text">
                    Plan zakończył się {fmtShort(st.endDate)} — zaplanuj kolejny blok.
                    {st.cycle > 1 && <span className="muted small"> Podopieczny robi go teraz od nowa (przejście {st.cycle}).</span>}
                  </span>
                  <span className="pl-ended-actions">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void nextBlockNow(p)} title="Kopia planu jako kolejny blok od najbliższego poniedziałku — od razu aktywna">
                      Następny blok
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void restartDates(p)} title="Ten sam plan od najbliższego poniedziałku (podgląd przed zapisem)">
                      Ustaw daty od nowa
                    </button>
                  </span>
                </div>
              )}
              {p.notes && <p className="small pre">{p.notes}</p>}
              {p.active && <AbsenceNotice client={client} plan={p} sessions={sessions} onShift={(from, days) => setShift({ planId: p.id, preset: { from, days } })} />}
              {p.active && shift?.planId === p.id && <ShiftPanel key={JSON.stringify(shift.preset ?? null)} plan={p} sessions={sessions} preset={shift.preset} onClose={() => setShift(null)} />}
              {p.active && <LoadSuggestPanel plan={p} sessions={sessions} />}
              {p.active && (
                <PlanTable
                  plan={p}
                  done={done}
                  nextId={nx?.workout.id}
                  nextDate={nd}
                  profile={client.run}
                  dob={client.dob}
                  nextExtra={<QuickShift plan={p} sessions={sessions} />}
                  onLive={(id) => startLive(client.id, undefined, undefined, { planId: p.id, workoutId: id })}
                  onAthlete={(id) => startAthlete(client.id, { planId: p.id, workoutId: id })}
                />
              )}
            </Card>
          );
        })}
      </div>
      {menuPlan && (
        <Sheet label={`Plan „${menuPlan.name}” — więcej`} onClose={() => setMenu(null)}>
          <strong className="pl-sheet-title">{menuPlan.name}</strong>
          <div className="pl-sheet-list">
            {[
              { icon: 'copy', text: `Duplikuj jako „${nextBlockName(menuPlan.name)}”`, run: () => dupPlan(menuPlan) },
              { icon: 'lib', text: 'Zapisz jako szablon', run: () => saveTemplate(menuPlan) },
              { icon: 'print', text: 'Drukuj', run: () => printPlan(menuPlan, client, sessions) },
              ...(menuPlan.active ? [{ icon: 'print', text: 'Drukuj tylko następny tydzień', run: () => printPlan(menuPlan, client, sessions, { nextWeek: true }) }] : []),
              { icon: 'download', text: 'CSV', run: () => downloadCsv(csvFileName(menuPlan), planToCsv(menuPlan)) },
              { icon: 'download', text: 'Import z arkusza', run: () => setImporting(true) },
              { icon: 'trash', text: 'Usuń plan', run: () => void removePlan(menuPlan), danger: true },
            ].map((a) => (
              <button
                key={a.text}
                type="button"
                className={`btn btn-ghost pl-sheet-btn ${a.danger ? 'is-danger' : ''}`}
                onClick={() => {
                  setMenu(null);
                  a.run();
                }}
              >
                <Icon name={a.icon} size={18} /> {a.text}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {importing && (
        <PlanImport
          clientId={client.id}
          active={!activePlan || !!planStatus(activePlan, today).ended}
          onClose={() => setImporting(false)}
          onDone={(plan) => {
            setImporting(false);
            openModal({ kind: 'plan', plan, isNew: true });
          }}
        />
      )}
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
