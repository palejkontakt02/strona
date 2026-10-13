import { useEffect, useRef, useState } from 'react';
import type { Client, TrainingSession } from '../domain';
import { saveSession, sessionsOf } from '../data/ops';
import { useStore } from '../data/store';
import { uid } from '../format';
import { defaultCharge } from '../lib/billing';
import { repsN } from '../lib/parse';
import { completeSet, runToExercises, type Run, type RunSet } from '../lib/run';

let audio: AudioContext | null = null;
function beep(freq: number, dur: number) {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = freq;
    o.connect(g);
    g.connect(audio.destination);
    g.gain.setValueAtTime(0.15, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + dur);
    o.start();
    o.stop(audio.currentTime + dur);
  } catch {
    // brak dźwięku w tej przeglądarce
  }
}
function vibrate(p: number | number[]) {
  try {
    navigator.vibrate?.(p);
  } catch {
    // brak wibracji
  }
}

const fmtSec = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

interface Props {
  client: Client;
  run: Run;
  setRun: (r: Run) => void;
  onHome: () => void;
  onSaved: () => void;
}

export function Player({ client, run, setRun, onHome, onSaved }: Props) {
  const { db, apply, toast } = useStore();
  const [rest, setRest] = useState<{ end: number; total: number } | null>(null);
  const [tempoOpen, setTempoOpen] = useState(false);
  const [finish, setFinish] = useState<{ srpe: string; pain: string; duration: string; notes: string } | null>(null);
  const e = run.ex[run.idx];
  const last = run.idx === run.ex.length - 1;

  const update = (fn: (r: Run) => void) => {
    const next = structuredClone(run);
    fn(next);
    setRun(next);
  };
  const setSet = (i: number, patch: Partial<RunSet>) => update((r) => Object.assign(r.ex[r.idx].sets[i], patch));
  const go = (idx: number) => {
    update((r) => void (r.idx = idx));
    window.scrollTo(0, 0);
  };

  const onDone = (i: number) => {
    const res = completeSet(e, i);
    update((r) => void (r.ex[r.idx].sets = res.sets));
    if (res.rest) setRest({ end: Date.now() + res.rest * 1000, total: res.rest });
  };

  const save = async () => {
    if (!finish || finish.srpe === '') return;
    const sessions = sessionsOf(db, client.id);
    const today = run.date;
    const check = client.checkins.find((c) => c.date === today);
    const session: TrainingSession = {
      id: uid(),
      clientId: client.id,
      date: today,
      workoutName: run.name,
      charge: defaultCharge(client, sessions),
      duration: parseInt(finish.duration, 10) || undefined,
      srpe: Number(finish.srpe),
      pain: finish.pain === '' ? undefined : Number(finish.pain),
      notes: finish.notes.trim() || undefined,
      wellness: check ? { sleep: check.sleep, energy: check.energy, muscle: check.muscle, stress: check.stress, mood: check.mood } : undefined,
      planId: run.planId,
      workoutId: run.workoutId,
      exercises: runToExercises(run),
    };
    if (session.exercises.length === 0) return toast('Zalicz przynajmniej jedną serię (✓), zanim zapiszesz trening.');
    const { changes } = saveSession(db, { session, isNew: true });
    await apply(changes, 'Trening zapisany. Dobra robota! 💪');
    setFinish(null);
    onSaved();
  };

  const totalSets = run.ex.reduce((a, x) => a + x.sets.length, 0);
  const doneSets = run.ex.reduce((a, x) => a + x.sets.filter((s) => s.done).length, 0);
  let n = 0;

  return (
    <div className="player fade">
      <div className="between">
        <button className="btn btn-ghost btn-sm" onClick={onHome}>
          ‹ Start
        </button>
        <button className="btn btn-ghost btn-sm" disabled={!e?.tempo} onClick={() => setTempoOpen(true)}>
          ◷ Tempo
        </button>
      </div>
      <header className="player-head">
        <h1>{run.name}</h1>
        <p className="muted small">
          {[run.planName, run.weekName].filter(Boolean).join(' · ')} · {doneSets}/{totalSets} serii
        </p>
      </header>
      <div className="segs">
        {run.ex.map((x, i) => (
          <button key={i} aria-label={`Ćwiczenie ${i + 1}: ${x.name}`} className={x.sets.every((s) => s.done) ? 'on' : i === run.idx ? 'cur' : ''} onClick={() => go(i)} />
        ))}
      </div>
      <div className="muted small upper">
        Ćwiczenie {run.idx + 1} z {run.ex.length}
      </div>

      {e && (
        <section className="acard">
          <div className="between">
            <h2>{e.name}</h2>
            {e.video && (
              <a className="small" href={e.video} target="_blank" rel="noreferrer">
                ▶ Wideo
              </a>
            )}
          </div>
          <div className="muted small">
            {[e.rest && `przerwa ${e.rest}`, e.tempo && `tempo ${e.tempoStr}`].filter(Boolean).join(' · ')}
          </div>
          {e.notes && <p className="small">{e.notes}</p>}
          <button
            className="link small"
            onClick={() =>
              update((r) => {
                const sets = r.ex[r.idx].sets;
                const firstWork = sets.find((s) => !s.warmup);
                sets.unshift({ load: '', reps: firstWork?.reps || '5', rpe: '', done: false, warmup: true, sug: '', edited: false, tRpe: '', spec: '', rest: '', label: 'Rozgrzewka' });
              })
            }
          >
            + seria wstępna
          </button>

          <div className="sgrid sgrid-head">
            <span />
            <span>kg</span>
            <span>powt.</span>
            <span>RPE</span>
            <span />
          </div>
          {e.sets.map((s, i) => {
            if (!s.warmup) n++;
            return (
              <div key={i}>
                {s.first && !s.warmup && s.gdesc && (
                  <div className="ghead">
                    <b>{s.gdesc}</b>
                    {s.rest && <span className="muted small">przerwa {s.rest}</span>}
                  </div>
                )}
                <div className={`sgrid ${s.done ? 'done' : ''} ${s.warmup ? 'warm' : ''}`}>
                  <span className="sn">{s.warmup ? 'W' : n}</span>
                  <input inputMode="decimal" value={s.load} className={s.sug && !s.edited ? 'sugg' : ''} onChange={(ev) => setSet(i, { load: ev.target.value, edited: true })} aria-label={`Ciężar, seria ${i + 1}`} />
                  <input inputMode="numeric" value={s.reps} onChange={(ev) => setSet(i, { reps: ev.target.value })} aria-label={`Powtórzenia, seria ${i + 1}`} />
                  <input inputMode="decimal" value={s.rpe} placeholder={s.tRpe} onChange={(ev) => setSet(i, { rpe: ev.target.value })} aria-label={`RPE, seria ${i + 1}`} />
                  <button className="ok" aria-pressed={s.done} aria-label={s.done ? 'Cofnij serię' : 'Seria zaliczona'} onClick={() => onDone(i)}>
                    ✓
                  </button>
                </div>
                {s.sug && !s.done && <div className="sughint">{s.sug}</div>}
              </div>
            );
          })}
          <div className="between">
            <button
              className="link small"
              onClick={() =>
                update((r) => {
                  const sets = r.ex[r.idx].sets;
                  const src = sets[sets.length - 1];
                  sets.push({ ...src, done: false, rpe: '', sug: '', edited: false, first: false, warmup: false });
                })
              }
            >
              + seria
            </button>
            {e.sets.length > 1 && (
              <button className="link small muted" onClick={() => update((r) => void r.ex[r.idx].sets.pop())}>
                − usuń ostatnią
              </button>
            )}
          </div>
        </section>
      )}

      <div className="navrow">
        <button className="btn btn-ghost" disabled={run.idx === 0} onClick={() => go(run.idx - 1)}>
          ‹ poprzednie
        </button>
        {last ? (
          <button className="btn btn-primary btn-lg" onClick={() => setFinish({ srpe: '', pain: '', duration: String(Math.max(1, Math.round((Date.now() - run.startedAt) / 60000))), notes: '' })}>
            Zakończ trening
          </button>
        ) : (
          <button className="btn btn-primary btn-lg" onClick={() => go(run.idx + 1)}>
            następne ›
          </button>
        )}
      </div>
      {!last && (
        <div className="acard nextup">
          <span className="muted small">Dalej</span> {run.ex[run.idx + 1].name}
        </div>
      )}

      {rest && <RestBar rest={rest} setRest={setRest} />}
      {tempoOpen && e?.tempo && <Tempo name={e.name} phases={e.tempo} reps={repsN(e.sets.find((s) => !s.done)?.reps) || 5} onClose={() => setTempoOpen(false)} />}

      {finish && (
        <div className="sheet-bg" onMouseDown={(ev) => ev.target === ev.currentTarget && setFinish(null)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Podsumowanie treningu">
            <h2>Podsumowanie</h2>
            <div className="scale-h">
              <span>Jak ciężki był cały trening? (RPE sesji)</span>
              <span className="muted small">0 = odpoczynek · 10 = maksimum</span>
            </div>
            <div className="scale scale-11">
              {Array.from({ length: 11 }, (_, v) => String(v)).map((v) => (
                <button key={v} className={finish.srpe === v ? 'active' : ''} onClick={() => setFinish({ ...finish, srpe: v })}>
                  {v}
                </button>
              ))}
            </div>
            <div className="scale-h">
              <span>Ból / dyskomfort</span>
              <span className="muted small">0 = brak · 10 = bardzo silny</span>
            </div>
            <div className="scale scale-11">
              {Array.from({ length: 11 }, (_, v) => String(v)).map((v) => (
                <button key={v} className={finish.pain === v ? 'active' : ''} onClick={() => setFinish({ ...finish, pain: v })}>
                  {v}
                </button>
              ))}
            </div>
            <label className="field">
              <span>Czas treningu (min)</span>
              <input className="input" inputMode="numeric" value={finish.duration} onChange={(ev) => setFinish({ ...finish, duration: ev.target.value })} />
            </label>
            <label className="field">
              <span>Notatka dla trenera</span>
              <textarea className="input" rows={2} placeholder="Co poszło dobrze, co bolało?" value={finish.notes} onChange={(ev) => setFinish({ ...finish, notes: ev.target.value })} />
            </label>
            <button className="btn btn-primary btn-lg btn-block" disabled={finish.srpe === ''} onClick={save}>
              Zapisz trening
            </button>
            <button className="btn btn-ghost btn-block" onClick={() => setFinish(null)}>
              Wróć do ćwiczeń
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RestBar({ rest, setRest }: { rest: { end: number; total: number }; setRest: (r: { end: number; total: number } | null) => void }) {
  const { toast } = useStore();
  const [, tick] = useState(0);
  const left = Math.max(0, Math.round((rest.end - Date.now()) / 1000));
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (left <= 0) {
      vibrate([200, 100, 200]);
      beep(880, 0.25);
      toast('Koniec przerwy – następna seria!');
      setRest(null);
    }
  }, [left, setRest, toast]);
  return (
    <div className="restbar" role="timer" aria-label="Przerwa">
      <div className="rb-fill" style={{ width: `${100 - (left / rest.total) * 100}%` }} />
      <span>Przerwa</span>
      <b>{fmtSec(left)}</b>
      <button onClick={() => setRest({ ...rest, end: Math.max(Date.now() + 1000, rest.end - 15000) })}>−15</button>
      <button onClick={() => setRest({ end: rest.end + 15000, total: rest.total + 15 })}>+15</button>
      <button onClick={() => setRest(null)}>Pomiń</button>
    </div>
  );
}

const PHASES = [
  ['opuszczanie', 'w dół'],
  ['pauza w dole', ''],
  ['podnoszenie', 'w górę'],
  ['pauza w górze', ''],
] as const;

/** Metronom tempa: fazy z zapisu „3-1-X-0”, licznik powtórzeń, sygnał dźwiękowy na każdą fazę. */
function Tempo({ name, phases, reps: reps0, onClose }: { name: string; phases: [number, number, number, number]; reps: number; onClose: () => void }) {
  const [ph, setPh] = useState<number[]>([...phases]);
  const [reps, setReps] = useState(reps0);
  const [state, setState] = useState({ running: false, rep: 0, phase: 0, t0: 0 });
  const [, tick] = useState(0);
  const ref = useRef(state);
  ref.current = state;

  useEffect(() => {
    if (!state.running) return;
    const t = setInterval(() => {
      const s = { ...ref.current };
      let changed = false;
      while (s.running && (Date.now() - s.t0) / 1000 >= ph[s.phase]) {
        s.t0 += ph[s.phase] * 1000;
        s.phase++;
        changed = true;
        if (s.phase > 3) {
          s.phase = 0;
          s.rep++;
          if (s.rep >= reps) {
            s.running = false;
            beep(660, 0.4);
            vibrate(300);
            break;
          }
        }
        if (ph[s.phase] > 0) beep(s.phase === 0 ? 520 : s.phase === 2 ? 780 : 440, 0.08);
      }
      if (changed) setState(s);
      tick((x) => x + 1);
    }, 50);
    return () => clearInterval(t);
  }, [state.running, ph, reps]);

  const cur = ph[state.phase];
  const fill = state.running ? (cur ? Math.min(1, (Date.now() - state.t0) / 1000 / cur) : 1) : 1;
  const pos = state.running ? (state.phase === 0 ? (1 - fill) * 85 : state.phase === 2 ? fill * 85 : state.phase === 1 ? 0 : 85) : 85;
  const finished = !state.running && state.rep >= reps;

  return (
    <div className="tempo-ov" role="dialog" aria-modal="true" aria-label="Metronom tempa">
      <div className="between">
        <b>{name}</b>
        <button className="link" onClick={onClose}>
          Zamknij
        </button>
      </div>
      <div className="tempo-main">
        <div className="tbar">
          <span className="muted small">GÓRA</span>
          <div className="track">
            <i style={{ bottom: `${pos}%` }} />
          </div>
          <span className="muted small">DÓŁ</span>
        </div>
        <div className="tbig">
          <div className="n">{state.running ? state.rep + 1 : finished ? '✓' : '—'}</div>
          <div className="l">{state.running ? PHASES[state.phase][0] : finished ? 'seria zakończona' : 'gotowy?'}</div>
          <div className="muted">{state.running ? PHASES[state.phase][1] : ''}</div>
        </div>
      </div>
      <p className="muted small center">
        powtórzenie {Math.min(state.rep + (state.running ? 1 : 0), reps)} z {reps}
      </p>
      <button
        className="btn btn-primary btn-lg btn-block"
        onClick={() => {
          if (state.running) setState({ ...state, running: false });
          else {
            beep(520, 0.08);
            setState({ running: true, rep: 0, phase: 0, t0: Date.now() });
          }
        }}
      >
        {state.running ? 'Stop' : 'Start'}
      </button>
      <p className="muted small">Fazy z planu – możesz je dostosować do tej serii. Nie zmienia to planu od trenera.</p>
      {PHASES.map(([l], i) => (
        <label key={l} className="tempo-slider">
          <span className="between">
            <span>{l}</span>
            <b>{ph[i]} s</b>
          </span>
          <input type="range" min={0} max={6} step={1} value={ph[i]} disabled={state.running} onChange={(ev) => setPh(ph.map((v, j) => (j === i ? Number(ev.target.value) : v)))} />
        </label>
      ))}
      <label className="tempo-slider">
        <span className="between">
          <span>Powtórzenia</span>
          <b>{reps}</b>
        </span>
        <input type="range" min={1} max={20} value={reps} disabled={state.running} onChange={(ev) => setReps(Number(ev.target.value))} />
      </label>
    </div>
  );
}
