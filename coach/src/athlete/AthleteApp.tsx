import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LineChart, WeightTrendChart } from '../components/charts';
import { weightTrend, weightTrendText } from '../lib/progress';
import { Icon } from '../components/ui';
import { Sheet } from '../components/Sheet';
import { PalettePicker } from '../components/PalettePicker';
import { PushSettings } from '../components/PushSettings';
import { OfflineBadge } from '../components/OfflineBadge';
import type { Checkin, Client, Measurement, Plan, PlanWorkout, TrainingSession, Wellness } from '../domain';
import { dropUnsavedVideos } from '../data/videos';
import { allMeasurements, clientById, deleteSession, extraPlanOf, extraState, undoSession, paymentLabel, plansOf, sessionPayment, sessionsOf } from '../data/ops';
import { useStore } from '../data/store';
import { del, put } from '../data/db';
import { fmtDay, fmtLong, fmtMonth, fnum, fx, plural, nEx, uid } from '../format';
import { addDays, todayISO, weekStart } from '../lib/dates';
import { num, numIn, repsN } from '../lib/parse';
import { currentPlan, nextWorkout, planSequence, workoutDate } from '../lib/plan';
import { fmtWeekdayDate } from '../lib/planGrid';
import { cardioByName, emptyRun, sessionToRun, type Run } from '../lib/run';
import { fmtDur, fmtKm, planRunTotals, runVolume } from '../lib/running';
import { e1Series, exerciseE1, records } from '../lib/strength';
import { activeAbsence, streakWithAbsences } from '../lib/absence';
import { AbsenceLink, AbsenceSheet, AbsenceToday } from './Absence';
import { readiness, readinessNorm, WELLNESS_ITEMS } from '../lib/wellness';
import { hasConsent } from '../lib/rodo';
import { checkinAdvice, firstOpenWeek, planDue, weekStrip } from '../lib/athleteToday';
import { Player } from './Player';
import { IntakeWizard } from './Intake';
import { WorkoutPreview } from './WorkoutPreview';
import { TodayHabits } from './TodayHabits';
import { NutritionCard } from './Nutrition';
import { TrainerTab } from './TrainerTab';
import { MyData } from './MyData';
import { ProgressExtra } from './progress/ProgressExtra';
import { useAthleteUnread } from '../components/Chat';
import { WeeklyReportCard } from '../components/WeeklyReport';
import { DayLogCard } from '../components/DayLog';
import { AthletePhotos } from '../components/ProgressPhotos';
import { runFromStart, type RunStart } from './start';
import { AthleteRunCards, isRunner } from '../components/RunVolume'; // funkcje: bieg
import { History, SessionSheet, upcomingVisits } from './History';

/** Trening w toku: `run` — zawodnik, `live` — trener prowadzi 1:1. */
export type RunKind = 'run' | 'live';
const RUN_KEY = (id: string, kind: RunKind) => `panel-${kind}-v1-${id}`;

export function loadRun(id: string, kind: RunKind = 'run'): Run | null {
  try {
    return JSON.parse(localStorage.getItem(RUN_KEY(id, kind)) || 'null') as Run | null;
  } catch {
    return null;
  }
}
export function storeRun(id: string, run: Run | null, kind: RunKind = 'run') {
  try {
    if (run) localStorage.setItem(RUN_KEY(id, kind), JSON.stringify(run));
    else localStorage.removeItem(RUN_KEY(id, kind));
  } catch {
    // brak localStorage — trening trzymany tylko w pamięci
  }
}

/** Dolne zakładki panelu podopiecznego. */
type Tab = 'today' | 'progress' | 'history' | 'trainer';
const TABS: [Tab, string][] = [
  ['today', 'Dziś'],
  ['progress', 'Postępy'],
  ['history', 'Historia'],
  ['trainer', 'Trener'],
];
const TAB_KEY = (id: string) => `fitowa-ath-tab:${id}`;
function loadTab(id: string): Tab {
  try {
    const t = sessionStorage.getItem(TAB_KEY(id));
    return TABS.some(([k]) => k === t) ? (t as Tab) : 'today';
  } catch {
    return 'today';
  }
}

/** Ikony zakładek i drobne piktogramy (ten sam rysunek co `Icon`: obrys 2px, 24×24). */
function Glyph({ name, size = 22 }: { name: Tab | 'repeat'; size?: number }) {
  const d: Record<string, ReactNode> = {
    today: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
      </>
    ),
    progress: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
    history: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4M8 14h3M8 17h6" />
      </>
    ),
    trainer: <path d="M4 5h16v11H9l-5 4z" />,
    repeat: <path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4" />,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>
      {d[name]}
    </svg>
  );
}

/** Jeden styl nagłówka arkusza: tytuł po lewej, „×” (Zamknij) po prawej. */
function SheetTop({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="between sheet-top">
      <h2>{title}</h2>
      <button className="icon-btn" aria-label="Zamknij" onClick={onClose}>
        <Icon name="x" />
      </button>
    </div>
  );
}

export function AthleteApp({
  clientId,
  onExit,
  mode = 'preview',
  start: initial,
  onTrainer,
}: {
  clientId: string;
  onExit: () => void;
  mode?: 'preview' | 'client';
  /** Od razu rozpocznij wybrany trening. */
  start?: RunStart;
  /** Podgląd trenera: „Prowadź jako trener” przełącza do treningu na żywo. */
  onTrainer?: (st: RunStart) => void;
}) {
  const { db, toast, ask, apply, saveCheckin } = useStore();
  const client = clientById(db, clientId);
  const [run, setRun] = useState<Run | null>(() => loadRun(clientId));
  // ankieta startowa: przy pierwszym wejściu podopiecznego (raz na sesję, „Uzupełnię później” odkłada)
  const [screen, setScreen] = useState<'home' | 'run' | 'intake'>(() => {
    try {
      const c = db.clients.find((x) => x.id === clientId);
      if (mode === 'client' && c && !c.intake?.completedAt && !sessionStorage.getItem(`fitowa-intake-later:${clientId}`)) return 'intake';
    } catch {
      // brak sessionStorage
    }
    return 'home';
  });
  const [tab, setTabState] = useState<Tab>(() => loadTab(clientId));
  const [planId, setPlanId] = useState<string | null>(null);
  const [look, setLook] = useState(false);
  const [absOpen, setAbsOpen] = useState(false);
  /** Trening czekający na krótki check-in samopoczucia (krok przed Start). */
  const [pre, setPre] = useState<Run | null>(null);

  useEffect(() => {
    storeRun(clientId, run);
  }, [clientId, run]);
  const started = useRef(false);
  useEffect(() => {
    if (!initial || !client || started.current) return;
    started.current = true;
    startFrom(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    document.body.classList.add('athlete-mode');
    return () => document.body.classList.remove('athlete-mode');
  }, []);

  if (!client) return null;
  const plans = plansOf(db, clientId);
  const plan = plans.find((p) => p.id === planId) ?? currentPlan(plans);
  const sessions = sessionsOf(db, clientId);

  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      sessionStorage.setItem(TAB_KEY(clientId), t);
    } catch {
      // brak sessionStorage — zakładka tylko w pamięci
    }
    window.scrollTo(0, 0);
  };
  const go = (r: Run) => {
    setRun(r);
    setScreen('run');
    window.scrollTo(0, 0);
  };
  // check-in przed treningiem: tylko podopieczny (trener w podglądzie nie wpisuje cudzego samopoczucia) i tylko raz dziennie
  const begin = (r: Run) => {
    if (mode === 'client' && !r.editSessionId && !client.checkins.some((c) => c.date === todayISO())) return setPre(r);
    go(r);
  };
  /** Zastępuje trening w toku tylko po potwierdzeniu. */
  const replaceRun = async (r: Run) => {
    if (run && run.ex.some((e) => e.sets.some((x) => x.done)) && !(await ask('Masz rozpoczęty trening. Porzucić go i otworzyć ten?', { confirm: 'Tak' }))) return;
    begin(r);
  };
  const startOwn = () => void replaceRun(emptyRun('Trening własny', todayISO()));
  const editSession = (s: TrainingSession) => void replaceRun(sessionToRun(s));

  const startFrom = (st: RunStart) => {
    const r = runFromStart(db, clientId, st, todayISO());
    if (typeof r === 'string') return toast(r);
    void replaceRun(r);
  };
  const start = async (workoutId?: string) => {
    if (!plan) return startOwn();
    const nx = nextWorkout(plan, sessions);
    const id = workoutId ?? nx?.workout.id;
    if (!id) return toast('Nie znaleziono treningu w planie.');
    // trening spoza kolejki przesuwa „następny” — pytamy, żeby plan nie przeskoczył przez pomyłkę
    if (nx && id !== nx.workout.id && !(await ask(`To nie jest następny trening z planu (następny: ${nx.workout.name}). Po zapisie plan pójdzie dalej od wybranego. Zacząć mimo to?`, { confirm: 'Zacznij ten' }))) return;
    startFrom({ planId: plan.id, workoutId: id });
  };
  const undo = async (s: TrainingSession) => {
    if (!(await ask(`Oznaczyć trening z ${fmtDay(s.date)} jako niewykonany? Zapis ćwiczeń, serii i ciężarów zostanie usunięty, a trening wróci na listę do zrobienia.`, { confirm: 'Usuń zapis' }))) return;
    const sp = sessionPayment(db, s);
    const removePayment = !!sp && mode === 'preview' && (await ask(`Usunąć też płatność „${paymentLabel(sp.payment)}” za ten trening?`, { confirm: 'Usuń płatność' }));
    const appts = db.appointments.filter((a) => a.sessionId === s.id);
    const prevExtra = extraPlanOf(db, s.clientId);
    // konto podopiecznego może zapisać tylko treningi — bez zmian wizyt i planów (inaczej znikałyby po cichu)
    const changes = mode === 'preview' ? undoSession(db, s.id, removePayment) : deleteSession(db, s.id, false).filter((c) => c.col === 'sessions');
    if (!(await apply(changes))) return;
    const extraChange = changes.find((c) => c.op === 'put' && c.col === 'plans');
    // „Cofnij” przywraca zapis (i powiązaną wizytę) — na wypadek pomyłki
    toast('Trening oznaczony jako niewykonany.', {
      label: 'Cofnij',
      run: () =>
        void apply(
          [
            put('sessions', s),
            ...appts.map((a) => put('appointments', a)),
            ...(extraChange ? [prevExtra ? put('plans', prevExtra) : del('plans', (extraChange as { item: { id: string } }).item.id)] : []),
            // usunięta płatność wraca razem z treningiem
            ...(removePayment && sp ? [put('clients', { ...(db.clients.find((c) => c.id === sp.client.id) ?? sp.client), payments: [...(db.clients.find((c) => c.id === sp.client.id) ?? sp.client).payments.filter((p) => p.id !== sp.payment.id), sp.payment] })] : []),
          ],
          'Przywrócono trening.',
        ),
    });
  };
  // Podopieczny cofa tylko swoje treningi (bez rozliczenia, wizyty i komentarza trenera); trener w podglądzie — każdy.
  const canUndo = (s: TrainingSession) => mode === 'preview' || (s.charge === 'brak' && !s.reviewedAt && !s.coachNote && !db.appointments.some((a) => a.sessionId === s.id));
  const openIntake = () => {
    setLook(false);
    setScreen('intake');
    window.scrollTo(0, 0);
  };
  const home = screen === 'home' || (screen === 'run' && !run);

  return (
    <div className={`ath ${home ? 'ath-tabbed' : ''}`}>
      {mode === 'client' ? (
        <div className="ath-top">
          <span className="ath-coach">
            <span className="ath-coach-av" aria-hidden>
              <Icon name="user" size={16} />
            </span>
            Twój trener
          </span>
          <span className="row-inline">
            <OfflineBadge />
            <button className="icon-btn ath-gear" onClick={() => setLook(true)} aria-label="Ustawienia — powiadomienia i kolory">
              <Icon name="settings" size={20} />
            </button>
          </span>
        </div>
      ) : (
        <div className="ath-preview">
          <span>Podgląd trybu zawodnika · {client.name}</span>
          <span className="row-inline">
            <button className="btn btn-ghost btn-sm" onClick={() => setLook(true)} aria-label="Ustawienia — powiadomienia i kolory">
              <Icon name="settings" size={16} />
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onExit}>
              Wróć do panelu
            </button>
          </span>
        </div>
      )}
      {look && (
        <Sheet label="Ustawienia" onClose={() => setLook(false)}>
          <SheetTop title="Ustawienia" onClose={() => setLook(false)} />
          {mode === 'client' && <PushSettings role="client" />}
          <h3 className="form-section">Plan</h3>
          <button
            className="btn btn-secondary btn-block ath-set-row"
            onClick={() => {
              setLook(false);
              setAbsOpen(true);
            }}
          >
            <Icon name="cal" size={18} /> Wypadam z planu
          </button>
          <h3 className="form-section">Kolory</h3>
          <PalettePicker />
          <h3 className="form-section">Ankieta</h3>
          <button className="btn btn-secondary btn-block ath-set-row" onClick={openIntake}>
            <Icon name="clipboard" size={18} /> {mode === 'preview' ? 'Ankieta podopiecznego' : 'Moja ankieta'}
          </button>
          {mode === 'client' && <MyData client={client} />}
          {mode === 'client' && (
            <button className="btn btn-ghost btn-block ath-logout" onClick={onExit}>
              Wyloguj
            </button>
          )}
        </Sheet>
      )}
      {absOpen && <AbsenceSheet client={client} notify={mode === 'client'} onClose={() => setAbsOpen(false)} />}
      {pre && (
        <PreCheckin
          client={client}
          onCancel={() => setPre(null)}
          onGo={async (w) => {
            const r = pre;
            setPre(null);
            if (w) {
              await saveCheckin(client.id, { date: todayISO(), ...w });
              const a = checkinAdvice(readiness(w), readinessNorm(client.checkins, sessions, todayISO()));
              if (a?.lighter) toast(`Samopoczucie ${fx(readiness(w)!, 1)}/5. ${a.text}`);
            }
            go(r);
          }}
        />
      )}
      {screen === 'intake' ? (
        <IntakeWizard
          client={client}
          first={!client.intake?.completedAt}
          asTrainer={mode === 'preview'}
          onClose={() => {
            try {
              sessionStorage.setItem(`fitowa-intake-later:${clientId}`, '1');
            } catch {
              // nic
            }
            setScreen('home');
            window.scrollTo(0, 0);
          }}
        />
      ) : screen === 'run' && run ? (
        <Player
          client={client}
          run={run}
          setRun={setRun}
          onHome={() => {
            setScreen('home');
            window.scrollTo(0, 0);
          }}
          onSaved={() => {
            setRun(null);
            setScreen('home');
            window.scrollTo(0, 0);
          }}
          onCancel={() => {
            if (!run.editSessionId) dropUnsavedVideos(run.ex.flatMap((e) => e.sets.map((x) => x.video)), db.sessions);
            setRun(null);
            setScreen('home');
            window.scrollTo(0, 0);
            toast(run.editSessionId ? 'Poprawki anulowane.' : 'Trening anulowany.');
          }}
        />
      ) : (
        <>
          {tab === 'today' && (
            <TodayTab
              clientId={clientId}
              plan={plan}
              run={run}
              onStart={start}
              onOwn={startOwn}
              onRepeat={(s) => startFrom({ repeatSessionId: s.id })}
              onStartFrom={startFrom}
              onResume={() => setScreen('run')}
              onIntake={openIntake}
              onAbsence={() => setAbsOpen(true)}
              notify={mode === 'client'}
              onDiscard={() => {
                if (run) dropUnsavedVideos(run.ex.flatMap((e) => e.sets.map((x) => x.video)), db.sessions);
                setRun(null);
              }}
            />
          )}
          {tab === 'progress' && <ProgressTab client={client} canImport={!run} />}
          {tab === 'history' && (
            <div className="ath-page fade">
              <h1 className="ath-page-title">Historia</h1>
              <MonthCalendar done={sessions.reduce((m, s) => m.set(s.date, [...(m.get(s.date) ?? []), s.workoutName || 'Trening']), new Map<string, string[]>())} today={todayISO()} planned={plannedByDay(db, clientId, plan, extraPlanOf(db, clientId), sessions, todayISO())} />
              <History plain={!onTrainer} clientId={clientId} onEdit={editSession} onRepeat={(s) => startFrom({ repeatSessionId: s.id })} onTrainer={onTrainer && ((s) => onTrainer({ repeatSessionId: s.id }))} onUndo={undo} canUndo={canUndo} />
              <Workouts
                plan={plan}
                extra={extraPlanOf(db, clientId)}
                plans={plans}
                onPlan={setPlanId}
                sessions={sessions}
                nextId={nextWorkout(plan, sessions)?.workout.id}
                onStart={(id, pid) => (pid === plan?.id ? void start(id) : startFrom({ planId: pid, workoutId: id }))}
                onTrainer={onTrainer}
              />
            </div>
          )}
          {tab === 'trainer' && (
            <div className="ath-page fade">
              <h1 className="ath-page-title">Trener</h1>
              <TrainerTab client={client} mode={mode} />
            </div>
          )}
          <TabBar client={client} tab={tab} onTab={setTab} badge={!onTrainer} />
        </>
      )}
    </div>
  );
}

/** Dolny pasek zakładek (styl jak menu trenera: ikona w „pigułce” + podpis). */
function TabBar({ client, tab, onTab, badge }: { client: Client; tab: Tab; onTab: (t: Tab) => void; badge: boolean }) {
  const unread = useAthleteUnread(client);
  return (
    <nav className="ath-tabbar" aria-label="Zakładki">
      {TABS.map(([k, label]) => (
        <button key={k} type="button" className={tab === k ? 'active' : ''} aria-current={tab === k ? 'page' : undefined} onClick={() => onTab(k)}>
          <span className="ath-tab-ic">
            <Glyph name={k} />
            {k === 'trainer' && badge && unread > 0 && (
              <span className="ath-tab-badge" aria-label={`${unread} nowe`}>
                {unread}
              </span>
            )}
          </span>
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

/** „dziś”, „jutro”, „pon. 20.10”. */
function dayWord(d: string, today: string): string {
  return d === today ? 'dziś' : d === addDays(today, 1) ? 'jutro' : fmtWeekdayDate(d);
}

/** Krótki opis jednostki: bieg — dystans / czas z odcinków, inaczej liczba ćwiczeń. */
function workoutSummary(k: PlanWorkout, client: { run?: Client['run'] }): string {
  const ex = k.exercises.filter((e) => e.name);
  if (ex.length && ex.every((e) => e.cardio ?? cardioByName(e.name))) {
    const t = planRunTotals(ex.flatMap((e) => e.groups), client.run);
    const parts = [t.km > 0 && `${t.approx ? '~' : ''}${fmtKm(t.km)}`, t.min > 0 && `${t.approx ? '~' : ''}${fmtDur(t.min)}`].filter(Boolean);
    return parts.length ? `bieg · ${parts.join(' · ')}` : 'bieg';
  }
  return nEx(ex.length);
}

const nf1 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 });

function TodayTab({
  clientId,
  plan,
  run,
  onStart,
  onOwn,
  onRepeat,
  onStartFrom,
  onResume,
  onDiscard,
  onIntake,
  onAbsence,
  notify,
}: {
  onAbsence: () => void;
  notify: boolean;
  clientId: string;
  plan: ReturnType<typeof currentPlan>;
  run: Run | null;
  onStart: (workoutId?: string) => void;
  onOwn: () => void;
  onRepeat: (s: TrainingSession) => void;
  onStartFrom: (st: RunStart) => void;
  onResume: () => void;
  onDiscard: () => void;
  onIntake: () => void;
}) {
  const { db, ask, saveCheckin } = useStore();
  const client = clientById(db, clientId)!;
  const today = todayISO();
  const sessions = sessionsOf(db, clientId);
  const nx = nextWorkout(plan, sessions);
  const extra = extraPlanOf(db, clientId);
  const first = client.name.split(' ')[0];

  const visit = upcomingVisits(db.appointments, clientId)[0];
  const visitText = visit && `${visit.date === today ? 'dziś' : fmtLong(visit.date)}, ${visit.time}`;
  const loc = visit && db.locations.find((l) => l.id === visit.locationId)?.name;
  // wizyta dziś albo jutro → ten trening zwykle robi się z trenerem (wizyta pokazana raz: w karcie treningu)
  const withTrainer = !!visit && visit.date <= addDays(today, 1);
  const visitInHero = withTrainer && !run && !!nx;

  const ci = client.checkins.find((c) => c.date === today);
  const advice = checkinAdvice(readiness(ci), readinessNorm(client.checkins, sessions, today));

  // tydzień: zrobione / zaplanowane / odpoczynek + najwyżej 3 liczby
  const planned = plannedByDay(db, clientId, plan, extra, sessions, today);
  const strip = weekStrip(
    today,
    sessions.map((s) => s.date),
    [...planned.keys()],
  );
  const thisWeek = sessions.filter((s) => s.date >= weekStart(today)).length;
  const goal = client.daysPerWeek || 2;
  // seria tygodni: tydzień w całości na zgłoszonej nieobecności jej nie przerywa
  const st = streakWithAbsences(sessions, today, client.absences);
  const away = activeAbsence(client.absences, today);
  const lastWeight = allMeasurements(client)
    .filter((m) => m.weight != null)
    .sort((a, b) => b.date.localeCompare(a.date))[0];

  return (
    <div className="ath-home fade">
      <header className="ath-hello">
        <h1>Cześć, {first}!</h1>
        <p className="muted first-cap">{fmtLong(today)}</p>
      </header>

      {(() => {
        // treningi zadane przez trenera na konkretny dzień (poza planem), niezrobione: zaległe do 7 dni wstecz i do 7 dni naprzód
        const due = (extra?.weeks.flatMap((w) => w.workouts) ?? [])
          .filter((k) => k.date && k.date >= addDays(today, -7) && k.date <= addDays(today, 7) && k.exercises.some((e) => e.name))
          .filter((k) => extraState(k, extra!.id, sessions, today).state !== 'done')
          .sort((a, b) => a.date!.localeCompare(b.date!));
        if (!due.length || run || away) return null;
        const when = (d: string) => (d === today ? 'na dziś' : d === addDays(today, 1) ? 'na jutro' : d < today ? `zaległy z ${fmtDay(d)}` : `na ${fmtDay(d)}`);
        return due.map((k) => (
          <section key={k.id} className={`acard ${k.date! <= today ? 'acard-hero' : 'acard-extra'}`}>
            <span className={`eyebrow ${k.date! < today ? 'warn-text' : ''}`}>Od trenera · {when(k.date!)}</span>
            <h2>{k.name}</h2>
            <p className="muted small">{workoutSummary(k, client)} · poza planem</p>
            <button className={`btn ${k.date! <= today ? 'btn-primary btn-lg' : 'btn-secondary'}`} onClick={() => onStartFrom({ planId: extra!.id, workoutId: k.id })}>
              <Icon name="play" /> Start
            </button>
          </section>
        ));
      })()}
      {run?.editSessionId && (
        <section className="acard">
          <span className="eyebrow">Poprawki zapisanego treningu</span>
          <h3>
            {run.name} · {fmtDay(run.date)}
          </h3>
          <div className="actions">
            <button className="btn btn-secondary" onClick={onResume}>
              Wróć do poprawek
            </button>
            <button
              className="btn btn-ghost"
              onClick={async () => {
                if (await ask('Anulować poprawki? Zapisany trening (z nagraniami) zostanie bez zmian.', { confirm: 'Anuluj poprawki' })) onDiscard();
              }}
            >
              Anuluj poprawki
            </button>
          </div>
        </section>
      )}
      {run && !run.editSessionId ? (
        <section className="acard acard-hero">
          <span className="eyebrow">W trakcie</span>
          <h2>{run.name}</h2>
          {run.workoutId && sessions.some((x) => x.planId === run.planId && x.workoutId === run.workoutId && x.date === run.date) && (
            <p className="small warn-text">Ten trening jest już zapisany dziś (np. z trenerem). Jeśli to ten sam — porzuć ten, żeby nie było dwóch zapisów.</p>
          )}
          <p className="muted small">
            {run.ex.reduce((a, e) => a + e.sets.filter((s) => s.done).length, 0)} z {run.ex.reduce((a, e) => a + e.sets.length, 0)} serii · rozpoczęty {run.date !== todayISO() ? `${fmtDay(run.date)}, ` : ''}
            {new Date(run.startedAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
          </p>
          <div className="actions">
            <button className="btn btn-primary btn-lg" onClick={onResume}>
              <Icon name="play" /> Kontynuuj
            </button>
            <button
              className="btn btn-ghost"
              onClick={async () => {
                if (await ask('Porzucić rozpoczęty trening? Wpisane serie nie zostaną zapisane.', { confirm: 'Porzuć' })) onDiscard();
              }}
            >
              Porzuć
            </button>
          </div>
        </section>
      ) : away && !run ? (
        <AbsenceToday client={client} absence={away} onOwn={onOwn} notify={notify} />
      ) : nx ? (
        <section className="acard acard-hero">
          <span className="eyebrow">Następny trening</span>
          <h2>{nx.workout.name}</h2>
          <p className="muted small">
            {nx.week.name.replace(/\s*\(deload\)/i, ' (lżejszy)')} · {nEx(nx.workout.exercises.filter((e) => e.name).length)} · {nx.index + 1} z {nx.total}
          </p>
          {(() => {
            // dzień z planu (ustawiony przez trenera); „zaległy” tylko gdy od terminu nie było treningu z tego planu
            const d = plan && workoutDate(plan, plan.weeks.indexOf(nx.week), nx.workout);
            const due = planDue(d, today, sessions, plan?.id);
            if (!d || !due) return null;
            return <p className={`small ${due === 'overdue' ? 'warn-text' : 'muted'}`}>{due === 'overdue' ? `Zaplanowany na ${fmtDay(d)} — zaległy` : `Zaplanowany na ${dayWord(d, today)}`}</p>;
          })()}
          {visitInHero && (
            <p className="small ath-hero-visit">
              <Icon name="cal" size={16} />
              <span>
                <b>Wizyta z trenerem: {visitText}</b>
                {loc ? ` · ${loc}` : ''}. Zrobicie ten trening razem — Start tylko, jeśli ćwiczysz sam(a).
              </span>
            </p>
          )}
          {advice?.lighter && (
            <p className="small warn-text">
              Samopoczucie {fx(readiness(ci)!, 1)}/5 — {advice.text}
            </p>
          )}
          <button className="btn btn-primary btn-lg" onClick={() => onStart(nx.workout.id)}>
            <Icon name="play" /> {withTrainer ? 'Start samodzielnie' : 'Start'}
          </button>
        </section>
      ) : (
        <section className="acard acard-hero">
          <span className="eyebrow">Trening własny</span>
          <h2>Zacznij trening</h2>
          <p className="muted small">{extra?.weeks.some((w) => w.workouts.some((k) => k.exercises.some((e) => e.name))) ? 'Dodawaj ćwiczenia w trakcie — trener zobaczy zapis.' : 'Plan od trenera jeszcze się przygotowuje. Dodawaj ćwiczenia w trakcie — trener zobaczy zapis.'}</p>
          {advice?.lighter && (
            <p className="small warn-text">
              Samopoczucie {fx(readiness(ci)!, 1)}/5 — {advice.text}
            </p>
          )}
          <button className="btn btn-primary btn-lg" onClick={onOwn}>
            <Icon name="play" /> Start
          </button>
        </section>
      )}
      {!run && !away && (nx || sessions[0]) && (
        <div className={`ath-quick ${nx && sessions[0] ? 'two' : ''}`}>
          {nx && (
            <button className="btn btn-secondary own-btn" onClick={onOwn} title="Trening poza planem — dodajesz ćwiczenia w trakcie">
              <Icon name="plus" size={18} /> Trening własny
            </button>
          )}
          {sessions[0] && (
            <button className="btn btn-secondary repeat-btn" onClick={() => onRepeat(sessions[0])} title={`${sessions[0].workoutName || 'Trening'} z ${fmtDay(sessions[0].date)} — te same ćwiczenia, ciężary z ostatniego razu`}>
              <Glyph name="repeat" size={18} /> Powtórz ostatni
            </button>
          )}
        </div>
      )}

      {!away && !run && <AbsenceLink client={client} onOpen={onAbsence} />}

      {!client.intake?.completedAt && (
        <section className="acard acard-warn ath-intake">
          <span className="eyebrow">Ankieta startowa</span>
          <h3>Zdrowie, styl życia i cele — ok. 5 minut</h3>
          <button className="btn btn-primary" onClick={onIntake}>
            Wypełnij ankietę
          </button>
        </section>
      )}

      {visit && !visitInHero && (
        <section className="acard next-visit" aria-label="Następna wizyta">
          <Icon name="cal" size={20} />
          <span>
            <span className="eyebrow">Wizyta z trenerem</span>
            <strong className="next-visit-when first-cap">{visitText}</strong>
            {loc && <span className="muted small"> · {loc}</span>}
          </span>
        </section>
      )}

      <section className="acard ath-week" aria-label="Ten tydzień">
        <ol className="wk-strip">
          {strip.map((d) => (
            <li key={d.date} className={`wk-day ${d.state} ${d.today ? 'is-today' : ''}`} aria-label={`${fmtLong(d.date)}: ${d.state === 'done' ? 'trening zrobiony' : d.state === 'planned' ? 'zaplanowany' : 'odpoczynek'}${d.today ? ' (dziś)' : ''}`}>
              <span className="wk-dow" aria-hidden>
                {d.label}
              </span>
              <i className="wk-mark" aria-hidden>
                {d.state === 'done' && <Icon name="check" size={14} />}
              </i>
            </li>
          ))}
        </ol>
        <dl className="ath-stats">
          <div>
            <dt>W tym tygodniu</dt>
            <dd className={thisWeek >= goal ? 'ok-text' : ''}>
              {thisWeek}
              <small>/{goal}</small>
            </dd>
          </div>
          <div>
            <dt>{plural(st.weeks, 'Tydzień', 'Tygodnie', 'Tygodni')} z rzędu</dt>
            <dd>{st.weeks}</dd>
          </div>
          {lastWeight && (
            <div>
              <dt>Waga · {fmtDay(lastWeight.date)}</dt>
              <dd>
                {nf1.format(lastWeight.weight!)}
                <small> kg</small>
              </dd>
            </div>
          )}
        </dl>
      </section>

      <CheckinCard client={client} onSave={(c) => saveCheckin(client.id, c)} />
      <TodayHabits client={client} />
      <NutritionCard client={client} />
      <DayLogCard client={client} />
    </div>
  );
}

/** Kompaktowe 5 skal 1–5: jeden opis skali u góry, wiersz = etykieta + 5 przycisków. */
function CheckinScales({ w, onChange }: { w: Wellness; onChange: (w: Wellness) => void }) {
  return (
    <div className="ci-compact">
      <p className="ci-legend muted small">1 = źle · 5 = świetnie (przy stresie 5 = spokój)</p>
      {WELLNESS_ITEMS.map(([k, label]) => (
        <div key={k} className="checkin-row ci-row">
          <span className="ci-label">{label}</span>
          <div className="scale scale-5" role="radiogroup" aria-label={label}>
            {[1, 2, 3, 4, 5].map((v) => (
              <button key={v} type="button" role="radio" aria-checked={w[k] === v} className={w[k] === v ? 'active' : ''} onClick={() => onChange({ ...w, [k]: v })} aria-label={`${label} ${v}`}>
                {v}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
const isComplete = (w: Wellness) => WELLNESS_ITEMS.every(([k]) => w[k] != null);

/** Krok przed Start: krótki check-in (jeden ekran), „Zapisz i zacznij” albo „Pomiń”. */
function PreCheckin({ client, onGo, onCancel }: { client: Client; onGo: (w: Wellness | null) => void; onCancel: () => void }) {
  const [w, setW] = useState<Wellness>({});
  const [busy, setBusy] = useState(false);
  void client;
  return (
    <Sheet label="Samopoczucie przed treningiem" onClose={onCancel}>
      <div className="ci-sheet">
        <SheetTop title="Jak się dziś czujesz?" onClose={onCancel} />
        <CheckinScales w={w} onChange={setW} />
        <div className="ci-actions">
          <button
            className="btn btn-primary btn-lg"
            disabled={!isComplete(w) || busy}
            onClick={() => {
              setBusy(true);
              onGo(w);
            }}
          >
            <Icon name="play" /> Zapisz i zacznij
          </button>
          <button className="btn btn-ghost" onClick={() => onGo(null)}>
            Pomiń
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function CheckinCard({ client, onSave }: { client: Client; onSave: (c: Checkin) => void }) {
  const { db } = useStore();
  const today = todayISO();
  const existing = client.checkins.find((c) => c.date === today);
  const [w, setW] = useState<Wellness>(existing ?? {});
  const [editing, setEditing] = useState(!existing);
  const norm = readinessNorm(client.checkins, sessionsOf(db, client.id), today);
  const r = readiness(existing);

  if (!editing && existing && r != null) {
    const a = checkinAdvice(r, norm)!;
    return (
      <section className="acard ci-done" aria-label="Samopoczucie dziś">
        <div className="ci-done-head">
          <span className="eyebrow">Samopoczucie dziś</span>
          <button className="link small" onClick={() => setEditing(true)}>
            zmień
          </button>
        </div>
        <div className="readiness">
          <strong className="big">{fx(r, 1)}</strong>
          <span className="muted">/ 5</span>
          <span className={`tag tag-${a.tone}`}>{a.tag}</span>
        </div>
        <p className="muted small">{a.text}</p>
      </section>
    );
  }

  return (
    <section className="acard" aria-label="Samopoczucie">
      <h3>Jak się dziś czujesz?</h3>
      <CheckinScales w={w} onChange={setW} />
      <button
        className="btn btn-primary btn-block"
        disabled={!isComplete(w)}
        onClick={() => {
          onSave({ date: today, ...w });
          setEditing(false);
        }}
      >
        Zapisz
      </button>
    </section>
  );
}

/** Zakładka „Postępy”: podsumowania (ProgressExtra), siła, rekordy, ciało, bieg, raport tygodnia. */
function ProgressTab({ client, canImport }: { client: Client; canImport: boolean }) {
  const { db } = useStore();
  const sessions = sessionsOf(db, client.id);
  const recs = records(sessions).slice(0, 5);
  const extra = extraPlanOf(db, client.id);
  const runner = isRunner(client, runVolume([...plansOf(db, client.id), ...(extra ? [extra] : [])], sessions, client.run, 8));
  return (
    <div className="ath-page fade">
      <h1 className="ath-page-title">Postępy</h1>
      <ProgressExtra client={client} />
      <h2 className="ath-sec">Siła i wysiłek</h2>
      <Progress clientId={client.id} />
      {recs.length > 0 && (
        <>
          <h2 className="ath-sec">Ostatnie rekordy</h2>
          <section className="acard ath-recs">
            <ul className="rows">
              {recs.map((r, i) => (
                <li key={i} className="row">
                  <span className="text-green">
                    <Icon name="star" size={16} />
                  </span>
                  <span className="grow">
                    {r.name}
                    <span className="muted small"> · {fmtDay(r.date)}</span>
                  </span>
                  <span className="small rec-val">
                    {String(r.reps)} × {fnum(num(r.load))} kg
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      <h2 className="ath-sec">Ciało</h2>
      <BodyProgress client={client} />
      {/* zdjęcia sylwetki tylko za zgodą na wizerunek (RODO) */}
      {hasConsent(client, 'media') && <AthletePhotos client={client} />}
      {runner && <h2 className="ath-sec">Bieganie</h2>}
      <AthleteRunCards client={client} canImport={canImport} />
      <WeeklyReportCard client={client} />
    </div>
  );
}

interface DayItem {
  kind: 'plan' | 'extra' | 'visit';
  text: string;
  /** Bieg / cardio — ikona biegu zamiast sztangi. */
  run?: boolean;
}
const isRunWorkout = (k: PlanWorkout) => k.exercises.some((e) => e.name) && k.exercises.filter((e) => e.name).every((e) => e.cardio ?? cardioByName(e.name));

/** Co jest zaplanowane na dni: treningi z planu (dzień od trenera), zadane poza planem, wizyty z trenerem. */
function plannedByDay(db: ReturnType<typeof useStore>['db'], clientId: string, plan: Plan | null | undefined, extra: Plan | undefined, sessions: TrainingSession[], today: string): Map<string, DayItem[]> {
  const out = new Map<string, DayItem[]>();
  const add = (d: string, it: DayItem) => out.set(d, [...(out.get(d) ?? []), it]);
  if (plan) {
    const done = new Set(sessions.filter((x) => x.planId === plan.id && x.workoutId).map((x) => x.workoutId));
    plan.weeks.forEach((w, wi) =>
      w.workouts.forEach((k) => {
        const d = workoutDate(plan, wi, k);
        // minione terminy pomijamy, gdy podopieczny od tego czasu trenował z planu (idzie po kolei — nie „zaległy”)
        if (d && !done.has(k.id) && k.exercises.some((e) => e.name) && planDue(d, today, sessions, plan.id)) add(d, { kind: 'plan', text: `${k.name} (${w.name})`, run: isRunWorkout(k) });
      }),
    );
  }
  for (const k of extra?.weeks.flatMap((w) => w.workouts) ?? [])
    if (k.date && k.exercises.some((e) => e.name) && extraState(k, extra!.id, sessions, today).state !== 'done') add(k.date, { kind: 'extra', text: `${k.name} — od trenera`, run: isRunWorkout(k) });
  for (const a of db.appointments.filter((x) => x.clientId === clientId && x.status === 'planned')) add(a.date, { kind: 'visit', text: `Wizyta z trenerem ${a.time}` });
  return out;
}

function MonthCalendar({ done, today, planned }: { done: Map<string, string[]>; today: string; planned: Map<string, DayItem[]> }) {
  const dates = new Set(done.keys());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [sel, setSel] = useState<string | null>(null);
  const first = month + '-01';
  const start = weekStart(first);
  const days: string[] = [];
  for (let d = start; days.length < 42; d = addDays(d, 1)) days.push(d);
  while (days.length > 35 && days[days.length - 7].slice(0, 7) !== first.slice(0, 7)) days.splice(-7);
  const n = [...dates].filter((d) => d.startsWith(month)).length;
  const shift = (dir: number) => {
    const d = new Date(`${first}T12:00:00`);
    d.setMonth(d.getMonth() + dir);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    setSel(null);
  };
  const pick = sel ?? (month === today.slice(0, 7) ? today : null);
  const items = pick ? planned.get(pick) ?? [] : [];
  return (
    <section className="acard">
      <div className="between">
        <span className="row-inline mini-cal-nav">
          <button className="icon-btn icon-btn-sm" aria-label="Poprzedni miesiąc" onClick={() => shift(-1)}>
            ‹
          </button>
          <h3 className="first-cap">{fmtMonth(month)}</h3>
          <button className="icon-btn icon-btn-sm" aria-label="Następny miesiąc" onClick={() => shift(1)}>
            ›
          </button>
        </span>
        <span className="muted small">
          {n} {plural(n, 'trening', 'treningi', 'treningów')}
        </span>
      </div>
      <div className="mini-cal">
        {['pn', 'wt', 'śr', 'cz', 'pt', 'sb', 'nd'].map((d) => (
          <span key={d} className="mini-dow">
            {d}
          </span>
        ))}
        {days.map((d) => {
          const its = planned.get(d) ?? [];
          const visit = its.some((x) => x.kind === 'visit');
          const todo = its.some((x) => x.kind !== 'visit');
          return (
            <button
              type="button"
              key={d}
              className={`mini-day ${d.slice(0, 7) !== first.slice(0, 7) ? 'other' : ''} ${d === today ? 'is-today' : ''} ${dates.has(d) ? 'has' : ''} ${todo ? 'todo' : ''} ${visit ? 'visit' : ''} ${pick === d ? 'sel' : ''} ${todo && d < today && !dates.has(d) ? 'late' : ''}`}
              onClick={() => setSel(d)}
              aria-label={`${fmtLong(d)}${dates.has(d) ? ', trening zrobiony' : ''}${its.length ? `, ${its.map((x) => x.text).join(', ')}` : ''}`}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
      <p className="mini-legend muted small">
        <span className="dot todo" /> do zrobienia · <span className="dot visit" /> wizyta · <span className="dot done" /> zrobiony
      </p>
      {pick && (items.length > 0 || dates.has(pick)) && (
        <ul className="mini-day-list">
          <li className="muted small first-cap">{fmtLong(pick)}</li>
          {done.get(pick)?.map((name, i) => (
            <li key={`d${i}`} className="done">
              ✓ {name} — zrobiony
            </li>
          ))}
          {items.map((x, i) => (
            <li key={i} className={x.kind}>
              <Icon name={x.kind === 'visit' ? 'cal' : pick < today ? 'alert' : x.run ? 'run' : 'dumbbell'} size={15} /> {x.text}
              {x.kind !== 'visit' && pick < today ? ' — zaległy' : ''}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Pomiary ciała dla podopiecznego: waga i obwody — zmiana od pierwszego pomiaru, przebieg i własny wpis. */
function BodyProgress({ client }: { client: Client }) {
  const [adding, setAdding] = useState(false);
  const ms = allMeasurements(client).sort((a, b) => a.date.localeCompare(b.date));
  const field = ms.some((m) => m.weight != null) ? 'weight' : ms.some((m) => m.waist != null) ? 'waist' : null;
  const vals = field ? ms.filter((m) => m[field] != null) : [];
  const waist = ms.filter((m) => m.waist != null);
  const wd = waist.length >= 2 ? waist[waist.length - 1].waist! - waist[0].waist! : null;
  return (
    <section className="acard ath-body" aria-label="Pomiary">
      {!field || !vals.length ? (
        <p className="muted small">Waga i obwody raz w tygodniu, rano na czczo — zobaczysz tu zmianę.</p>
      ) : (
        <>
          <div className="body-kpis">
            <div>
              <span className="muted small">{field === 'weight' ? 'Waga' : 'Talia'}</span>
              <strong className="big">
                {fnum(vals[vals.length - 1][field]!)} {field === 'weight' ? 'kg' : 'cm'}
              </strong>
              {vals.length >= 2 &&
                (() => {
                  const d = vals[vals.length - 1][field]! - vals[0][field]!;
                  return <span className={`small ${d < 0 ? 'ok-text' : ''}`}>{d === 0 ? `bez zmian od ${fmtDay(vals[0].date)}` : `${d > 0 ? '+' : ''}${fnum(d)} ${field === 'weight' ? 'kg' : 'cm'} od ${fmtDay(vals[0].date)}`}</span>;
                })()}
            </div>
            {field === 'weight' && wd != null && (
              <div>
                <span className="muted small">Talia</span>
                <strong className="big">{fnum(waist[waist.length - 1].waist!)} cm</strong>
                <span className={`small ${wd < 0 ? 'ok-text' : ''}`}>{wd === 0 ? `bez zmian od ${fmtDay(waist[0].date)}` : `${wd > 0 ? '+' : ''}${fnum(wd)} cm od ${fmtDay(waist[0].date)}`}</span>
              </div>
            )}
          </div>
          {field === 'weight' && vals.length >= 2 ? (
            (() => {
              const t = weightTrend(ms);
              return (
                <>
                  <p className="wt-summary">{weightTrendText(t)}</p>
                  <WeightTrendChart daily={t.daily} avg={t.avg} />
                  <p className="muted small wt-help">Dzienne wahania 1–2 kg to woda i jedzenie — patrz na średnią z 7 dni.</p>
                </>
              );
            })()
          ) : (
            vals.length >= 2 && <LineChart label={field === 'weight' ? 'Waga' : 'Talia'} series={[{ label: field === 'weight' ? 'Waga (kg)' : 'Talia (cm)', pts: vals.map((m) => ({ x: m.date, y: m[field]! })) }]} />
          )}
        </>
      )}
      <button className="btn btn-secondary btn-block" onClick={() => setAdding(true)}>
        <Icon name="plus" size={18} /> Dodaj pomiar
      </button>
      {adding && <AddMeasurement client={client} onClose={() => setAdding(false)} />}
    </section>
  );
}

const SELF_FIELDS: ['weight' | 'waist' | 'hips' | 'chest' | 'arm' | 'thigh', string, string, number, number][] = [
  ['weight', 'Waga', 'kg', 25, 300],
  ['waist', 'Talia (w pępku)', 'cm', 40, 200],
  ['hips', 'Biodra', 'cm', 50, 200],
  ['chest', 'Klatka', 'cm', 50, 200],
  ['arm', 'Ramię', 'cm', 15, 70],
  ['thigh', 'Udo', 'cm', 30, 100],
];

function AddMeasurement({ client, onClose }: { client: Client; onClose: () => void }) {
  const { addMeasurement, toast } = useStore();
  const [date, setDate] = useState(todayISO());
  const [v, setV] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toast('Wybierz datę pomiaru.');
    if (date > todayISO()) return toast('Data pomiaru nie może być w przyszłości.');
    const m: Measurement = { id: uid(), date, note: note.trim() || undefined };
    for (const [k, label, , min, max] of SELF_FIELDS) {
      if (!v[k]?.trim()) continue;
      const n = numIn(v[k], min, max);
      if (n == null) return toast(`${label}: wpisz liczbę od ${min} do ${max}.`);
      (m as unknown as Record<string, number>)[k] = n;
    }
    if (!SELF_FIELDS.some(([k]) => m[k] != null)) return toast('Wpisz przynajmniej wagę albo jeden obwód.');
    setBusy(true);
    if (await addMeasurement(client.id, m)) onClose();
    setBusy(false);
  };
  return (
    <Sheet label="Nowy pomiar" onClose={onClose}>
      <SheetTop title="Nowy pomiar" onClose={onClose} />
      <div className="meas-form">
        <label className="field">
          <span>Data</span>
          <input className="input" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
        </label>
        <p className="muted small meas-hint">Wypełnij tylko to, co mierzysz.</p>
        <div className="meas-grid">
          {SELF_FIELDS.map(([k, label, unit]) => (
            <label key={k} className="field">
              <span>{label}</span>
              <span className="unit-input">
                <input className="input" inputMode="decimal" value={v[k] ?? ''} placeholder="—" onChange={(e) => setV({ ...v, [k]: e.target.value })} aria-label={`${label} (${unit})`} />
                <i>{unit}</i>
              </span>
            </label>
          ))}
        </div>
        <label className="field">
          <span>Notatka (opcjonalnie)</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="np. rano, na czczo" />
        </label>
      </div>
      <button className="btn btn-primary btn-block" disabled={busy} onClick={() => void save()}>
        {busy ? 'Zapisuję…' : 'Zapisz pomiar'}
      </button>
    </Sheet>
  );
}

function Progress({ clientId }: { clientId: string }) {
  const { db } = useStore();
  const sessions = sessionsOf(db, clientId);
  const [tab, setTab] = useState<'est' | 'dist'>('est');
  const [showAll, setShowAll] = useState(false);
  const names = (() => {
    const cnt: Record<string, number> = {};
    for (const s of sessions) for (const e of s.exercises) if (exerciseE1(e) != null) cnt[e.name] = (cnt[e.name] || 0) + 1;
    return Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]);
  })();
  const [ex, setEx] = useState<string | null>(null);
  const chosen = ex && names.includes(ex) ? ex : names[0];
  const series = chosen ? e1Series(sessions, chosen) : [];

  // Dystrybucja: RPE serii vs RPE sesji (ostatnie 4 tygodnie).
  const from = addDays(todayISO(), -27);
  const recent = sessions.filter((s) => s.date >= from);
  const setRpes: number[] = [];
  for (const s of recent)
    for (const e of s.exercises) {
      if (e.setsLog?.length) e.setsLog.filter((x) => !x.warmup && x.rpe != null).forEach((x) => setRpes.push(x.rpe!));
      else if (num(e.rpe) != null) for (let i = 0; i < (repsN(e.sets) || 1); i++) setRpes.push(num(e.rpe)!);
    }
  const srpes = recent.map((s) => s.srpe).filter((x): x is number => x != null);
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const buckets = [
    ['≤6', (v: number) => v <= 6],
    ['7', (v: number) => v > 6 && v <= 7],
    ['8', (v: number) => v > 7 && v <= 8],
    ['9', (v: number) => v > 8 && v <= 9],
    ['10', (v: number) => v > 9],
  ] as const;
  const counts = buckets.map(([l, f]) => [l, setRpes.filter(f).length] as const);
  const maxC = Math.max(1, ...counts.map((c) => c[1]));

  return (
    <section className="acard">
      <div className="seg seg-sm">
        <button className={tab === 'est' ? 'active' : ''} aria-pressed={tab === 'est'} onClick={() => setTab('est')}>
          Siła
        </button>
        <button className={tab === 'dist' ? 'active' : ''} aria-pressed={tab === 'dist'} onClick={() => setTab('dist')}>
          Wysiłek
        </button>
      </div>
      {tab === 'est' ? (
        names.length === 0 ? (
          <p className="muted small">Wykres pojawi się po pierwszych treningach z ciężarem.</p>
        ) : (
          <>
            <div className="between">
              <span className="muted small" title="Szacowany ciężar na 1 powtórzenie (e1RM), liczony z Twoich serii">
                Szacowany maks. ciężar (1 powt.)
              </span>
              <strong className="text-cyan">{fnum(series[series.length - 1]?.y)} kg</strong>
            </div>
            <LineChart label={`e1RM ${chosen}`} series={[{ label: chosen, pts: series, tone: 'cyan' }]} height={170} />
            <div className="chips">
              {(showAll ? names : names.slice(0, 6)).map((n) => (
                <button key={n} className={`chip ${n === chosen ? 'active' : ''}`} aria-pressed={n === chosen} onClick={() => setEx(n)}>
                  {n}
                </button>
              ))}
              {names.length > 6 && (
                <button className="chip" onClick={() => setShowAll(!showAll)}>
                  {showAll ? 'Mniej' : `+${names.length - 6} więcej`}
                </button>
              )}
            </div>
          </>
        )
      ) : (
        <>
          <div className="dist-cmp">
            <div>
              <span className="muted small">Średnie RPE serii</span>
              <strong className="big">{avg(setRpes) != null ? fx(avg(setRpes)!, 1) : '—'}</strong>
            </div>
            <div>
              <span className="muted small">Średnie RPE treningu</span>
              <strong className="big">{avg(srpes) != null ? fx(avg(srpes)!, 1) : '—'}</strong>
            </div>
          </div>
          <p className="muted small">Ostatnie 4 tygodnie · rozkład RPE serii roboczych</p>
          <div className="dist-bars">
            {counts.map(([l, c]) => (
              <div key={l} className="dist-col">
                <span className="small">{c}</span>
                <i style={{ height: `${(c / maxC) * 100}%` }} />
                <span className="muted small">{l}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Workouts({
  plan,
  extra,
  plans,
  onPlan,
  sessions,
  nextId,
  onStart,
  onTrainer,
}: {
  plan: ReturnType<typeof currentPlan> | undefined;
  /** Dodatkowe treningi poza planem — w tej samej sekcji, osobną grupą. */
  extra?: Plan;
  plans?: ReturnType<typeof plansOf>;
  onPlan?: (id: string) => void;
  sessions: ReturnType<typeof sessionsOf>;
  nextId?: string;
  onStart: (workoutId: string, planId: string) => void;
  onTrainer?: (st: RunStart) => void;
}) {
  const [preview, setPreview] = useState<{ workout: PlanWorkout; planId: string } | null>(null);
  const [shown, setShown] = useState<TrainingSession | null>(null);
  const [past, setPast] = useState(false);
  // zadane na dzień i już zrobione są w historii — z listy znikają; bez terminu zostają (do powtarzania)
  const extraWorkouts = (extra?.weeks.flatMap((w) => w.workouts) ?? []).filter((k) => extraState(k, extra?.id, sessions, todayISO()).state !== 'done');
  if (!plan && extraWorkouts.length === 0) return null;
  const done = (planId: string, id: string) => sessions.find((s) => s.planId === planId && s.workoutId === id)?.date; // sesje od najnowszej
  // Plan idzie po kolei: ✓ tylko dla jednostek przed „następną” (bieżące przejście planu); dalsze to poprzednie przejście.
  const seqIds = plan ? planSequence(plan).map((x) => x.workout.id) : [];
  const nextIdx = nextId ? seqIds.indexOf(nextId) : -1;
  // minione tygodnie (przed tygodniem następnej jednostki) — zwinięte
  const open = plan ? firstOpenWeek(plan.weeks, nextId) : 0;
  const item = (k: PlanWorkout, planId: string, isNext: boolean) => {
    const n = k.exercises.filter((e) => e.name).length;
    const dn = done(planId, k.id);
    const idx = planId === plan?.id ? seqIds.indexOf(k.id) : -1;
    const doneNow = !!dn && !isNext && (planId !== plan?.id || nextIdx < 0 || idx < nextIdx);
    const planned = planId === plan?.id && plan ? workoutDate(plan, plan.weeks.findIndex((w) => w.workouts.some((x) => x.id === k.id)), k) : undefined;
    return (
      <button key={k.id} className={`wo-item ${isNext ? 'next' : ''} ${doneNow ? 'done' : ''}`} disabled={!n} onClick={() => setPreview({ workout: k, planId })}>
        <span className="wo-st">{isNext ? '▶' : doneNow ? '✓' : ''}</span>
        <span className="wo-tx">
          <b>{k.name}</b>
          <span className="muted small">
            {n ? `${n} ${plural(n, 'ćwiczenie', 'ćwiczenia', 'ćwiczeń')}` : 'brak ćwiczeń'}
            {planned ? ` · ${fmtWeekdayDate(planned)}` : ''}
            {isNext ? ` · następny${dn ? ` (ostatnio ${fmtDay(dn)})` : ''}` : dn ? ` · ${doneNow && planId !== extra?.id ? 'zrobione' : 'ostatnio'} ${fmtDay(dn)}` : ''}
          </span>
        </span>
        <span className="wo-go">{n ? 'Zobacz ›' : ''}</span>
      </button>
    );
  };
  return (
    <section className="acard ath-plan">
      <div className="between">
        <h3>Treningi</h3>
        {plan && plans && onPlan && plans.length > 1 ? (
          <select className="input input-sm ath-sel" value={plan.id} onChange={(e) => onPlan(e.target.value)} aria-label="Wybierz plan">
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.active ? ' (aktywny)' : ''}
              </option>
            ))}
          </select>
        ) : (
          plan && <span className="muted small">{plan.name}</span>
        )}
      </div>
      {plan && open > 0 && (
        <button type="button" className="wk-past-toggle" aria-expanded={past} onClick={() => setPast(!past)}>
          <span>
            {past ? 'Ukryj' : 'Pokaż'} minione tygodnie ({open})
          </span>
          <span aria-hidden>{past ? '▴' : '▾'}</span>
        </button>
      )}
      {plan?.weeks.map((w, wi) =>
        wi < open && !past ? null : (
          <div key={w.id} className={wi < open ? 'wk-past' : ''}>
            <div className="wk-label">{w.name}</div>
            {w.workouts.map((k) => item(k, plan.id, nextId === k.id))}
          </div>
        ),
      )}
      {extra && extraWorkouts.length > 0 && (
        <div>
          <div className="wk-label">Poza planem</div>
          {extraWorkouts.map((k) => (
            <div key={k.id}>
              {item(k, extra.id, false)}
              {k.date && <span className={`muted small wo-due ${k.date < todayISO() ? 'warn-text' : ''}`}>{k.date < todayISO() ? `zaległy — był na ${fmtDay(k.date)}` : `na ${fmtDay(k.date)}`}</span>}
            </div>
          ))}
        </div>
      )}
      {preview && (
        <WorkoutPreview
          workout={preview.workout}
          done={done(preview.planId, preview.workout.id)}
          extra={preview.planId === extra?.id}
          session={sessions.find((x) => x.planId === preview.planId && x.workoutId === preview.workout.id)}
          onClose={() => setPreview(null)}
          onShowDone={() => {
            const last = sessions.find((x) => x.planId === preview.planId && x.workoutId === preview.workout.id);
            if (last) setShown(last);
          }}
          onStart={() => {
            setPreview(null);
            onStart(preview.workout.id, preview.planId);
          }}
          onTrainer={
            onTrainer &&
            (() => {
              setPreview(null);
              onTrainer({ planId: preview.planId, workoutId: preview.workout.id });
            })
          }
        />
      )}
      {shown && <SessionSheet s={shown} onClose={() => setShown(null)} />}
    </section>
  );
}
