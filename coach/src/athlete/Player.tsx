import { useEffect, useRef, useState } from 'react';
import { IconBtn } from '../components/ui';
import { ChargeSelect, LocationSelect } from '../components/location';
import type { Billing, Client, TrainingSession } from '../domain';
import { savePlan, saveSession, sessionsOf } from '../data/ops';
import { useStore } from '../data/store';
import { uid } from '../format';
import { defaultCharge, packageStatus } from '../lib/billing';
import { num, repsN } from '../lib/parse';
import {
  adHocExercise,
  appendExercise,
  applyRunLayout,
  blockRest,
  completeSet,
  moveExercise,
  removeExercise,
  renameExercise,
  runBlocks,
  runToExercises,
  toggleLink,
  type Run,
  type RunSet,
} from '../lib/run';

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
  /** `trainer` — trener prowadzi trening 1:1 (rozliczenie przy zapisie, wizyta → odbyta). */
  mode?: 'athlete' | 'trainer';
  homeLabel?: string;
  appointmentId?: string;
}

interface Finish {
  srpe: string;
  pain: string;
  duration: string;
  notes: string;
  charge: Billing;
  amount: string;
  paidNow: boolean;
  locationId: string;
}

export function Player({ client, run, setRun, onHome, onSaved, mode = 'athlete', homeLabel = '‹ Start', appointmentId }: Props) {
  const { db, apply, toast } = useStore();
  const [rest, setRest] = useState<{ end: number; total: number } | null>(null);
  const [tempoOpen, setTempoOpen] = useState(false);
  const [finish, setFinish] = useState<Finish | null>(null);
  const [adding, setAdding] = useState(run.ex.length === 0);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const trainer = mode === 'trainer';
  const blocks = runBlocks(run);
  const bi = Math.max(0, blocks.findIndex((b) => b.includes(run.idx)));
  const block = blocks[bi] ?? [];
  const last = bi >= blocks.length - 1;
  const tempoEx = block.map((k) => run.ex[k]).find((x) => x.tempo);
  const [hintNext, setHintNext] = useState<number | null>(null);

  const update = (fn: (r: Run) => void) => {
    const next = structuredClone(run);
    fn(next);
    setRun(next);
    return next;
  };
  const setSet = (k: number, i: number, patch: Partial<RunSet>) => update((r) => void Object.assign(r.ex[k].sets[i], patch));
  const go = (b: number) => {
    setHintNext(null);
    update((r) => void (r.idx = blocks[b][0]));
    window.scrollTo(0, 0);
  };

  const onDone = (k: number, i: number) => {
    const wasDone = run.ex[k].sets[i].done;
    const res = completeSet(run.ex[k], i);
    const next = update((r) => void (r.ex[k].sets = res.sets));
    if (wasDone) return;
    const br = blockRest(next, k, i);
    setHintNext(br.next ?? null);
    if (br.rest) setRest({ end: Date.now() + br.rest * 1000, total: br.rest });
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
      charge: trainer ? finish.charge : defaultCharge(client, sessions),
      duration: parseInt(finish.duration, 10) || undefined,
      srpe: Number(finish.srpe),
      pain: finish.pain === '' ? undefined : Number(finish.pain),
      notes: finish.notes.trim() || undefined,
      wellness: check ? { sleep: check.sleep, energy: check.energy, muscle: check.muscle, stress: check.stress, mood: check.mood } : undefined,
      locationId: (trainer ? finish.locationId : client.locationId) || undefined,
      planId: run.planId,
      workoutId: run.workoutId,
      exercises: runToExercises(run),
    };
    if (session.exercises.length === 0) return toast('Zalicz przynajmniej jedną serię (✓), zanim zapiszesz trening.');
    const { changes, message } = saveSession(db, { session, isNew: true, appointmentId, amount: trainer ? num(finish.amount) ?? undefined : undefined, paidNow: finish.paidNow });
    await apply(changes, trainer ? message : 'Trening zapisany. Dobra robota! 💪');
    setFinish(null);
    onSaved();
  };

  const openFinish = () => {
    const charge = defaultCharge(client, sessionsOf(db, client.id));
    setFinish({
      srpe: '',
      pain: '',
      duration: String(Math.max(1, Math.round((Date.now() - run.startedAt) / 60000))),
      notes: '',
      charge,
      amount: client.singleRate ? String(client.singleRate) : '',
      paidNow: true,
      locationId: db.appointments.find((a) => a.id === appointmentId)?.locationId ?? client.locationId ?? '',
    });
  };

  const totalSets = run.ex.reduce((a, x) => a + x.sets.length, 0);
  const doneSets = run.ex.reduce((a, x) => a + x.sets.filter((s) => s.done).length, 0);
  const blockName = (b: number[]) => b.map((k) => run.ex[k].name).join(' + ');

  const setRow = (k: number, i: number, num: string, label?: string) => {
    const s = run.ex[k].sets[i];
    return (
      <div key={`${k}-${i}`}>
        <div className={`sgrid ${s.done ? 'done' : ''} ${s.warmup ? 'warm' : ''} ${hintNext === k && !s.done ? 'is-next' : ''}`}>
          <span className="sn">{label ? <span className="ex-label">{label}</span> : num}</span>
          <input inputMode="decimal" value={s.load} className={s.sug && !s.edited ? 'sugg' : ''} onChange={(ev) => setSet(k, i, { load: ev.target.value, edited: true })} aria-label={`Ciężar, ${run.ex[k].name}, seria ${num}`} />
          <input inputMode="numeric" value={s.reps} onChange={(ev) => setSet(k, i, { reps: ev.target.value })} aria-label={`Powtórzenia, ${run.ex[k].name}, seria ${num}`} />
          <input inputMode="decimal" value={s.rpe} placeholder={s.tRpe} onChange={(ev) => setSet(k, i, { rpe: ev.target.value })} aria-label={`RPE, ${run.ex[k].name}, seria ${num}`} />
          <button className="ok" aria-pressed={s.done} aria-label={s.done ? 'Cofnij serię' : 'Seria zaliczona'} onClick={() => onDone(k, i)}>
            ✓
          </button>
        </div>
        {s.sug && !s.done && <div className="sughint">{s.sug}</div>}
      </div>
    );
  };

  const addWarmup = (k: number) =>
    update((r) => {
      const sets = r.ex[k].sets;
      const firstWork = sets.find((s) => !s.warmup);
      sets.unshift({ load: '', reps: firstWork?.reps || '5', rpe: '', done: false, warmup: true, sug: '', edited: false, tRpe: '', spec: '', rest: '', label: 'Rozgrzewka' });
    });
  const addSet = (ks: number[]) =>
    update((r) => {
      for (const k of ks) {
        const sets = r.ex[k].sets;
        const src = sets[sets.length - 1];
        sets.push({ ...src, done: false, rpe: '', sug: '', edited: false, first: false, warmup: false });
      }
    });
  const removeSet = (ks: number[]) =>
    update((r) => {
      for (const k of ks) if (r.ex[k].sets.length > 1) r.ex[k].sets.pop();
    });

  const header = (k: number) => {
    const e = run.ex[k];
    return (
      <div key={`h${k}`} className="run-ex-head">
        <div className="between">
          <h2>
            {e.label && <span className="ex-label ex-label-lg">{e.label}</span>} {e.name}
          </h2>
          {e.video && (
            <a className="small" href={e.video} target="_blank" rel="noreferrer">
              ▶ Wideo
            </a>
          )}
        </div>
        {(e.tempo || e.notes) && (
          <div className="muted small">
            {e.tempo && `tempo ${e.tempoStr}`}
            {e.tempo && e.notes && ' · '}
            {e.notes}
          </div>
        )}
      </div>
    );
  };

  /** Pojedyncze ćwiczenie: serie po kolei, z nagłówkami bloków serii. */
  const single = (k: number) => {
    const e = run.ex[k];
    let n = 0;
    return (
      <>
        {header(k)}
        <div className="muted small">{e.rest && `przerwa ${e.rest}`}</div>
        <button className="link small" onClick={() => addWarmup(k)}>
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
              {setRow(k, i, s.warmup ? 'W' : String(n))}
            </div>
          );
        })}
      </>
    );
  };

  /** Blok (superseria / obwód): serie ułożone rundami — A1, A2, A3, przerwa, kolejna runda. */
  const superset = (ks: number[]) => {
    const work = ks.map((k) => run.ex[k].sets.map((s, i) => ({ s, i })).filter((x) => !x.s.warmup));
    const warm = ks.flatMap((k) => run.ex[k].sets.map((s, i) => ({ k, s, i })).filter((x) => x.s.warmup));
    const rounds = Math.max(...work.map((w) => w.length));
    const lastRest = run.ex[ks[ks.length - 1]].rest;
    return (
      <>
        <div className="block-head">
          <span className="eyebrow">{ks.length === 2 ? 'Superseria' : 'Obwód'} · {ks.length} ćwiczenia na zmianę</span>
          <span className="muted small">przerwa po rundzie {lastRest || '2:00'}</span>
        </div>
        {ks.map((k) => header(k))}
        <div className="sgrid sgrid-head">
          <span />
          <span>kg</span>
          <span>powt.</span>
          <span>RPE</span>
          <span />
        </div>
        {warm.length > 0 && warm.map(({ k, i }) => setRow(k, i, 'W', `${run.ex[k].label}·W`))}
        {Array.from({ length: rounds }, (_, r) => (
          <div key={r} className="round">
            <div className="round-label">Runda {r + 1}</div>
            {ks.map((k, j) => (work[j][r] ? setRow(k, work[j][r].i, String(r + 1), run.ex[k].label) : null))}
          </div>
        ))}
        {hintNext != null && block.includes(hintNext) && <div className="sughint next-hint">Teraz {run.ex[hintNext].label} · {run.ex[hintNext].name} — bez przerwy</div>}
      </>
    );
  };

  return (
    <div className="player fade">
      <div className="between">
        <button className="btn btn-ghost btn-sm" onClick={onHome}>
          {homeLabel}
        </button>
        <span className="actions">
          {trainer && run.ex.length > 0 && (
            <button className="btn btn-secondary btn-sm" onClick={() => setLayoutOpen(true)}>
              ✎ Układ
            </button>
          )}
          <button className="btn btn-ghost btn-sm" disabled={!tempoEx} onClick={() => setTempoOpen(true)}>
            ◷ Tempo
          </button>
        </span>
      </div>
      <header className="player-head">
        <h1>{run.name}</h1>
        <p className="muted small">
          {[run.planName, run.weekName].filter(Boolean).join(' · ')} · {doneSets}/{totalSets} serii
        </p>
      </header>
      <div className="segs">
        {blocks.map((b, i) => (
          <button key={i} aria-label={`${i + 1}: ${blockName(b)}`} className={b.every((k) => run.ex[k].sets.every((s) => s.done)) ? 'on' : i === bi ? 'cur' : ''} onClick={() => go(i)} />
        ))}
      </div>
      <div className="muted small upper">
        {block.length > 1 ? 'Blok' : 'Ćwiczenie'} {bi + 1} z {blocks.length}
      </div>

      {block.length > 0 && (
        <section className="acard">
          {block.length === 1 ? single(block[0]) : superset(block)}
          <div className="between">
            <button className="link small" onClick={() => addSet(block)}>
              {block.length > 1 ? '+ runda' : '+ seria'}
            </button>
            {block.some((k) => run.ex[k].sets.length > 1) && (
              <button className="link small muted" onClick={() => removeSet(block)}>
                − usuń ostatnią
              </button>
            )}
          </div>
        </section>
      )}

      {run.ex.length === 0 && !adding && <p className="muted">Ten trening nie ma jeszcze ćwiczeń.</p>}
      {adding ? (
        <AddExercise
          onCancel={run.ex.length ? () => setAdding(false) : undefined}
          canLink={run.ex.length > 0}
          onAdd={(name, sets, reps, load, linked) => {
            const next = appendExercise(run, adHocExercise(name, sets, reps, load));
            setRun(linked ? toggleLink(next, next.ex.length - 1) : next);
            setAdding(false);
            window.scrollTo(0, 0);
          }}
        />
      ) : (
        <button className="btn btn-ghost btn-block add-ex" onClick={() => setAdding(true)}>
          + Dodaj ćwiczenie
        </button>
      )}

      <div className="navrow">
        <button className="btn btn-ghost" disabled={bi === 0} onClick={() => go(bi - 1)}>
          ‹ poprzednie
        </button>
        {last ? (
          <button className="btn btn-primary btn-lg" onClick={openFinish}>
            Zakończ trening
          </button>
        ) : (
          <button className="btn btn-primary btn-lg" onClick={() => go(bi + 1)}>
            następne ›
          </button>
        )}
      </div>
      {!last && blocks[bi + 1] && (
        <div className="acard nextup">
          <span className="muted small">Dalej</span> {blockName(blocks[bi + 1])}
        </div>
      )}

      {rest && <RestBar rest={rest} setRest={setRest} />}
      {layoutOpen && (
        <LayoutSheet
          run={run}
          setRun={setRun}
          onClose={() => setLayoutOpen(false)}
          onAdd={() => {
            setLayoutOpen(false);
            setAdding(true);
            setTimeout(() => document.querySelector('.add-form')?.scrollIntoView({ behavior: 'smooth' }), 50);
          }}
        />
      )}
      {tempoOpen && tempoEx?.tempo && <Tempo name={tempoEx.name} phases={tempoEx.tempo} reps={repsN(tempoEx.sets.find((s) => !s.done)?.reps) || 5} onClose={() => setTempoOpen(false)} />}

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
              <span>{trainer ? 'Notatki z treningu' : 'Notatka dla trenera'}</span>
              <textarea className="input" rows={2} placeholder={trainer ? 'Obserwacje, technika, samopoczucie…' : 'Co poszło dobrze, co bolało?'} value={finish.notes} onChange={(ev) => setFinish({ ...finish, notes: ev.target.value })} />
            </label>
            {trainer && (
              <>
                <label className="field">
                  <span>Rozliczenie</span>
                  <ChargeSelect value={finish.charge} onChange={(charge) => setFinish({ ...finish, charge })} />
                </label>
                <label className="field">
                  <span>Miejsce</span>
                  <LocationSelect value={finish.locationId} onChange={(locationId) => setFinish({ ...finish, locationId })} />
                </label>
                {finish.charge === 'pakiet' && (
                  <p className="muted small">
                    {(() => {
                      const pk = packageStatus(client, sessionsOf(db, client.id));
                      return pk ? `W pakiecie zostało ${pk.left} (po zapisie: ${pk.left - 1}).` : 'Klient nie ma wykupionego pakietu.';
                    })()}
                  </p>
                )}
                {finish.charge === 'pojedyncza' && (
                  <div className="between">
                    <label className="field grow">
                      <span>Kwota (zł)</span>
                      <input className="input" inputMode="decimal" value={finish.amount} onChange={(ev) => setFinish({ ...finish, amount: ev.target.value })} />
                    </label>
                    <label className="check self-end">
                      <input type="checkbox" checked={finish.paidNow} onChange={(ev) => setFinish({ ...finish, paidNow: ev.target.checked })} /> zapłacone
                    </label>
                  </div>
                )}
              </>
            )}
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

function AddExercise({ onAdd, onCancel, canLink }: { onAdd: (name: string, sets: number, reps: string, load: string, linked: boolean) => void; onCancel?: () => void; canLink?: boolean }) {
  const { db } = useStore();
  const [name, setName] = useState('');
  const [sets, setSets] = useState('3');
  const [reps, setReps] = useState('8');
  const [load, setLoad] = useState('');
  const [linked, setLinked] = useState(false);
  return (
    <form
      className="acard add-form"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (name.trim()) onAdd(name.trim(), parseInt(sets, 10) || 3, reps, load.replace(',', '.'), linked);
      }}
    >
      <h3>Dodaj ćwiczenie</h3>
      <datalist id="run-lib">
        {db.library.map((e) => (
          <option key={e.id} value={e.name} />
        ))}
      </datalist>
      <label className="field">
        <span>Ćwiczenie</span>
        <input className="input" list="run-lib" value={name} onChange={(ev) => setName(ev.target.value)} placeholder="np. Przysiad ze sztangą" required />
      </label>
      <div className="add-grid">
        <label className="field">
          <span>Serie</span>
          <input className="input" inputMode="numeric" value={sets} onChange={(ev) => setSets(ev.target.value)} />
        </label>
        <label className="field">
          <span>Powt.</span>
          <input className="input" value={reps} onChange={(ev) => setReps(ev.target.value)} />
        </label>
        <label className="field">
          <span>kg</span>
          <input className="input" inputMode="decimal" value={load} onChange={(ev) => setLoad(ev.target.value)} />
        </label>
      </div>
      {canLink && (
        <label className="check">
          <input type="checkbox" checked={linked} onChange={(ev) => setLinked(ev.target.checked)} /> w bloku z poprzednim (superseria / obwód)
        </label>
      )}
      <div className="actions">
        <button type="submit" className="btn btn-primary">
          Dodaj
        </button>
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Anuluj
          </button>
        )}
      </div>
    </form>
  );
}

/** Układ treningu w trakcie: kolejność, nazwy, przerwy, łączenie w bloki, usuwanie; opcjonalnie zapis do planu. */
function LayoutSheet({ run, setRun, onClose, onAdd }: { run: Run; setRun: (r: Run) => void; onClose: () => void; onAdd: () => void }) {
  const { db, apply, ask } = useStore();
  const plan = db.plans.find((p) => p.id === run.planId);
  const workout = plan?.weeks.flatMap((w) => w.workouts).find((k) => k.id === run.workoutId);

  const saveToPlan = async () => {
    if (!plan || !workout) return;
    if (!(await ask(`Zapisać ten układ w planie „${plan.name}” (${workout.name})? Następnym razem trening będzie wyglądał tak samo.`, { confirm: 'Zapisz w planie', danger: false }))) return;
    const updated = applyRunLayout(workout, run, uid);
    const next = { ...plan, weeks: plan.weeks.map((w) => ({ ...w, workouts: w.workouts.map((k) => (k.id === workout.id ? updated : k)) })) };
    await apply(savePlan(db, next), 'Układ zapisany w planie.');
  };

  return (
    <div className="sheet-bg" onMouseDown={(ev) => ev.target === ev.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Układ treningu">
        <div className="between">
          <h2>Układ treningu</h2>
          <button className="btn btn-primary btn-sm" onClick={onClose}>
            Gotowe
          </button>
        </div>
        <p className="muted small">⛓ łączy ćwiczenie z poprzednim w superserię / obwód — robi się je na zmianę, przerwa po całej rundzie.</p>
        <ul className="layout-list">
          {run.ex.map((e, k) => (
            <li key={k} className={`layout-row ${e.linked ? 'linked' : ''}`}>
              <span className="ex-label">{e.label}</span>
              <input className="input" value={e.name} onChange={(ev) => setRun(renameExercise(run, k, { name: ev.target.value }))} aria-label={`Nazwa ćwiczenia ${e.label}`} />
              <input className="input layout-rest" value={e.rest} placeholder="Przerwa" onChange={(ev) => setRun(renameExercise(run, k, { rest: ev.target.value }))} aria-label={`Przerwa ${e.label}`} />
              <span className="layout-actions">
                {k > 0 && (
                  <button className={`chain ${e.linked ? 'on' : ''}`} aria-pressed={!!e.linked} title={e.linked ? 'Rozłącz z poprzednim' : 'Połącz z poprzednim (superseria / obwód)'} onClick={() => setRun(toggleLink(run, k))}>
                    ⛓
                  </button>
                )}
                <IconBtn icon="up" label="W górę" onClick={() => setRun(moveExercise(run, k, -1))} />
                <IconBtn icon="chevD" label="W dół" onClick={() => setRun(moveExercise(run, k, 1))} />
                <IconBtn
                  icon="trash"
                  label="Usuń ćwiczenie"
                  danger
                  onClick={async () => {
                    const done = e.sets.some((x) => x.done);
                    if (!done || (await ask(`Usunąć „${e.name}”? Zaliczone serie tego ćwiczenia nie zostaną zapisane.`))) setRun(removeExercise(run, k));
                  }}
                />
              </span>
            </li>
          ))}
        </ul>
        <button className="btn btn-secondary btn-block" onClick={onAdd}>
          + Dodaj ćwiczenie
        </button>
        {plan && workout && (
          <button className="btn btn-ghost btn-block" onClick={saveToPlan}>
            Zapisz ten układ także w planie
          </button>
        )}
      </div>
    </div>
  );
}
