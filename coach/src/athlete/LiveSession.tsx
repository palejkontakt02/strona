import { useEffect, useState } from 'react';
import { Avatar, Icon } from '../components/ui';
import { clientById, plansOf, sessionsOf } from '../data/ops';
import { useStore } from '../data/store';
import { fmtDay } from '../format';
import { todayISO } from '../lib/dates';
import { currentPlan, nextWorkout, planSequence } from '../lib/plan';
import { buildRun, emptyRun, type Run } from '../lib/run';
import { loadRun, storeRun } from './AthleteApp';
import { Player } from './Player';

/**
 * Trener prowadzi trening 1:1 na żywo: wybór jednostki z planu (albo pusty trening),
 * zapis seria po serii, rozliczenie przy zakończeniu. Postęp zostaje w pamięci urządzenia,
 * więc można wrócić do panelu i kontynuować.
 */
export function LiveSession({ clientId, appointmentId, onExit }: { clientId: string; appointmentId?: string; onExit: () => void }) {
  const { db, toast, ask } = useStore();
  const client = clientById(db, clientId);
  const [run, setRun] = useState<Run | null>(() => loadRun(clientId, 'live'));
  const [planId, setPlanId] = useState<string | null>(null);

  useEffect(() => storeRun(clientId, run, 'live'), [clientId, run]);
  useEffect(() => {
    document.body.classList.add('athlete-mode');
    return () => document.body.classList.remove('athlete-mode');
  }, []);

  if (!client) return null;
  const plans = plansOf(db, clientId);
  const plan = plans.find((p) => p.id === planId) ?? currentPlan(plans);
  const sessions = sessionsOf(db, clientId);
  const nx = nextWorkout(plan, sessions);
  const done: Record<string, string> = {};
  for (const s of [...sessions].reverse()) if (plan && s.planId === plan.id && s.workoutId && !done[s.workoutId]) done[s.workoutId] = s.date;

  const start = (workoutId: string | null) => {
    if (!workoutId || !plan) {
      setRun(emptyRun('Trening', todayISO()));
      return;
    }
    const step = planSequence(plan).find((x) => x.workout.id === workoutId);
    if (!step) return toast('Nie znaleziono treningu w planie.');
    const videos = Object.fromEntries(db.library.map((e) => [e.name, e.video]));
    setRun(buildRun(plan, step.week.name, step.workout, sessions, videos, todayISO()));
    window.scrollTo(0, 0);
  };

  return (
    <div className="ath">
      <div className="ath-preview live-bar">
        <span className="row-inline">
          <Avatar name={client.name} size={24} /> Trening na żywo · {client.name}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={onExit}>
          ‹ Panel
        </button>
      </div>
      {run ? (
        <Player
          mode="trainer"
          client={client}
          run={run}
          setRun={setRun}
          homeLabel="‹ Zmień trening"
          appointmentId={appointmentId}
          onHome={async () => {
            const started = run.ex.some((e) => e.sets.some((s) => s.done));
            if (!started || (await ask('Porzucić ten trening i wybrać inny? Zaliczone serie nie zostaną zapisane.', { confirm: 'Porzuć' }))) setRun(null);
          }}
          onSaved={() => {
            storeRun(clientId, null, 'live');
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
          {nx && (
            <section className="acard acard-hero">
              <span className="eyebrow">Następny z planu</span>
              <h2>{nx.workout.name}</h2>
              <p className="muted small">
                {nx.week.name} · {nx.workout.exercises.length} ćwiczeń
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
                    <button key={k.id} className={`wo-item ${nx?.workout.id === k.id ? 'next' : ''} ${done[k.id] ? 'done' : ''}`} disabled={!k.exercises.length} onClick={() => start(k.id)}>
                      <span className="wo-st">{done[k.id] ? '✓' : nx?.workout.id === k.id ? '▶' : ''}</span>
                      <span className="wo-tx">
                        <b>{k.name}</b>
                        <span className="muted small">
                          {k.exercises.length} ćwiczeń{done[k.id] ? ` · ostatnio ${fmtDay(done[k.id])}` : ''}
                        </span>
                      </span>
                      <span className="wo-go">Start</span>
                    </button>
                  ))}
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
