import { useEffect, useRef, useState } from 'react';
import { LineChart } from '../components/charts';
import { Icon } from '../components/ui';
import type { Checkin, Plan, PlanWorkout, TrainingSession, Wellness } from '../domain';
import { clientById, deleteSession, extraPlanOf, paymentLabel, plansOf, sessionPayment, sessionsOf } from '../data/ops';
import { useStore } from '../data/store';
import { put } from '../data/db';
import { fmtDay, fmtMonth, fnum, fx, plural, nEx } from '../format';
import { addDays, todayISO, weekStart } from '../lib/dates';
import { num, repsN } from '../lib/parse';
import { currentPlan, nextWorkout, planSequence } from '../lib/plan';
import { emptyRun, sessionToRun, type Run } from '../lib/run';
import { e1Series, exerciseE1, records } from '../lib/strength';
import { streak } from '../lib/load';
import { readiness, readinessNorm, WELLNESS_ITEMS } from '../lib/wellness';
import { Player } from './Player';
import { WorkoutPreview } from './WorkoutPreview';
import { NoteToTrainer, TodayHabits } from './Today';
import { runFromStart, type RunStart } from './start';
import { History, SessionSheet, Upcoming } from './History';

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
  const [screen, setScreen] = useState<'home' | 'run'>('home');
  const [planId, setPlanId] = useState<string | null>(null);

  useEffect(() => storeRun(clientId, run), [clientId, run]);
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
  const start = (workoutId?: string) => {
    if (!plan) return startOwn();
    const id = workoutId ?? nextWorkout(plan, sessions)?.workout.id;
    if (!id) return toast('Nie znaleziono treningu w planie.');
    startFrom({ planId: plan.id, workoutId: id });
  };
  const undo = async (s: TrainingSession) => {
    if (!(await ask(`Oznaczyć trening z ${fmtDay(s.date)} jako niewykonany? Zapis ćwiczeń, serii i ciężarów zostanie usunięty, a trening z planu wróci na listę do zrobienia.`, { confirm: 'Usuń zapis' }))) return;
    const sp = sessionPayment(db, s);
    const removePayment = !!sp && mode === 'preview' && (await ask(`Usunąć też płatność „${paymentLabel(sp.payment)}” za ten trening?`, { confirm: 'Usuń płatność' }));
    const appts = db.appointments.filter((a) => a.sessionId === s.id);
    await apply(deleteSession(db, s.id, removePayment));
    // „Cofnij” przywraca zapis (i powiązaną wizytę) — na wypadek pomyłki
    toast('Trening oznaczony jako niewykonany.', {
      label: 'Cofnij',
      run: () => void apply([put('sessions', s), ...appts.map((a) => put('appointments', a))], 'Przywrócono trening.'),
    });
  };
  // Podopieczny cofa tylko swoje treningi (bez rozliczenia); trener w podglądzie — każdy.
  const canUndo = (s: TrainingSession) => mode === 'preview' || s.charge === 'brak';

  return (
    <div className="ath">
      {mode === 'client' ? (
        <div className="ath-top">
          <span className="auth-logo small-logo">
            FITOWA <span>/ coach</span>
          </span>
          <button className="btn btn-ghost btn-sm" onClick={onExit}>
            Wyloguj
          </button>
        </div>
      ) : (
        <div className="ath-preview">
          <span>Podgląd trybu zawodnika · {client.name}</span>
          <button className="btn btn-ghost btn-sm" onClick={onExit}>
            Wróć do panelu
          </button>
        </div>
      )}
      {screen === 'run' && run ? (
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
          onDiscard={() => setRun(null)}
        />
      )}
    </div>
  );
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
}) {
  const { db, ask, saveCheckin } = useStore();
  const client = clientById(db, clientId)!;
  const today = todayISO();
  const sessions = sessionsOf(db, clientId);
  const nx = nextWorkout(plan, sessions);
  const extra = extraPlanOf(db, clientId);
  const st = streak(sessions, today);
  const first = client.name.split(' ')[0];

  // cel tygodnia
  const ws = weekStart(today);
  const thisWeek = sessions.filter((s) => s.date >= ws).length;
  const goal = client.daysPerWeek || 2;

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
      </header>

      {run ? (
        <section className="acard acard-hero">
          <span className="eyebrow">W trakcie</span>
          <h2>{run.name}</h2>
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
            {nx.week.name} · {nEx(nx.workout.exercises.length)} · jednostka {nx.index + 1} z {nx.total}
          </p>
          <button className="btn btn-primary btn-lg" onClick={() => onStart(nx.workout.id)}>
            <Icon name="play" /> Start
          </button>
        </section>
      ) : (
        <section className="acard acard-hero">
          <span className="eyebrow">Trening własny</span>
          <h2>Zacznij trening</h2>
          <p className="muted small">Trener nie przygotował jeszcze planu — dodawaj ćwiczenia w trakcie, a trener zobaczy cały zapis.</p>
          <button className="btn btn-primary btn-lg" onClick={onOwn}>
            <Icon name="play" /> Start
          </button>
        </section>
      )}
      {!run && nx && (
        <button className="btn btn-ghost btn-block own-btn" onClick={onOwn}>
          + Trening własny (poza planem)
        </button>
      )}

      <Upcoming clientId={clientId} />

      <TodayHabits client={client} />
      <Checkin client={client} onSave={(c) => saveCheckin(client.id, c)} />

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
        <MonthCalendar dates={new Set(sessions.map((s) => s.date))} today={today} count={sessions.filter((s) => s.date.startsWith(today.slice(0, 7))).length} />
      </div>

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
      <NoteToTrainer client={client} />
    </div>
  );
}

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
      <p className="muted small">1 = bardzo źle · 5 = świetnie (przy stresie: 5 = brak stresu)</p>
      {WELLNESS_ITEMS.map(([k, label]) => (
        <div key={k} className="checkin-row">
          <span>{label}</span>
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

function MonthCalendar({ dates, today, count }: { dates: Set<string>; today: string; count: number }) {
  const first = today.slice(0, 7) + '-01';
  const start = weekStart(first);
  const days: string[] = [];
  for (let d = start; days.length < 42; d = addDays(d, 1)) days.push(d);
  while (days.length > 35 && days[days.length - 7].slice(0, 7) !== first.slice(0, 7)) days.splice(-7);
  const n = count;
  return (
    <section className="acard">
      <div className="between">
        <h3 className="first-cap">{fmtMonth(today.slice(0, 7))}</h3>
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
        {days.map((d) => (
          <span key={d} className={`mini-day ${d.slice(0, 7) !== first.slice(0, 7) ? 'other' : ''} ${d === today ? 'is-today' : ''} ${dates.has(d) ? 'has' : ''}`}>
            {dates.has(d) ? '✓' : Number(d.slice(8))}
          </span>
        ))}
      </div>
    </section>
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
  const extraWorkouts = extra?.weeks.flatMap((w) => w.workouts) ?? [];
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
    return (
      <button key={k.id} className={`wo-item ${isNext ? 'next' : ''} ${doneNow ? 'done' : ''}`} disabled={!n} onClick={() => setPreview({ workout: k, planId })}>
        <span className="wo-st">{isNext ? '▶' : doneNow ? '✓' : ''}</span>
        <span className="wo-tx">
          <b>{k.name}</b>
          <span className="muted small">
            {n ? `${n} ${plural(n, 'ćwiczenie', 'ćwiczenia', 'ćwiczeń')}` : 'brak ćwiczeń'}
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
          <div className="wk-label">Poza planem · w dowolnym momencie</div>
          {extraWorkouts.map((k) => item(k, extra.id, false))}
        </div>
      )}
      {preview && (
        <WorkoutPreview
          workout={preview.workout}
          done={done(preview.planId, preview.workout.id)}
          extra={preview.planId === extra?.id}
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


