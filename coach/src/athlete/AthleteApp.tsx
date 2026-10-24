import { useEffect, useRef, useState } from 'react';
import { LineChart } from '../components/charts';
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
import { fmtDur, fmtKm, planRunTotals } from '../lib/running';
import { e1Series, exerciseE1, records } from '../lib/strength';
import { streak } from '../lib/load';
import { readiness, readinessNorm, WELLNESS_ITEMS } from '../lib/wellness';
import { Player } from './Player';
import { IntakeWizard } from './Intake';
import { WorkoutPreview } from './WorkoutPreview';
import { NoteToTrainer, TodayHabits } from './Today';
import { useAthleteUnread } from '../components/Chat';
import { WeeklyReportCard } from '../components/WeeklyReport';
import { DayLogCard } from '../components/DayLog';
import { AthletePhotos } from '../components/ProgressPhotos';
import { runFromStart, type RunStart } from './start';
import { AthleteRunCards } from '../components/RunVolume'; // funkcje: bieg
import { History, SessionSheet, Upcoming, upcomingVisits } from './History';

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
  const { db, toast, ask, apply } = useStore();
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
  const [planId, setPlanId] = useState<string | null>(null);
  const [look, setLook] = useState(false);

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

  const begin = (r: Run) => {
    setRun(r);
    setScreen('run');
    window.scrollTo(0, 0);
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
    // konto podopiecznego zapisuje tylko treningi — listę dodatkowych uzupełnia trener
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
  // Podopieczny cofa tylko swoje treningi (bez rozliczenia); trener w podglądzie — każdy.
  // podopieczny: tylko własny zapis — bez rozliczenia, wizyty i komentarza trenera (przywrócenie by go nie odtworzyło)
  const canUndo = (s: TrainingSession) => mode === 'preview' || (s.charge === 'brak' && !s.reviewedAt && !s.coachNote && !db.appointments.some((a) => a.sessionId === s.id));

  return (
    <div className="ath">
      {mode === 'client' ? (
        <div className="ath-top">
          <span className="auth-logo small-logo">
            FITOWA <span>/ coach</span>
          </span>
          <span className="row-inline">
            <OfflineBadge />
            <button className="btn btn-ghost btn-sm" onClick={() => setLook(true)} aria-label="Wygląd — kolory aplikacji">
              🎨 Wygląd
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onExit}>
              Wyloguj
            </button>
          </span>
        </div>
      ) : (
        <div className="ath-preview">
          <span>Podgląd trybu zawodnika · {client.name}</span>
          <span className="row-inline">
            <button className="btn btn-ghost btn-sm" onClick={() => setLook(true)} aria-label="Wygląd — kolory aplikacji">
              🎨
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onExit}>
              Wróć do panelu
            </button>
          </span>
        </div>
      )}
      {look && (
        <Sheet label="Wygląd" onClose={() => setLook(false)}>
          <div className="between">
            <h2>Wygląd</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => setLook(false)}>
              Gotowe
            </button>
          </div>
          <p className="muted small">Wybierz kolory aplikacji — zapisują się na tym telefonie.</p>
          <PalettePicker />
          {mode === 'client' && <PushSettings role="client" />}
        </Sheet>
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
        <Home
          clientId={clientId}
          plan={plan}
          plans={plans}
          onPlan={setPlanId}
          run={run}
          onStart={start}
          onOwn={startOwn}
          onEdit={editSession}
          onRepeat={(s) => startFrom({ repeatSessionId: s.id })}
          onStartFrom={startFrom}
          onTrainer={onTrainer}
          onUndo={undo}
          canUndo={canUndo}
          onResume={() => setScreen('run')}
          onIntake={() => setScreen('intake')}
          onDiscard={() => {
            if (run) dropUnsavedVideos(run.ex.flatMap((e) => e.sets.map((x) => x.video)), db.sessions);
            setRun(null);
          }}
        />
      )}
    </div>
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
    return `🏃 ${parts.join(' · ') || 'bieg'}`;
  }
  return nEx(ex.length);
}

function Home({
  clientId,
  plan,
  plans,
  onPlan,
  run,
  onStart,
  onOwn,
  onEdit,
  onRepeat,
  onStartFrom,
  onTrainer,
  onUndo,
  canUndo,
  onResume,
  onDiscard,
  onIntake,
}: {
  clientId: string;
  plan: ReturnType<typeof currentPlan>;
  plans: ReturnType<typeof plansOf>;
  onPlan: (id: string) => void;
  run: Run | null;
  onStart: (workoutId?: string) => void;
  onOwn: () => void;
  onEdit: (s: TrainingSession) => void;
  onRepeat: (s: TrainingSession) => void;
  onStartFrom: (st: RunStart) => void;
  onTrainer?: (st: RunStart) => void;
  onUndo: (s: TrainingSession) => void;
  canUndo: (s: TrainingSession) => boolean;
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
  const st = streak(sessions, today);
  const first = client.name.split(' ')[0];
  const unreadMsgs = useAthleteUnread(client);

  // cel tygodnia
  const ws = weekStart(today);
  const thisWeek = sessions.filter((s) => s.date >= ws).length;
  const goal = client.daysPerWeek || 2;
  const visit = upcomingVisits(db.appointments, clientId)[0];
  const visitText = visit && `${visit.date === today ? 'dziś' : fmtLong(visit.date)}, ${visit.time}`;
  const loc = visit && db.locations.find((l) => l.id === visit.locationId)?.name;
  // wizyta dziś albo jutro → ten trening zwykle robi się z trenerem
  const withTrainer = !!visit && visit.date <= addDays(today, 1);

  return (
    <div className="ath-home fade">
      <header className="ath-hello">
        <h1>Cześć, {first}!</h1>
        <p className="muted">
          {plan ? plan.name : 'Brak planu'}
          {nx && ` · ${nx.week.name}`}
        </p>
        {st.weeks > 0 && (
          <span className="ath-streak">
            🔥 {st.weeks} {plural(st.weeks, 'tydzień', 'tygodnie', 'tygodni')} z rzędu · {st.sessions} {plural(st.sessions, 'trening', 'treningi', 'treningów')}
          </span>
        )}
        <button className="btn btn-ghost btn-sm msg-link" onClick={onIntake}>
          📋 {onTrainer ? 'Ankieta podopiecznego' : 'Moja ankieta'}
        </button>
        {(() => {
          const fresh = !onTrainer && unreadMsgs > 0;
          return (
            <a href="#do-trenera" className={`btn btn-sm msg-link ${fresh ? 'btn-primary' : 'btn-ghost'}`}>
              {onTrainer ? '✉ Napisz (jako trener)' : fresh ? '✉ Nowa odpowiedź trenera' : '✉ Napisz do trenera'}
              {fresh && (
                <span className="msg-badge" aria-label={`${unreadMsgs} nowe`}>
                  {unreadMsgs}
                </span>
              )}
            </a>
          );
        })()}
      </header>

      {visit && (
        <section className="acard next-visit" aria-label="Następna wizyta">
          <span className="eyebrow">Następna wizyta z trenerem</span>
          <strong className="next-visit-when first-cap">{visitText}</strong>
          {loc && <span className="muted">{loc}</span>}
        </section>
      )}

      {(() => {
        // treningi zadane przez trenera na konkretny dzień (poza planem), niezrobione: zaległe do 7 dni wstecz i do 7 dni naprzód
        const due = (extra?.weeks.flatMap((w) => w.workouts) ?? [])
          .filter((k) => k.date && k.date >= addDays(today, -7) && k.date <= addDays(today, 7) && k.exercises.some((e) => e.name))
          .filter((k) => extraState(k, extra!.id, sessions, today).state !== 'done')
          .sort((a, b) => a.date!.localeCompare(b.date!));
        if (!due.length || run) return null;
        const when = (d: string) => (d === today ? 'na dziś' : d === addDays(today, 1) ? 'na jutro' : d < today ? `zaległy z ${fmtDay(d)}` : `na ${fmtDay(d)}`);
        return due.map((k) => (
          <section key={k.id} className={`acard ${k.date! <= today ? 'acard-hero' : ''}`}>
            <span className="eyebrow">Od trenera · {when(k.date!)}</span>
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
          <h3>{run.name} · {fmtDay(run.date)}</h3>
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
            {run.ex.reduce((a, e) => a + e.sets.filter((s) => s.done).length, 0)} z {run.ex.reduce((a, e) => a + e.sets.length, 0)} serii · rozpoczęty {run.date !== todayISO() ? `${fmtDay(run.date)}, ` : ''}{new Date(run.startedAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
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
      ) : nx ? (
        <section className="acard acard-hero">
          <span className="eyebrow">Następny trening</span>
          <h2>{nx.workout.name}</h2>
          <p className="muted small">
            {nx.week.name.replace(/\s*\(deload\)/i, ' (lżejszy)')} · {nEx(nx.workout.exercises.length)} · jednostka {nx.index + 1} z {nx.total}
          </p>
          {(() => {
            // dzień z planu (ustawiony przez trenera)
            const d = plan && workoutDate(plan, plan.weeks.indexOf(nx.week), nx.workout);
            if (!d) return null;
            return <p className={`small ${d < today ? 'warn-text' : ''}`}>{d < today ? `Zaplanowany na ${fmtDay(d)} — zaległy` : `Zaplanowany na ${dayWord(d, today)}`}</p>;
          })()}
          {withTrainer && <p className="small">Ten trening zrobicie razem na wizycie ({visitText}). Start tylko, jeśli ćwiczysz dziś sam(a).</p>}
          {(() => {
            const ci = client.checkins.find((c) => c.date === today);
            const r = readiness(ci);
            return r != null && r <= 2.5 ? <p className="small warn-text">Gorsze samopoczucie dziś ({fx(r, 1)}/5) — zrób lżej: mniej serii albo ciężar o RPE niżej. Ból lub zawroty głowy → nie trenuj i napisz do trenera.</p> : null;
          })()}
          <button className={`btn ${withTrainer ? 'btn-secondary' : 'btn-primary'} btn-lg`} onClick={() => onStart(nx.workout.id)}>
            <Icon name="play" /> {withTrainer ? 'Start samodzielnie' : 'Start'}
          </button>
        </section>
      ) : (
        <section className="acard acard-hero">
          <span className="eyebrow">Trening własny</span>
          <h2>Zacznij trening</h2>
          <p className="muted small">
            {extra?.weeks.some((w) => w.workouts.some((k) => k.exercises.some((e) => e.name)))
              ? 'Poza treningami od trenera możesz zrobić własny — dodawaj ćwiczenia w trakcie, a trener zobaczy cały zapis.'
              : 'Trener nie przygotował jeszcze planu — dodawaj ćwiczenia w trakcie, a trener zobaczy cały zapis.'}
          </p>
          <button className="btn btn-primary btn-lg" onClick={onOwn}>
            <Icon name="play" /> Start
          </button>
        </section>
      )}
      {!run && (nx || sessions[0]) && (
        <div className={`ath-quick ${nx && sessions[0] ? 'two' : ''}`}>
          {nx && (
            <button className="btn btn-ghost btn-block own-btn" onClick={onOwn}>
              + Trening własny (poza planem)
            </button>
          )}
          {sessions[0] && (
            <button className="btn btn-ghost btn-block repeat-btn" onClick={() => onRepeat(sessions[0])} title={`${sessions[0].workoutName || 'Trening'} z ${fmtDay(sessions[0].date)} — te same ćwiczenia, ciężary z ostatniego razu`}>
              <span>↻ Powtórz ostatni trening</span>
              <span className="muted small ellipsis">
                {sessions[0].workoutName || 'Trening'} · {fmtDay(sessions[0].date)}
              </span>
            </button>
          )}
        </div>
      )}
      {/* funkcje: bieg — import z zegarka (GPX/TCX/FIT) + kilometraż plan vs wykonanie; tylko dla biegających (components/RunVolume.tsx) */}
      <AthleteRunCards client={client} canImport={!run} />

      {!client.intake?.completedAt && (
        <section className="acard acard-warn">
          <span className="eyebrow">Ankieta startowa</span>
          <h3>Zdrowie, styl życia, jedzenie, sport i cele</h3>
          <p className="muted small">Ok. 5 minut. Dzięki niej trener dopasuje treningi bezpiecznie do Ciebie.</p>
          <button className="btn btn-primary" onClick={onIntake}>
            Wypełnij ankietę
          </button>
        </section>
      )}
      <WeeklyReportCard client={client} />
      <TodayHabits client={client} />
      <DayLogCard client={client} />
      <Checkin client={client} onSave={(c) => saveCheckin(client.id, c)} />
      <Upcoming clientId={clientId} limit={2} />

      <div className="ath-grid">
        <section className="acard">
          <h3>Cel tygodnia</h3>
          <div className="ring-wrap">
            <Ring value={thisWeek} max={goal} />
            <div>
              <strong className="big">
                {thisWeek}/{goal}
              </strong>
              <p className="muted small">{thisWeek >= goal ? 'Cel osiągnięty 💪' : `Zostało ${goal - thisWeek}`}</p>
            </div>
          </div>
        </section>
        <MonthCalendar done={sessions.reduce((m, s) => m.set(s.date, [...(m.get(s.date) ?? []), s.workoutName || 'Trening']), new Map<string, string[]>())} today={today} planned={plannedByDay(db, clientId, plan, extra, sessions, today)} />
      </div>

      <BodyProgress client={client} />
      <AthletePhotos client={client} />
      <Progress clientId={clientId} />

      <Workouts plan={plan} extra={extra} plans={plans} onPlan={onPlan} sessions={sessions} nextId={nx?.workout.id} onStart={(id, planId) => (planId === plan?.id ? onStart(id) : onStartFrom({ planId, workoutId: id }))} onTrainer={onTrainer} />

      <History
        plain={!onTrainer}
        clientId={clientId}
        onEdit={onEdit}
        onRepeat={onRepeat}
        onTrainer={onTrainer && ((s) => onTrainer({ repeatSessionId: s.id }))}
        onUndo={onUndo}
        canUndo={canUndo}
      />
      <NoteToTrainer client={client} asTrainer={!!onTrainer} />
    </div>
  );
}

/** Opis końców skali (1 … 5), żeby nie trzeba było zgadywać kierunku. */
const ENDS: Record<string, string> = {
  sleep: '1 źle spałem/am · 5 świetnie',
  energy: '1 brak sił · 5 pełno energii',
  muscle: '1 bardzo obolałe · 5 świeże',
  stress: '1 duży stres · 5 spokój',
  mood: '1 kiepski · 5 świetny',
};

function Checkin({ client, onSave }: { client: NonNullable<ReturnType<typeof clientById>>; onSave: (c: Checkin) => void }) {
  const { db } = useStore();
  const today = todayISO();
  const existing = client.checkins.find((c) => c.date === today);
  const [w, setW] = useState<Wellness>(existing ?? {});
  const [editing, setEditing] = useState(!existing);
  const norm = readinessNorm(client.checkins, sessionsOf(db, client.id), today);
  const r = readiness(existing);

  if (!editing && existing && r != null) {
    const diff = norm != null ? r - norm : null;
    return (
      <section className="acard">
        <div className="between">
          <h3>Gotowość dziś</h3>
          <button className="link small" onClick={() => setEditing(true)}>
            zmień
          </button>
        </div>
        <div className="readiness">
          <strong className="big">{fx(r, 1)}</strong>
          <span className="muted">/ 5</span>
          {diff != null && (
            <span className={`tag ${diff >= 0 ? 'tag-ok' : diff > -0.5 ? 'tag-neutral' : 'tag-warn'}`}>
              {diff >= 0.25 ? 'lepiej niż zwykle' : diff > -0.25 ? 'jak zwykle' : diff > -0.5 ? 'trochę gorzej niż zwykle' : 'gorzej niż zwykle'}
            </span>
          )}
        </div>
        <p className="muted small">{diff == null ? 'Porównanie z Twoim zwykłym samopoczuciem pojawi się po kilku dniach wpisów.' : diff >= 0 ? 'Jesteś w formie — trenuj zgodnie z planem.' : diff > -0.5 ? 'Trochę gorzej niż zwykle — nie forsuj ciężarów, jeśli serie idą ciężko.' : 'Wyraźnie poniżej normy — rozważ lżejszy trening i daj znać trenerowi.'}</p>
      </section>
    );
  }

  const complete = WELLNESS_ITEMS.every(([k]) => w[k] != null);
  return (
    <section className="acard">
      <h3>Jak się dziś czujesz?</h3>
      <p className="muted small">Im wyżej, tym lepiej: 1 = źle · 5 = świetnie</p>
      {WELLNESS_ITEMS.map(([k, label]) => (
        <div key={k} className="checkin-row">
          <span>
            {label}
            <span className="muted small checkin-ends">{ENDS[k]}</span>
          </span>
          <div className="scale scale-5" role="radiogroup" aria-label={label}>
            {[1, 2, 3, 4, 5].map((v) => (
              <button key={v} type="button" role="radio" aria-checked={w[k] === v} className={w[k] === v ? 'active' : ''} onClick={() => setW({ ...w, [k]: v })} aria-label={`${label} ${v}`}>
                {v}
              </button>
            ))}
          </div>
        </div>
      ))}
      <button
        className="btn btn-primary btn-block"
        disabled={!complete}
        onClick={() => {
          onSave({ date: today, ...w });
          setEditing(false);
        }}
      >
        Zapisz
      </button>
      {!complete && <p className="muted small center">Zaznacz odpowiedź w każdym z {WELLNESS_ITEMS.length} wierszy ({WELLNESS_ITEMS.filter(([k]) => w[k] != null).length}/{WELLNESS_ITEMS.length}).</p>}
    </section>
  );
}

function Ring({ value, max }: { value: number; max: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const p = Math.min(1, value / Math.max(1, max));
  return (
    <svg width={76} height={76} viewBox="0 0 76 76" aria-hidden>
      <circle cx={38} cy={38} r={r} className="ring-bg" />
      <circle cx={38} cy={38} r={r} className="ring-fg" strokeDasharray={`${c * p} ${c}`} transform="rotate(-90 38 38)" />
    </svg>
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
        if (d && !done.has(k.id) && k.exercises.some((e) => e.name)) add(d, { kind: 'plan', text: `${k.name} (${w.name})`, run: isRunWorkout(k) });
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
        <span className="dot todo" /> trening do zrobienia · <span className="dot visit" /> wizyta · <span className="dot done" /> zrobiony
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
              {x.kind === 'visit' ? '🗓 ' : pick < today ? '⚠ ' : x.run ? '🏃 ' : '🏋 '}
              {x.text}
              {x.kind !== 'visit' && pick < today ? ' — zaległy' : ''}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Pomiary ciała dla podopiecznego: waga i obwody — zmiana od pierwszego pomiaru, przebieg i własny wpis. */
function BodyProgress({ client }: { client: NonNullable<ReturnType<typeof clientById>> }) {
  const [adding, setAdding] = useState(false);
  const ms = allMeasurements(client).sort((a, b) => a.date.localeCompare(b.date));
  const field = ms.some((m) => m.weight != null) ? 'weight' : ms.some((m) => m.waist != null) ? 'waist' : null;
  const vals = field ? ms.filter((m) => m[field] != null) : [];
  const waist = ms.filter((m) => m.waist != null);
  const wd = waist.length >= 2 ? waist[waist.length - 1].waist! - waist[0].waist! : null;
  return (
    <section className="acard">
      <div className="between">
        <h3>Twoje ciało</h3>
        <button className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}>
          + Dodaj pomiar
        </button>
      </div>
      {!field || !vals.length ? (
        <p className="muted small">Wpisuj wagę i obwody (np. raz w tygodniu, rano na czczo) — zobaczysz tu zmianę, a trener dostanie pomiar.</p>
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
          {vals.length >= 2 && <LineChart label={field === 'weight' ? 'Waga' : 'Talia'} series={[{ label: field === 'weight' ? 'Waga (kg)' : 'Talia (cm)', pts: vals.map((m) => ({ x: m.date, y: m[field]! })) }]} />}
        </>
      )}
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

function AddMeasurement({ client, onClose }: { client: NonNullable<ReturnType<typeof clientById>>; onClose: () => void }) {
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
      <div className="between">
        <h3>Nowy pomiar</h3>
        <button className="icon-btn" aria-label="Zamknij" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <div className="meas-form">
        <label className="field">
          <span>Data</span>
          <input className="input" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
        </label>
        <p className="muted small meas-hint">Wpisz tylko to, co mierzysz — resztę zostaw pustą.</p>
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
  const recs = records(sessions).slice(0, 5);

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
          <p className="muted small">Szacowany maksymalny ciężar pojawi się po pierwszych treningach z ciężarem.</p>
        ) : (
          <>
            <div className="between">
              <span className="muted small" title="Szacowany ciężar na 1 powtórzenie (e1RM), liczony z Twoich serii">Szacowany maks. ciężar (1 powt.)</span>
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
      {recs.length > 0 && (
        <>
          <h3 className="ath-sub">Ostatnie rekordy</h3>
          <ul className="rows">
            {recs.map((r, i) => (
              <li key={i} className="row">
                <span className="text-green">★</span>
                <span className="grow">
                  {r.name}
                  <span className="muted small"> · {fmtDay(r.date)}</span>
                </span>
                <span className="small">
                  {String(r.reps)} × {fnum(num(r.load))} kg
                </span>
              </li>
            ))}
          </ul>
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
  // zadane na dzień i już zrobione są w historii — z listy znikają; bez terminu zostają (do powtarzania)
  const extraWorkouts = (extra?.weeks.flatMap((w) => w.workouts) ?? []).filter((k) => extraState(k, extra?.id, sessions, todayISO()).state !== 'done');
  if (!plan && extraWorkouts.length === 0) return null;
  const done = (planId: string, id: string) => sessions.find((s) => s.planId === planId && s.workoutId === id)?.date; // sesje od najnowszej
  // Plan idzie po kolei: ✓ tylko dla jednostek przed „następną” (bieżące przejście planu); dalsze to poprzednie przejście.
  const seqIds = plan ? planSequence(plan).map((x) => x.workout.id) : [];
  const nextIdx = nextId ? seqIds.indexOf(nextId) : -1;
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
            {isNext ? ` · następny — do zrobienia${dn ? ` (ostatnio ${fmtDay(dn)})` : ''}` : dn ? ` · ${doneNow && planId !== extra?.id ? 'zrobione' : 'ostatnio'} ${fmtDay(dn)}` : ''}
          </span>
        </span>
        <span className="wo-go">{n ? 'Zobacz ›' : ''}</span>
      </button>
    );
  };
  return (
    <section className="acard">
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
      {plan?.weeks.map((w) => (
        <div key={w.id}>
          <div className="wk-label">{w.name}</div>
          {w.workouts.map((k) => item(k, plan.id, nextId === k.id))}
        </div>
      ))}
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


