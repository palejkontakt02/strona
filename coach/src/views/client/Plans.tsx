import { downloadXlsx } from '../../lib/xlsxWrite';
import { planWorkbook, xlsxName } from '../../lib/excelExport';
import { fitowaWorkbook, templateWorkbook } from '../../lib/planTemplate';
import { Card, Empty, Field, Icon, IconBtn, Modal, Tag } from '../../components/ui';
import type { Client, Plan, PlanWorkout } from '../../domain';
import { printPlan } from '../../lib/print';
import { extraPlanOf, extraState, parallelPlansOf, plansOf, savePlan, scheduleWorkout, sessionsOf, workoutAppointment, type ExtraState } from '../../data/ops';
import { useState } from 'react';
import { del, put } from '../../data/db';
import { useStore } from '../../data/store';
import { fmtDate, fmtShort, plural, uid } from '../../format';
import { daysBetween, todayISO, weekStart } from '../../lib/dates';
import { isTemplate, nextMonday, planFromTemplate, templateFromPlan, templatesOf } from '../../lib/analytics';
import { doneInPass, nextDate, nextWorkout, planCompleted, planStatus, workoutDate } from '../../lib/plan';
import { MenuButton, useMedia, type MenuItem } from '../../components/MenuButton';
import { fmtWeekdayDate } from '../../lib/planGrid';
import { useNav } from '../../nav';
import { PlanTable, WorkoutTable } from '../../components/PlanTable';
import { AbsenceNotice, LoadSuggestPanel, QuickShift, ShiftPanel } from '../../components/PlanTools';
import { PlanImport } from '../../components/PlanImport';
import { PlanSheetSync } from '../../components/PlanSheetSync';
import { gsheetsEnabled } from '../../lib/gsheets';
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
  // kolejność: aktywny główny, aktywne równoległe (np. bieganie), potem reszta od ostatnio zmienianych
  const rank = (p: Plan) => (p.active ? (p.parallel ? 1 : 0) : 2);
  const plans = [...plansOf(db, client.id), ...parallelPlansOf(db, client.id, false)].sort((a, b) => rank(a) - rank(b) || (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  // plany zwinięte do nagłówka; rozwinięte zapamiętane na tym urządzeniu
  const openKey = `fitowa-plans-open-${client.id}`;
  const [openIds, setOpenIds] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(openKey) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const setOpen = (id: string, on: boolean) =>
    setOpenIds((cur) => {
      const n = new Set(cur);
      if (on) n.add(id);
      else n.delete(id);
      try {
        localStorage.setItem(openKey, JSON.stringify([...n]));
      } catch {
        // brak pamięci przeglądarki — tylko do odświeżenia
      }
      return n;
    });
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
  // „Termin” jednostki planu: dzień + godzina wizyty
  const [sched, setSched] = useState<{ plan: Plan; k: PlanWorkout; date: string; time: string; from?: string } | null>(null);
  const [importing, setImporting] = useState(false);
  /** Okno „Nowy plan”: od zera, z szablonu / od innego podopiecznego, z arkusza. */
  const [starting, setStarting] = useState(false);
  /** Plan, do którego wczytujemy zmiany z arkusza. */
  const [syncing, setSyncing] = useState<Plan | null>(null);
  /** Plan w oknie „Arkusz Google”. */
  const [gsPlan, setGsPlan] = useState<string | null>(null);
  const gs = gsheetsEnabled();
  const doneDated = extraWorkouts.filter((k) => states.get(k.id)!.state === 'done');
  const visibleExtra = extraWorkouts
    .filter((k) => showDone || states.get(k.id)!.state !== 'done')
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));

  const removeExtra = async (id: string, name: string) => {
    if (!extra || !(await ask(`Usunąć „${name}” z dodatkowych treningów? Zapisane wcześniej treningi zostają w historii.`, { confirm: 'Usuń trening' }))) return;
    await apply(savePlan(db, { ...extra, weeks: extra.weeks.map((w) => ({ ...w, workouts: w.workouts.filter((k) => k.id !== id) })) }), `Usunięto „${name}”.`);
  };

  const activePlan = plans.find((x) => x.active && !x.extra && !x.parallel);
  const phone = useMedia('(max-width: 640px)');

  // kolejny blok: start od poniedziałku po końcu tego planu, nieaktywny do czasu „Ustaw aktywny”
  const dupPlan = (p: Plan) => {
    const b = nextBlock(p);
    void apply(savePlan(db, b), `Utworzono „${b.name}”${b.startDate ? `, włączy się sam ${fmtDate(b.startDate)}` : ''}.`);
  };
  const saveTemplate = (p: Plan) => {
    const taken = templatesOf(db.plans).some((t) => t.name === p.name);
    void apply([put('plans', templateFromPlan(p, taken ? `${p.name} (${fmtDate(todayISO())})` : p.name))], `Zapisano szablon „${p.name}”.`);
  };
  const removePlan = async (p: Plan) => {
    if (await ask(`Usunąć plan „${p.name}”? Zapisane treningi zostaną.`)) await apply([del('plans', p.id)], 'Plan usunięty.');
  };
  // zakończony plan → kolejny blok od najbliższego poniedziałku, od razu aktywny (z cofnięciem)
  const nextBlockNow = async (p: Plan) => {
    const b: Plan = { ...nextBlock(p, today), active: true };
    if (!(await apply(savePlan(db, b)))) return;
    toast(`Utworzono „${b.name}”${b.startDate ? `, start ${fmtDate(b.startDate)}` : ''}. Teraz to plan aktywny.`, {
      label: 'Cofnij',
      run: () => void apply([del('plans', b.id), put('plans', p)], 'Cofnięto nowy blok.'),
    });
  };
  // ten sam plan od nowa: cały plan przesunięty o pełne tygodnie na najbliższy poniedziałek (z cofnięciem)
  const restartDates = async (p: Plan) => {
    const first = planDates(p).map((x) => x.date).sort()[0];
    // w poniedziałek — od dziś, inaczej od najbliższego poniedziałku
    const target = weekStart(today) === today ? today : nextMonday(today);
    const days = p.startDate ? daysBetween(weekStart(p.startDate), target) : 0;
    if (!first || days <= 0) return openModal({ kind: 'plan', plan: p });
    const moved = { ...shiftPlanFrom(p, first, days), passFrom: today };
    const firstK = p.weeks[0]?.workouts[0];
    if (!(await ask(`Plan „${p.name}” od nowa: ${p.weeks[0]?.name ?? 'Tydzień 1'}${firstK ? ` · ${firstK.name}` : ''} od ${fmtDate(moved.startDate ?? target)}, kolejne tygodnie co 7 dni. Dotychczasowe treningi zostają w historii, ale nie odhaczają jednostek nowego przejścia.`, { confirm: 'Zacznij od nowa', danger: false }))) return;
    if (!(await apply(savePlan(db, moved)))) return;
    toast(`Plan „${p.name}” zaczyna się od nowa ${fmtDate(moved.startDate ?? target)}.`, {
      label: 'Cofnij',
      run: () => void apply([put('plans', p)], 'Cofnięto zmianę dat.'),
    });
  };

  // menu „Eksport i import”: druk, pliki i arkusz tego planu
  const exportItems = (p: Plan): MenuItem[] => [
    { icon: 'print', text: 'Drukuj', run: () => printPlan(p, client, sessions) },
    ...(p.active ? [{ icon: 'print', text: 'Drukuj następny tydzień', hint: 'z pustą kolumną „Zrobiono”', run: () => printPlan(p, client, sessions, { nextWeek: true }) }] : []),
    { icon: 'download', text: 'Excel (.xlsx)', hint: 'plan i wykonanie, arkusz do importu', run: () => void downloadXlsx(xlsxName('plan', p.name), planWorkbook(p, client, sessions)) },
    { icon: 'download', text: 'Arkusz Fitowa (.xlsx)', hint: 'wzór Fitowa z kolumną „Wykonano”, bieganie w układzie biegowym', run: () => void downloadXlsx(xlsxName('plan', p.name, 'fitowa'), fitowaWorkbook([p], client, sessions)) },
    { icon: 'download', text: 'Do edycji (szablon .xlsx)', hint: 'zmień w arkuszu i wczytaj z powrotem', run: () => void downloadXlsx(xlsxName('plan', p.name, 'do-edycji'), templateWorkbook(p, client)) },
    { icon: 'download', text: 'CSV', run: () => downloadCsv(csvFileName(p), planToCsv(p)) },
    ...(gs ? [{ icon: 'link', text: p.gsheet ? 'Arkusz Google' : 'Do Arkuszy Google', run: () => setGsPlan(p.id) }] : []),
    { icon: 'up', text: 'Wczytaj zmiany z arkusza', hint: 'Excel albo CSV tego planu, z podglądem', run: () => setSyncing(p) },
  ];
  // rzadkie akcje pod „⋯”
  const rareItems = (p: Plan): MenuItem[] => [
    { icon: 'copy', text: `Duplikuj jako „${nextBlockName(p.name)}”`, run: () => dupPlan(p) },
    { icon: 'lib', text: 'Zapisz jako szablon', run: () => saveTemplate(p) },
    { icon: 'trash', text: 'Usuń plan', run: () => void removePlan(p), danger: true },
  ];

  return (
    <>
      <div className="toolbar">
        <h3>Plany treningowe</h3>
        <div className="actions">
          <button className="btn btn-secondary" onClick={() => setStarting(true)} aria-haspopup="dialog">
            <Icon name="plus" size={16} /> Nowy plan
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
          const isOpen = openIds.has(p.id) || shift?.planId === p.id;
          return (
            <Card
              key={p.id}
              className={`plan-card ${p.active ? 'is-active' : ''} ${isOpen ? 'is-open' : 'is-closed'}`}
              title={
                <button type="button" className="pl-toggle" aria-expanded={isOpen} onClick={() => setOpen(p.id, !isOpen)} title={isOpen ? 'Zwiń plan' : 'Rozwiń plan'}>
                  <Icon name={isOpen ? 'chevU' : 'chevD'} size={16} />
                  <span>
                    {p.name} {p.active && <Tag tone="accent">Aktywny</Tag>} {p.parallel && <Tag>Równoległy</Tag>}
                  </span>
                </button>
              }
              action={
                <div className="actions pl-actions">
                  {!p.active && (
                    <button className="btn btn-ghost btn-sm" onClick={() => apply(savePlan(db, { ...p, active: true }), p.parallel ? 'Plan równoległy włączony. Główny plan działa dalej.' : 'Plan ustawiony jako aktywny.')}>
                      {p.parallel ? 'Włącz' : 'Ustaw aktywny'}
                    </button>
                  )}
                  {p.active && p.parallel && (
                    <button className="btn btn-ghost btn-sm" onClick={() => apply(savePlan(db, { ...p, active: false }), 'Plan równoległy wyłączony.')}>
                      Wyłącz
                    </button>
                  )}
                  <button className="btn btn-ghost btn-sm pl-edit" aria-label="Edytuj plan" onClick={() => openModal({ kind: 'plan', plan: p })}>
                    <Icon name="edit" size={16} /> <span className="pl-btn-text">Edytuj</span>
                  </button>
                  {p.active && (
                    <button className="btn btn-ghost btn-sm" aria-expanded={shift?.planId === p.id} onClick={() => setShift(shift?.planId === p.id ? null : { planId: p.id })} title="Przesuń daty jednostek od wybranego dnia (np. choroba, urlop)">
                      <Icon name="cal" size={16} /> Przesuń plan
                    </button>
                  )}
                  {/* komputer: „Eksport i import” + „⋯”; telefon: wszystko w jednym arkuszu „⋯” */}
                  {!phone && (
                    <MenuButton label="Eksport i import" items={exportItems(p)}>
                      <Icon name="download" size={16} /> Eksport i import <Icon name="chevD" size={14} />
                    </MenuButton>
                  )}
                  <MenuButton label="Więcej akcji planu" title={p.name} items={phone ? [...exportItems(p), ...rareItems(p)] : rareItems(p)} className="icon-btn pl-more" />
                </div>
              }
            >
              <p className="muted small">
                {p.startDate && `Start ${fmtDate(p.startDate)} · `}
                {p.weeks.length} tyg. · {(() => { const n = p.weeks.reduce((a, w) => a + w.workouts.length, 0); return `${n} ${plural(n, 'jednostka', 'jednostki', 'jednostek')}`; })()}
                {nx && p.active && (planCompleted(p, sessions) ? ' · plan ukończony, wszystkie jednostki zrobione' : (() => {
                  // ten sam opis co u podopiecznego: zaległy termin z planu i najbliższy dzień, kiedy go zrobić
                  const orig = workoutDate(p, p.weeks.indexOf(nx.week), nx.workout);
                  const late = orig && orig < today && (!p.startDate || orig >= p.startDate) && !sessions.some((s) => s.planId === p.id && s.date >= orig);
                  const mv = nx.workout.moved?.by === 'client' ? ` (przeniósł podopieczny${nx.workout.moved.from ? ` z ${fmtShort(nx.workout.moved.from)}` : ''})` : '';
                  return ` · następny: ${nx.workout.name} (${nx.week.name})${late ? ` · zaległy z ${fmtShort(orig)}` : ''}${nd ? ` · ${late ? 'najbliżej ' : ''}${fmtWeekdayDate(nd)}` : ''}${mv}`;
                })())}
                {!p.active && p.autoStart && p.startDate && ` · włączy się sam ${fmtDate(p.startDate)}`}
              </p>
              {st?.ended && st.endDate && (
                <div className="warn-box pl-ended" role="status">
                  <Icon name="alert" size={16} />
                  <span className="pl-ended-text">
                    Plan skończył się {fmtShort(st.endDate)}. {plans.some((x) => !x.active && !x.extra && !!x.parallel === !!p.parallel && x.startDate && x.startDate > (p.startDate ?? '')) ? 'Kolejny blok czeka.' : 'Zaplanuj kolejny blok.'}
                    {nx && <span className="muted small"> Następny w kolejce: {nx.workout.name} ({nx.week.name}).</span>}
                  </span>
                  <span className="pl-ended-actions">
                    {(() => {
                      // przygotowany już kolejny blok — włączamy jego, zamiast robić drugą kopię
                      const prepared = plans.filter((x) => !x.active && !x.extra && !!x.parallel === !!p.parallel && x.startDate && x.startDate > (p.startDate ?? '')).sort((a, b) => a.startDate!.localeCompare(b.startDate!))[0];
                      return prepared ? (
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void apply(savePlan(db, { ...prepared, active: true }), `„${prepared.name}” jest teraz aktywny.`)} title={`Przygotowany blok „${prepared.name}” (start ${fmtDate(prepared.startDate!)})`}>
                          Włącz „{prepared.name}”
                        </button>
                      ) : (
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void nextBlockNow(p)} title="Kopia planu jako kolejny blok od najbliższego poniedziałku, od razu aktywna">
                          Następny blok
                        </button>
                      );
                    })()}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void restartDates(p)} title="Ten sam plan jeszcze raz od tygodnia 1, od najbliższego poniedziałku (z cofnięciem)">
                      Ustaw daty od nowa
                    </button>
                  </span>
                </div>
              )}
              {isOpen && p.notes && <p className="small pre">{p.notes}</p>}
              {isOpen && p.active && <AbsenceNotice client={client} plan={p} sessions={sessions} onShift={(from, days) => setShift({ planId: p.id, preset: { from, days } })} />}
              {p.active && shift?.planId === p.id && <ShiftPanel key={JSON.stringify(shift.preset ?? null)} plan={p} sessions={sessions} preset={shift.preset} onClose={() => setShift(null)} />}
              {isOpen && p.active && <LoadSuggestPanel plan={p} sessions={sessions} />}
              {isOpen && (
                <PlanTable
                  plan={p}
                  done={done}
                  sessions={sessions}
                  nextId={nx?.workout.id}
                  nextDate={nd}
                  profile={client.run}
                  dob={client.dob}
                  nextExtra={<QuickShift plan={p} sessions={sessions} />}
                  onLive={(id) => startLive(client.id, undefined, undefined, { planId: p.id, workoutId: id })}
                  onAthlete={(id) => startAthlete(client.id, { planId: p.id, workoutId: id })}
                  apptTime={(id) => workoutAppointment(db, p.id, id)?.time}
                  onSchedule={(k, date) => {
                    const a = workoutAppointment(db, p.id, k.id);
                    // podpowiedź godziny: wizyta tego dnia, inaczej ostatnia godzina wizyty tego podopiecznego
                    const last = db.appointments.filter((x) => x.clientId === client.id && x.time).sort((x, y) => (y.date + y.time).localeCompare(x.date + x.time))[0];
                    setSched({ plan: p, k, date: a?.date ?? date ?? todayISO(), time: a?.time ?? last?.time ?? '', from: date });
                  }}
                />
              )}
            </Card>
          );
        })}
      </div>
      {sched && (
        <Modal
          title={`Termin: ${sched.k.name}`}
          onClose={() => setSched(null)}
          submitLabel="Zapisz termin"
          onSubmit={async () => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(sched.date)) return toast('Wybierz dzień.');
            if (sched.time && !/^\d{1,2}:\d{2}$/.test(sched.time)) return toast('Godzina, np. 18:00.');
            const ok = await apply(scheduleWorkout(db, sched.plan, sched.k.id, sched.date, sched.time, sched.from), `„${sched.k.name}”: ${fmtWeekdayDate(sched.date)}${sched.time ? `, ${sched.time.padStart(5, '0')}` : ''}${sched.time ? ' · wizyta w kalendarzu' : ''}.`);
            if (ok) setSched(null);
          }}
        >
          <p className="small muted">Z godziną powstaje też wizyta w kalendarzu.</p>
          <div className="form-grid">
            <Field label="Dzień">
              <input className="input" type="date" value={sched.date} onChange={(e) => setSched({ ...sched, date: e.target.value })} aria-label="Dzień treningu" />
            </Field>
            <Field label="Godzina (wizyta)" hint="puste: bez wizyty">
              <input className="input" type="time" value={sched.time} onChange={(e) => setSched({ ...sched, time: e.target.value })} aria-label="Godzina treningu" />
            </Field>
          </div>
        </Modal>
      )}
      {starting && (
        <NewPlanStart
          client={client}
          first={plans.length === 0}
          onClose={() => setStarting(false)}
          onImport={() => (setStarting(false), setImporting(true))}
        />
      )}
      {gsPlan && plans.some((x) => x.id === gsPlan) && <PlanSheetSync plan={plans.find((x) => x.id === gsPlan)!} client={client} onClose={() => setGsPlan(null)} />}
      {syncing && (
        <PlanImport
          clientId={client.id}
          active={syncing.active}
          target={syncing}
          onClose={() => setSyncing(null)}
          onDone={(plan) => {
            setSyncing(null);
            void apply([put('plans', plan)], `Zaktualizowano „${plan.name}” z arkusza.`);
          }}
        />
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
            <button className="btn btn-secondary btn-sm" onClick={addExtra}>
              + Zadaj trening
            </button>
          </div>
        }
      >
        {extraWorkouts.length === 0 ? (
          <p className="muted small">Na konkretny dzień albo bez terminu. Plan zostaje bez zmian.</p>
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
                      <button className="btn btn-secondary btn-sm" onClick={() => startLive(client.id, undefined, undefined, { planId: extra!.id, workoutId: k.id })}>
                        <Icon name="play" size={14} /> Prowadź
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => startAthlete(client.id, { planId: extra!.id, workoutId: k.id })}>
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
  if (st.state === 'done') return <Tag tone="ok"><Icon name="check" size={12} /> wykonany {fmtDate(st.date!)}</Tag>;
  if (st.state === 'overdue') return <Tag tone="warn">zaległy · był na {fmtDate(st.date!)}</Tag>;
  if (st.state === 'due') return <Tag tone="accent">na {fmtDate(st.date!)}</Tag>;
  return <Tag tone="muted">bez terminu{st.date ? ` · ostatnio ${fmtDate(st.date)}` : ''}</Tag>;
}

/**
 * Start nowego planu w jednym oknie: od zera (edytor), z szablonu albo od innego podopiecznego (kopia od najbliższego
 * poniedziałku, oryginał bez zmian), z arkusza (import z podglądem; tu też pusty szablon do pobrania).
 */
function NewPlanStart({ client, first, onClose, onImport }: { client: Client; first: boolean; onClose: () => void; onImport: () => void }) {
  const { db, apply } = useStore();
  const { openModal } = useNav();
  const [mode, setMode] = useState<'copy' | null>(null);
  const [src, setSrc] = useState('');
  const tpls = templatesOf(db.plans);
  const who = (x: Plan) => db.clients.find((c) => c.id === x.clientId)?.name ?? '';
  const others = db.plans
    .filter((x) => x.clientId !== client.id && !x.extra && !isTemplate(x) && db.clients.some((c) => c.id === x.clientId))
    .sort((a, b) => who(a).localeCompare(who(b), 'pl') || a.name.localeCompare(b.name, 'pl'));
  const canCopy = tpls.length + others.length > 0;
  const create = async () => {
    const t = tpls.find((x) => x.id === src);
    const o = others.find((x) => x.id === src);
    const from = t ?? o;
    if (!from) return;
    // start od najbliższego poniedziałku (nie data innego podopiecznego); daty jednostek przesunięte o tyle samo
    const msg = t ? `Plan „${from.name}” z szablonu, start ${fmtDate(nextMonday(todayISO()))}. Możesz go dopasować.` : `Skopiowano plan „${from.name}”. Możesz go dopasować.`;
    if (await apply(savePlan(db, planFromTemplate(from, client.id, todayISO(), first)), msg)) onClose();
  };
  return (
    <Modal title="Nowy plan" onClose={onClose} onSubmit={mode === 'copy' ? () => void create() : undefined} submitLabel="Utwórz plan">
      <div className="start-tiles" role="group" aria-label="Z czego plan">
        <button type="button" className="start-tile" onClick={() => (onClose(), openModal({ kind: 'plan', plan: newPlan(client.id), isNew: true }))}>
          <Icon name="plus" size={20} />
          <b>Od zera</b>
          <span className="start-tile-hint">pusty tydzień 1, ćwiczenia ułożysz w edytorze</span>
        </button>
        <button type="button" className={`start-tile ${mode === 'copy' ? 'on' : ''}`} aria-pressed={mode === 'copy'} disabled={!canCopy} onClick={() => setMode(mode === 'copy' ? null : 'copy')}>
          <Icon name="copy" size={20} />
          <b>Z szablonu lub od innego podopiecznego</b>
          <span className="start-tile-hint">{canCopy ? 'kopia od najbliższego poniedziałku, oryginał bez zmian' : 'brak szablonów i planów innych osób'}</span>
        </button>
        <div className="start-tile start-tile-split">
          <button type="button" className="start-tile-main" onClick={onImport}>
            <Icon name="up" size={20} />
            <b>Z arkusza</b>
            <span className="start-tile-hint">wklej zakres z Excela lub Arkuszy Google albo wybierz plik</span>
          </button>
          <button type="button" className="link small start-tile-link" onClick={() => void downloadXlsx('szablon-planu-fitowa.xlsx', templateWorkbook(null))}>
            <Icon name="download" size={14} /> Pobierz pusty szablon
          </button>
        </div>
      </div>
      {mode === 'copy' && (
        <Field label="Plan źródłowy" wide>
          <select className="input" value={src} onChange={(e) => setSrc(e.target.value)} aria-label="Plan źródłowy" autoFocus required>
            <option value="">Wybierz plan…</option>
            {tpls.length > 0 && (
              <optgroup label="Szablony">
                {tpls.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} · {x.weeks.length} tyg.
                  </option>
                ))}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label="Plany innych podopiecznych">
                {others.map((x) => (
                  <option key={x.id} value={x.id}>
                    {who(x)}: {x.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>
      )}
    </Modal>
  );
}
