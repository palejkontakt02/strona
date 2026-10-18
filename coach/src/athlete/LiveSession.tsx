import { useEffect, useRef, useState } from 'react';
import { Avatar, Icon } from '../components/ui';
import { clientById, extraPlanOf, plansOf, sessionsOf } from '../data/ops';
import { useStore } from '../data/store';
import { dropUnsavedVideos } from '../data/videos';
import { fmtDay, nEx } from '../format';
import { todayISO } from '../lib/dates';
import { currentPlan, doneInPass, nextWorkout, planSequence } from '../lib/plan';
import { buildRun, emptyRun, sessionToRun, type Run } from '../lib/run';
import { loadRun, storeRun } from './AthleteApp';
import { Player } from './Player';
import { runFromStart, type RunStart } from './start';

/**
 * Trener prowadzi trening 1:1 na żywo: wybór jednostki z planu (albo pusty trening),
 * zapis seria po serii, rozliczenie przy zakończeniu. Postęp zostaje w pamięci urządzenia,
 * więc można wrócić do panelu i kontynuować.
 */
export function LiveSession({
  clientId,
  appointmentId,
  editSessionId,
  start: initial,
  onExit,
}: {
  clientId: string;
  appointmentId?: string;
  editSessionId?: string;
  start?: RunStart;
  onExit: () => void;
}) {
  const { db, toast, ask } = useStore();
  const client = clientById(db, clientId);
  // Poprawki zapisanego treningu trzymamy tylko w pamięci — nie nadpisują treningu w toku.
  const editing = !!editSessionId;
  const [run, setRunState] = useState<Run | null>(() => {
    const s = editSessionId ? db.sessions.find((x) => x.id === editSessionId) : undefined;
    if (s) return sessionToRun(s);
    const stored = loadRun(clientId, 'live');
    return stored && !stored.editSessionId ? stored : null;
  });
  // Trening uruchomiony z wizyty pamięta ją, także po wyjściu do panelu i powrocie przez pasek.
  const setRun = (r: Run | null) => setRunState(r && !r.editSessionId && appointmentId && !r.appointmentId ? { ...r, appointmentId } : r);
  const [planId, setPlanId] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) storeRun(clientId, run, 'live');
  }, [clientId, run, editing]);
  // Start od razu z wybranego treningu (lista treningów, historia); trening w toku zastępujemy tylko po potwierdzeniu.
  const started = useRef(false);
  useEffect(() => {
    if (!initial || editing || started.current) return;
    started.current = true;
    const r = runFromStart(db, clientId, initial, todayISO());
    if (typeof r === 'string') return void toast(r);
    void (async () => {
      if (run && run.ex.some((e) => e.sets.some((x) => x.done)) && !(await ask('Masz rozpoczęty trening z tym podopiecznym. Porzucić go i zacząć wybrany?', { confirm: 'Tak' }))) return;
      // ten sam trening podopieczny już zaczął sam — przejmujemy jego serie
      const own = loadRun(clientId);
      if (own && !own.editSessionId && own.workoutId && own.workoutId === r.workoutId && own.ex.some((e) => e.sets.some((x) => x.done))) {
        if (await ask(`${client?.name.split(' ')[0] ?? 'Podopieczny'} zaczął już ten trening (${own.ex.reduce((a, e) => a + e.sets.filter((x) => x.done).length, 0)} serii). Przejąć i kontynuować od tego miejsca?`, { confirm: 'Przejmij' })) {
          storeRun(clientId, null);
          setRun(own);
          window.scrollTo(0, 0);
          return;
        }
      }
      setRun(r);
      window.scrollTo(0, 0);
    })();
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
  const nx = nextWorkout(plan, sessions);
  const extra = extraPlanOf(db, clientId);
  const extraWorkouts = extra?.weeks.flatMap((w) => w.workouts).filter((k) => k.exercises.some((e) => e.name)) ?? [];
  const startExtra = (workoutId: string) => {
    const r = runFromStart(db, clientId, { planId: extra?.id, workoutId }, todayISO());
    if (typeof r === 'string') return toast(r);
    setRun(r);
    window.scrollTo(0, 0);
  };
  const done: Record<string, string> = {};
  for (const s of sessions) if (plan && s.planId === plan.id && s.workoutId && !done[s.workoutId]) done[s.workoutId] = s.date; // sesje od najnowszej
  const inPass = doneInPass(plan ?? null, sessions);

  const start = (workoutId: string | null) => {
    if (!workoutId || !plan) {
      setRun(emptyRun('Trening', todayISO()));
      return;
    }
    const step = planSequence(plan).find((x) => x.workout.id === workoutId);
    if (!step) return toast('Nie znaleziono treningu w planie.');
    const videos = Object.fromEntries(db.library.map((e) => [e.name, e.video]));
    setRun(buildRun(plan, step.week.name, step.workout, sessions, videos, todayISO(), Date.now(), client.tests));
    window.scrollTo(0, 0);
  };

  return (
    <div className="ath">
      <div className="ath-preview live-bar">
        <span className="row-inline">
          <Avatar name={client.name} size={24} /> Trening na żywo · {client.name}
        </span>
        <button
          className="btn btn-ghost btn-sm"
          onClick={async () => {
            if (editing && run && !(await ask('Wyjść bez zapisywania poprawek? Zapisany trening zostanie bez zmian.', { confirm: 'Wyjdź' }))) return;
            onExit();
          }}
        >
          ‹ Panel
        </button>
      </div>
      {run ? (
        <Player
          mode="trainer"
          client={client}
          run={run}
          setRun={setRun}
          homeLabel={run.editSessionId ? '‹ Anuluj poprawki' : '‹ Zmień trening'}
          appointmentId={run.appointmentId ?? appointmentId}
          onHome={async () => {
            if (run.editSessionId) {
              if (await ask('Porzucić poprawki? Zapisany trening zostanie bez zmian.', { confirm: 'Porzuć' })) {
                setRun(null);
                onExit();
              }
              return;
            }
            const started = run.ex.some((e) => e.sets.some((s) => s.done));
            if (!started || (await ask('Porzucić ten trening i wybrać inny? Zaliczone serie nie zostaną zapisane.', { confirm: 'Porzuć' }))) {
              dropUnsavedVideos(run.ex.flatMap((e) => e.sets.map((x) => x.video)), db.sessions);
              setRun(null);
            }
          }}
          onCancel={() => {
            if (!editing) {
              dropUnsavedVideos(run.ex.flatMap((e) => e.sets.map((x) => x.video)), db.sessions);
              storeRun(clientId, null, 'live');
            }
            setRun(null);
            toast(editing ? 'Poprawki anulowane.' : 'Trening anulowany.');
            onExit();
          }}
          onSaved={() => {
            if (!editing) storeRun(clientId, null, 'live');
            setRun(null);
            onExit();
          }}
        />
      ) : (
        <div className="fade">
          <header className="ath-hello">
            <h1>Który trening?</h1>
            <p className="muted">
              {plan ? plan.name : 'Brak planu'}
              {nx && ` · następny: ${nx.workout.name}`}
            </p>
          </header>
          {(() => {
            // podopieczny zaczął trening sam (ten sam telefon/podgląd) — przejęcie zamiast drugiego zapisu
            const own = loadRun(clientId);
            if (!own || own.editSessionId) return null;
            const d = own.ex.reduce((a, e) => a + e.sets.filter((x) => x.done).length, 0);
            const t = own.ex.reduce((a, e) => a + e.sets.length, 0);
            return (
              <section className="acard acard-warn">
                <span className="eyebrow">{client.name.split(' ')[0]} ma rozpoczęty trening</span>
                <h2>{own.name}</h2>
                <p className="muted small">
                  {d} z {t} serii · rozpoczęty {fmtDay(own.date)}. Przejmij go, żeby nie powstały dwa zapisy.
                </p>
                <button
                  className="btn btn-primary btn-lg"
                  onClick={() => {
                    storeRun(clientId, null);
                    setRun({ ...own, appointmentId: own.appointmentId ?? appointmentId });
                    window.scrollTo(0, 0);
                  }}
                >
                  Przejmij i prowadź
                </button>
              </section>
            );
          })()}
          {nx && (
            <section className="acard acard-hero">
              <span className="eyebrow">Następny z planu</span>
              <h2>{nx.workout.name}</h2>
              <p className="muted small">
                {nx.week.name} · {nEx(nx.workout.exercises.length)}
              </p>
              <button className="btn btn-primary btn-lg" onClick={() => start(nx.workout.id)}>
                <Icon name="play" /> Start
              </button>
            </section>
          )}
          <button className="btn btn-secondary btn-block live-empty" onClick={() => start(null)}>
            + Pusty trening (dodam ćwiczenia w trakcie)
          </button>
          {plan && (
            <section className="acard">
              <div className="between">
                <h3>Inna jednostka</h3>
                {plans.length > 1 && (
                  <select className="input input-sm ath-sel" value={plan.id} onChange={(e) => setPlanId(e.target.value)} aria-label="Wybierz plan">
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.active ? ' (aktywny)' : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {plan.weeks.map((w) => (
                <div key={w.id}>
                  <div className="wk-label">{w.name}</div>
                  {w.workouts.map((k) => (
                    <button key={k.id} className={`wo-item ${nx?.workout.id === k.id ? 'next' : ''} ${inPass.has(k.id) && nx?.workout.id !== k.id ? 'done' : ''}`} disabled={!k.exercises.length} onClick={() => start(k.id)}>
                      <span className="wo-st">{nx?.workout.id === k.id ? '▶' : inPass.has(k.id) ? '✓' : ''}</span>
                      <span className="wo-tx">
                        <b>{k.name}</b>
                        <span className="muted small">
                          {nEx(k.exercises.length)}{done[k.id] ? ` · ostatnio ${fmtDay(done[k.id])}` : ''}
                        </span>
                      </span>
                      <span className="wo-go">Start</span>
                    </button>
                  ))}
                </div>
              ))}
            </section>
          )}
          {extraWorkouts.length > 0 && (
            <section className="acard">
              <h3>Dodatkowe treningi</h3>
              {extraWorkouts.map((k) => {
                const last = sessions.find((x) => x.planId === extra?.id && x.workoutId === k.id)?.date;
                return (
                  <button key={k.id} className="wo-item" onClick={() => startExtra(k.id)}>
                    <span className="wo-st">{last ? '✓' : ''}</span>
                    <span className="wo-tx">
                      <b>{k.name}</b>
                      <span className="muted small">
                        {nEx(k.exercises.length)}{last ? ` · ostatnio ${fmtDay(last)}` : ''}
                      </span>
                    </span>
                    <span className="wo-go">Start</span>
                  </button>
                );
              })}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
