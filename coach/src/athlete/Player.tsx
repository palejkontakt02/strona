import { useEffect, useRef, useState } from 'react';
import { Sheet } from '../components/Sheet';
import { useDialog } from '../components/useDialog';
import { IconBtn } from '../components/ui';
import { SetVideoButton } from '../components/SetVideo';
import { ChargeSelect, LocationSelect } from '../components/location';
import type { Billing, Client, PlanExercise, TrainingSession } from '../domain';
import { chargeProblem, isSolo, savePlan, saveSession, sessionsOf } from '../data/ops';
import { useStore } from '../data/store';
import { doneOn, dueOn } from '../lib/habits';
import { fmtDay, fmtRest, fnum, uid } from '../format';
import { defaultCharge, packageHint, packageStatus } from '../lib/billing';
import { num, numIn, repsN, sidesOf, sumReps } from '../lib/parse';
import { recentE1 } from '../lib/strength';
import { fmtDur, paceText, parseDur, parseKm, RUN_TEMPLATES, targetText } from '../lib/running';
import {
  adHocCardio,
  adHocExercise,
  appendExercise,
  applyRunLayout,
  blockRest,
  buildRunExercise,
  completeSet,
  moveExercise,
  removeExercise,
  renameExercise,
  runBlocks,
  runToExercises,
  toggleLink,
  type Run,
  type RunExercise,
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
  /** Anulowanie rozpoczętego treningu (nic się nie zapisuje). */
  onCancel?: () => void;
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
  /** Samodzielnie czy z trenerem — wybór przy zapisie, do zmiany później w historii. */
  solo: boolean;
}

/** Płynne przewijanie, chyba że użytkownik wyłączył animacje. */
const smoothScroll = (): ScrollBehavior => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

/** Czas od startu; po kilku godzinach (trening wznowiony następnego dnia) zostawia pole puste do wpisania. */
function elapsedMinutes(startedAt: number): string {
  const m = Math.round((Date.now() - startedAt) / 60000);
  // kilka minut = trening uzupełniany po fakcie — puste pole zamiast zaniżonego czasu (i obciążenia)
  return m >= 10 && m <= 240 ? String(m) : '';
}

export function Player({ client, run, setRun, onHome, onSaved, onCancel, mode = 'athlete', homeLabel = '‹ Start', appointmentId }: Props) {
  const { db, apply, toast, ask, sendClientNote, saveHabitDay } = useStore();
  const [rest, setRest] = useState<{ end: number; total: number } | null>(null);
  const [hold, setHold] = useState<{ end: number; total: number } | null>(null);
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

  const lastTick = useRef<{ at: number; key: string }>({ at: 0, key: '' });
  const onDone = async (k: number, i: number) => {
    const ex = run.ex[k];
    const s = ex.sets[i];
    const wasDone = s.done;
    // drugie dotknięcie tuż po pierwszym (układ się przesunął) nie zalicza kolejnej serii
    const key = `${k}-${i}`;
    if (Date.now() - lastTick.current.at < 600 && lastTick.current.key !== key) return;
    lastTick.current = { at: Date.now(), key };
    if (wasDone) {
      // cofnięcie serii zatrzymuje też odliczanie przerwy
      update((r) => void (r.ex[k].sets = completeSet(r.ex[k], i).sets));
      setRest(null);
      setHintNext(null);
      return;
    }
    if (s.rpe.trim() && numIn(s.rpe, 1, 10) == null) return toast('RPE: od 1 do 10 (jak ciężka była seria).');
    if (ex.cardio) {
      if (!s.reps.trim() && !(s.dist ?? '').trim()) return toast('Wpisz czas (min albo m:ss) albo dystans (km).');
      const d = parseDur(s.reps);
      if (s.reps.trim() && (d == null || d < 0.05 || d > 1440)) return toast('Czas: minuty (np. 20) albo minuty:sekundy (np. 3:05).');
      if ((s.dist ?? '').trim() && numIn(s.dist, 0.01, 500) == null) return toast('Dystans: liczba km (np. 3,5).');
      if ((s.hr ?? '').trim() && numIn(s.hr, 30, 240) == null) return toast('Tętno: od 30 do 240.');
      const next = update((r) => void (r.ex[k].sets[i].done = true));
      const br = blockRest(run, k, i);
      // po ostatnim odcinku i przed schłodzeniem bez przerwy
      const nextSet = run.ex[k].sets[i + 1];
      if (br.rest && run.ex[k].rest && nextSet && nextSet.label !== 'Schłodzenie' && !next.ex.every((e) => e.sets.every((x) => x.done))) setRest({ end: Date.now() + br.rest * 1000, total: br.rest });
      return;
    }
    const hasPrev = ex.sets.slice(0, i).some((x) => x.done && !x.warmup);
    if (!s.warmup && !hasPrev && !s.reps.trim()) return toast('Wpisz liczbę powtórzeń.');
    if (s.reps.trim() && !/\d/.test(s.reps)) return toast('Powtórzenia: wpisz liczbę.');
    if (s.reps.trim() && sumReps(s.reps) === 0) return toast('Powtórzenia: co najmniej 1.');
    if (s.load.trim() && !/^\s*-?\d+([.,]\d+)?\s*(kg)?\s*$/i.test(s.load)) return toast(`Ciężar „${s.load.trim()}” — wpisz samą liczbę, np. 42,5.`);
    const load = num(s.load);
    if (load != null && load < 0) return toast('Ciężar nie może być ujemny.');
    const best = recentE1(sessionsOf(db, client.id), ex.name);
    if (load != null && (load > 400 || (best != null && load > best * 1.5)) && !(await ask(`${fnum(load)} kg to dużo więcej niż dotychczas${best ? ` (szacowane maks. ${fnum(best, 0)} kg)` : ''}. Na pewno?`, { confirm: 'Tak, zalicz', danger: false }))) return;
    const res = completeSet(ex, i);
    const next = update((r) => void (r.ex[k].sets = res.sets));
    const br = blockRest(next, k, i);
    setHintNext(br.next ?? null);
    // po ostatniej serii całego treningu nie ma już przerwy — tylko „Zakończ”
    if (br.rest && !next.ex.every((e) => e.sets.every((x) => x.done))) setRest({ end: Date.now() + br.rest * 1000, total: br.rest });
  };

  const editing = run.editSessionId ? db.sessions.find((x) => x.id === run.editSessionId) : undefined;

  const save = async () => {
    if (!finish) return;
    if (finish.srpe === '') {
      document.querySelector('.sheet .scale-11')?.scrollIntoView({ behavior: smoothScroll(), block: 'center' });
      return toast('Zaznacz, jak ciężki był cały trening (0–10), żeby zapisać.');
    }
    if (trainer && !editing && finish.charge === 'pojedyncza' && numIn(finish.amount, 0.01, 1_000_000) == null) return toast('Wpisz kwotę za sesję (zł) albo zmień rozliczenie.');
    if (finish.duration.trim() && numIn(finish.duration, 1, 600) == null) return toast('Czas trwania: od 1 do 600 minut.');
    const problem = trainer ? chargeProblem(db, finish.charge, finish.locationId) : null;
    if (problem) return toast(problem);
    if (editing) {
      const updated: TrainingSession = {
        ...editing,
        workoutName: run.name,
        charge: trainer ? finish.charge : editing.charge,
        duration: numIn(finish.duration, 1, 600) ?? undefined,
        srpe: Number(finish.srpe),
        pain: finish.pain === '' ? undefined : Number(finish.pain),
        notes: finish.notes.trim() || undefined,
        locationId: (trainer ? finish.locationId : editing.locationId) || undefined,
        exercises: runToExercises(run),
        solo: finish.solo,
      };
      if (updated.exercises.length === 0) return toast('Zostaw przynajmniej jedną zaliczoną serię (✓).');
      const { changes } = saveSession(db, { session: updated, isNew: false });
      if (!(await apply(changes, 'Zapisano zmiany w treningu.'))) return; // trening zostaje — można ponowić zapis
      setFinish(null);
      onSaved();
      return;
    }
    const today = run.date;
    const check = client.checkins.find((c) => c.date === today);
    const session: TrainingSession = {
      id: uid(),
      clientId: client.id,
      date: today,
      workoutName: run.name,
      charge: trainer ? finish.charge : 'brak',
      duration: numIn(finish.duration, 1, 600) ?? undefined,
      srpe: Number(finish.srpe),
      pain: finish.pain === '' ? undefined : Number(finish.pain),
      notes: finish.notes.trim() || undefined,
      wellness: check ? { sleep: check.sleep, energy: check.energy, muscle: check.muscle, stress: check.stress, mood: check.mood } : undefined,
      // samodzielnie (np. w domu) — bez miejsca klubu, żeby nie liczyło się do rozliczeń z klubem
      locationId: (trainer ? finish.locationId : undefined) || undefined,
      planId: run.planId,
      workoutId: run.workoutId,
      exercises: runToExercises(run),
      solo: finish.solo,
    };
    if (session.exercises.length === 0) return toast('Zalicz przynajmniej jedną serię (✓), zanim zapiszesz trening.');
    // wizyta z innego dnia: zapis z datą wizyty albo bez łączenia z nią
    let apptId = appointmentId;
    const appt = apptId ? db.appointments.find((a) => a.id === apptId) : undefined;
    if (appt && appt.date !== session.date) {
      if (await ask(`Ta wizyta jest ${fmtDay(appt.date)}, a trening zapisuje się z datą ${fmtDay(session.date)}. Zapisać z datą wizyty (${fmtDay(appt.date)})?`, { confirm: `Tak, ${fmtDay(appt.date)}` })) session.date = appt.date;
      else apptId = undefined;
    }
    const { changes, message } = saveSession(db, { session, isNew: true, appointmentId: apptId, matchAppointment: trainer && !(appointmentId && !apptId), amount: trainer ? num(finish.amount) ?? undefined : undefined, paidNow: finish.paidNow });
    if (!(await apply(changes, trainer ? message : 'Trening zapisany. Dobra robota! 💪'))) return; // trening zostaje — można ponowić zapis
    // notatka z podsumowania trafia też do wiadomości trenera (z odnośnikiem do treningu)
    // zadanie dzienne o tej samej nazwie co trening (np. „Ćwiczenia na kręgosłup”) odhacza się samo
    if (!trainer) {
      const key = (t: string) => t.toLowerCase().replace(/[^a-ząćęłńóśźż0-9 ]/g, '').trim();
      const wn = key(session.workoutName || '');
      const done = doneOn(client.habitLog, session.date);
      const match = dueOn(client.habits, session.date).filter((h) => !done.includes(h.id) && wn.length >= 4 && (key(h.title).includes(wn) || wn.includes(key(h.title))));
      if (match.length) void saveHabitDay(client.id, session.date, [...done, ...match.map((h) => h.id)]);
    }
    // ból ≥5/10 po treningu samodzielnym: trener dostaje informację od razu (z notatką, jeśli jest)
    const hurt = !trainer && session.pain != null && session.pain >= 5;
    if (hurt || (!trainer && session.notes))
      void sendClientNote(
        client.id,
        `${hurt ? `Ból ${session.pain}/10 po treningu` : 'Po treningu'} „${session.workoutName || 'Trening'}”${session.notes ? `: ${session.notes}` : ''}`,
        session.id,
      );
    if (hurt) void ask(`Ból ${session.pain}/10 — trener dostał informację. Do czasu jego odpowiedzi: nie zwiększaj ciężarów, a jeśli ból narasta albo nie mija do jutra, odpuść trening, który go wywołuje.`, { confirm: 'Rozumiem', danger: false, cancel: 'Zamknij' });
    setFinish(null);
    onSaved();
  };

  /** Przed podsumowaniem: nagrania na niezaliczonych seriach i trening skończony dużo wcześniej. */
  const openFinish = async () => {
    const open = run.ex.flatMap((e, k) => e.sets.map((x, i) => ({ x, k, i }))).filter(({ x }) => !x.done);
    const withVideo = open.filter(({ x }) => x.video);
    let added = 0;
    if (withVideo.length) {
      const yes = await ask(
        `${withVideo.length === 1 ? 'Jedna seria z nagraniem nie jest zaliczona' : `${withVideo.length} serie z nagraniem nie są zaliczone`} (brak ✓). Zapisują się tylko zaliczone serie — zaliczyć ${withVideo.length === 1 ? 'ją' : 'je'}, żeby nagranie zostało?`,
        { confirm: 'Zalicz z nagraniem' },
      );
      if (yes) {
        update((r) => withVideo.forEach(({ k, i }) => (r.ex[k].sets[i].done = true)));
        added = withVideo.filter(({ x }) => !x.warmup).length;
      }
      else if (!(await ask('Zakończyć bez tych serii? Ich nagrania nie zostaną zapisane.', { confirm: 'Zakończ bez nich', danger: true }))) return;
    }
    const total = run.ex.reduce((a, e) => a + e.sets.filter((x) => !x.warmup).length, 0);
    const done = run.ex.reduce((a, e) => a + e.sets.filter((x) => !x.warmup && x.done).length, 0) + added;
    if (!editing && total > 2 && done < total / 2 && !(await ask(`Zaliczono ${done} z ${total} serii. Zakończyć trening teraz? Niezaliczone serie nie zostaną zapisane.`, { confirm: 'Zakończ' }))) return;
    showFinish();
  };
  const showFinish = () => {
    const charge = defaultCharge(client, sessionsOf(db, client.id));
    if (editing) {
      setFinish({
        srpe: editing.srpe != null ? String(editing.srpe) : '',
        pain: editing.pain != null ? String(editing.pain) : '',
        duration: editing.duration != null ? String(editing.duration) : '',
        notes: editing.notes ?? '',
        charge: editing.charge,
        amount: '',
        paidNow: true,
        locationId: editing.locationId ?? '',
        solo: isSolo(db, editing),
      });
      return;
    }
    setFinish({
      srpe: '',
      pain: '',
      duration: elapsedMinutes(run.startedAt),
      notes: '',
      charge,
      amount: client.singleRate ? String(client.singleRate) : '',
      paidNow: true,
      locationId: db.appointments.find((a) => a.id === appointmentId)?.locationId ?? client.locationId ?? '',
      // podopieczny: domyślnie sam, chyba że ma dziś wizytę; trener prowadzący: z trenerem
      solo: !trainer && !db.appointments.some((a) => a.clientId === client.id && a.date === run.date && a.status !== 'cancel' && a.status !== 'noshow'),
    });
  };

  const totalSets = run.ex.reduce((a, x) => a + x.sets.length, 0);
  const doneSets = run.ex.reduce((a, x) => a + x.sets.filter((s) => s.done).length, 0);
  const blockName = (b: number[]) => b.map((k) => run.ex[k].name).join(' + ');

  const setRow = (k: number, i: number, num: string, label?: string) => {
    const s = run.ex[k].sets[i];
    return (
      <div key={`${k}-${i}`}>
        <div className={`sgrid ${run.ex[k].cardio ? 'cardio' : ''} ${s.done ? 'done' : ''} ${s.warmup ? 'warm' : ''} ${hintNext === k && !s.done ? 'is-next' : ''}`}>
          {run.ex[k].sets.length > 1 ? (
            <button className="sn sn-btn" onClick={() => removeAt(k, i, num)} aria-label={`Usuń serię ${num}, ${run.ex[k].name}`} title="Usuń tę serię">
              {label ? <span className="ex-label">{label}</span> : num}
            </button>
          ) : (
            <span className="sn">{label ? <span className="ex-label">{label}</span> : num}</span>
          )}
          {run.ex[k].cardio ? (
            // cardio: czas, dystans, tętno, RPE (bez ciężaru i nagrania)
            <>
              <input value={s.reps} placeholder="min" onChange={(ev) => setSet(k, i, { reps: ev.target.value })} aria-label={`Czas (minuty albo m:ss), ${run.ex[k].name}, odcinek ${num}`} />
              <input inputMode="decimal" value={s.dist ?? ''} placeholder="km" onChange={(ev) => setSet(k, i, { dist: ev.target.value })} aria-label={`Dystans (km), ${run.ex[k].name}, odcinek ${num}`} />
              <input inputMode="numeric" value={s.hr ?? ''} placeholder="tętno" onChange={(ev) => setSet(k, i, { hr: ev.target.value })} aria-label={`Średnie tętno, ${run.ex[k].name}, odcinek ${num}`} />
              <input inputMode="decimal" value={s.rpe} placeholder={s.tRpe || 'RPE'} onChange={(ev) => setSet(k, i, { rpe: ev.target.value })} aria-label={`RPE, ${run.ex[k].name}, odcinek ${num}`} />
            </>
          ) : run.ex[k].perSide ? (
            // na stronę: osobno lewa i prawa (różny wynik, np. 30/20 s)
            <span className="lr">
              {(() => {
                const [l, r] = sidesOf(s.reps)?.map(String) ?? [s.reps, s.reps];
                const set = (nl: string, nr: string) => setSet(k, i, { reps: nl === nr ? nl : `${nl}/${nr}` });
                return (
                  <>
                    <input inputMode="numeric" value={l} placeholder="L" onChange={(ev) => set(ev.target.value, r)} aria-label={`Lewa strona, ${run.ex[k].name}, seria ${num}`} />
                    <input inputMode="numeric" value={r} placeholder="P" onChange={(ev) => set(l, ev.target.value)} aria-label={`Prawa strona, ${run.ex[k].name}, seria ${num}`} />
                  </>
                );
              })()}
            </span>
          ) : (
            <input inputMode="numeric" value={s.reps} onChange={(ev) => setSet(k, i, { reps: ev.target.value })} aria-label={`${s.unit ? 'Czas' : 'Powtórzenia'}, ${run.ex[k].name}, seria ${num}`} />
          )}
          {!run.ex[k].cardio && (
            <>
              <input inputMode="decimal" value={s.load} className={s.sug && !s.edited ? 'sugg' : ''} onChange={(ev) => setSet(k, i, { load: ev.target.value, edited: true })} aria-label={`Ciężar, ${run.ex[k].name}, seria ${num}`} />
              <input inputMode="decimal" value={s.rpe} placeholder={s.tRpe} onChange={(ev) => setSet(k, i, { rpe: ev.target.value })} aria-label={`RPE, ${run.ex[k].name}, seria ${num}`} />
              <SetVideoButton clientId={client.id} video={s.video} title={`${run.ex[k].name} · seria ${num}`} onChange={(video) => setSet(k, i, { video })} />
            </>
          )}
          <button className="ok" aria-pressed={s.done} aria-label={s.done ? 'Cofnij serię' : 'Seria zaliczona'} onClick={() => onDone(k, i)}>
            ✓
          </button>
        </div>
        {run.ex[k].cardio && (s.pace || paceText(parseDur(s.reps), parseKm(s.dist))) && (
          // bieg: cel ze strefą (tętno / tempo z profilu) i tempo wyliczone z czasu i dystansu
          <div className="prevhint">
            {s.pace && <>cel: {targetText(s.pace, client.run, client.dob)}</>}
            {s.pace && paceText(parseDur(s.reps), parseKm(s.dist)) && ' · '}
            {paceText(parseDur(s.reps), parseKm(s.dist)) && <b>tempo {paceText(parseDur(s.reps), parseKm(s.dist))}</b>}
          </div>
        )}
        {s.sug && !s.done && !run.ex[k].cardio && <div className="sughint">{s.sug}</div>}
        {s.prev && !s.sug && <div className="prevhint">poprzednio: {s.prev}</div>}
        {s.unit && !s.done && (run.ex[k].cardio ? (parseDur(s.reps) ?? 0) > 0 : (repsN(sidesOf(s.reps)?.[0] ?? s.reps) ?? 0) > 0) && (
          <button
            className="link small hold-start"
            onClick={() => {
              const sec = run.ex[k].cardio ? Math.round((parseDur(s.reps) ?? 0) * 60) : (repsN(sidesOf(s.reps)?.[0] ?? s.reps) ?? 0) * (s.unit === 'min' ? 60 : 1);
              setHold({ end: Date.now() + sec * 1000, total: sec });
            }}
          >
            ⏱ Odliczaj {run.ex[k].cardio ? fmtDur(parseDur(s.reps) ?? 0) : `${s.reps.split('/')[0]} ${s.unit === 'min' ? 'min' : 's'}`}
            {run.ex[k].perSide ? ' (jedna strona)' : ''}
          </button>
        )}
        {s.warmup && !s.done && (
          <button className="link small muted warm-remove" onClick={() => (s.video ? void removeAt(k, i, 'wstępną') : removeWarmup(k, i))}>
            ✕ usuń tę serię wstępną
          </button>
        )}
        {!s.warmup && !s.done && !s.reps.trim() && !s.load.trim() && run.ex[k].sets.length > 1 && (
          <button className="link small muted warm-remove" onClick={() => (s.video ? void removeAt(k, i, num) : removeWarmup(k, i))}>
            ✕ usuń tę serię
          </button>
        )}
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
      // Runda wyrównuje blok: ćwiczenia z mniejszą liczbą serii dostają brakujące, przy równych — każde po jednej.
      const lens = ks.map((k) => r.ex[k].sets.length);
      const target = Math.max(...lens) + (lens.every((n) => n === lens[0]) ? 1 : 0);
      for (const k of ks) {
        const sets = r.ex[k].sets;
        const src = sets[sets.length - 1];
        while (sets.length < target) sets.push({ ...src, done: false, rpe: '', sug: '', edited: false, first: false, warmup: false, video: undefined });
      }
    });
  const removeSet = async (ks: number[]) => {
    if (ks.some((k) => run.ex[k].sets[run.ex[k].sets.length - 1]?.done) && !(await ask('Usunąć ostatnią serię? Jest już zaliczona.', { confirm: 'Usuń serię' }))) return;
    update((r) => {
      for (const k of ks) if (r.ex[k].sets.length > 1) r.ex[k].sets.pop();
    });
  };
  /** Usuwa jedną serię wstępną (rozgrzewkę) — np. dodaną przez pomyłkę. */
  const removeWarmup = (k: number, i: number) =>
    update((r) => {
      const sets = r.ex[k].sets;
      const [gone] = sets.splice(i, 1);
      // nagłówek grupy („Robocze 3 × 2”) przechodzi na następną serię tej grupy
      if (gone?.first && sets[i] && sets[i].gi === gone.gi) sets[i].first = true;
    });
  /** Dowolna seria do usunięcia — dotknięcie numeru serii. */
  const removeAt = async (k: number, i: number, num: string) => {
    const s = run.ex[k].sets[i];
    const what = [s.reps && `${s.reps} powt.`, s.load && `${s.load} kg`].filter(Boolean).join(' × ');
    if (!(await ask(`Usunąć serię ${num}${what ? ` (${what})` : ''} — ${run.ex[k].name}?${s.done ? ' Jest już zaliczona.' : ''}${s.video ? ' Jej nagranie też zniknie.' : ''}`, { confirm: 'Usuń serię' }))) return;
    removeWarmup(k, i);
  };

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
        {!e.sets.some((x) => x.done) && (
          <button
            type="button"
            className={`side-toggle ${e.cardio ? 'on' : ''}`}
            aria-pressed={!!e.cardio}
            onClick={() =>
              update((r) => {
                const x = r.ex[k];
                x.cardio = !x.cardio || undefined;
                x.perSide = undefined;
                x.sets = x.sets.map((st) => ({ ...st, unit: x.cardio ? 'min' : undefined, load: x.cardio ? '' : st.load, sug: '' }));
              })
            }
            title="Cardio: czas, dystans i tętno zamiast powtórzeń i ciężaru"
          >
            🫀 {e.cardio ? 'Cardio — min / km / tętno' : 'Cardio?'}
          </button>
        )}
        {!e.cardio && (
        <button
          type="button"
          className={`side-toggle ${e.perSide ? 'on' : ''}`}
          aria-pressed={!!e.perSide}
          onClick={() => update((r) => void (r.ex[k].perSide = !r.ex[k].perSide || undefined))}
          title="Ćwiczenie na jedną stronę: wpisuj powtórzenia na każdą stronę"
        >
          ↔ {e.perSide ? 'Na każdą stronę — powt. na stronę' : 'Na stronę? (np. 8 na lewą i 8 na prawą)'}
        </button>
        )}
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
        <div className="muted small">{e.rest && `przerwa ${fmtRest(e.rest)}`}</div>
        {!e.cardio && (
          <button className="link small" onClick={() => addWarmup(k)}>
            + seria wstępna
          </button>
        )}
        {e.cardio ? (
          <div className="sgrid sgrid-head cardio">
            <span />
            <span>czas</span>
            <span>km</span>
            <span>tętno</span>
            <span title="RPE: jak ciężki był odcinek, 1–10">RPE</span>
            <span />
          </div>
        ) : (
          <div className="sgrid sgrid-head">
            <span />
            <span>{repsHead(e)}</span>
            <span>kg</span>
            <span title="RPE: jak ciężka była seria, 1–10 (10 = nie dało się zrobić ani jednego powtórzenia więcej)">RPE</span>
            <span />
            <span />
          </div>
        )}
        {e.sets.map((s, i) => {
          const cool = s.label === 'Schłodzenie';
          if (!s.warmup && !cool) n++;
          return (
            <div key={i}>
              {s.first && (!s.warmup || e.cardio) && s.gdesc && (
                <div className="ghead">
                  <b>{s.gdesc}</b>
                  {s.rest && <span className="muted small">przerwa {fmtRest(s.rest)}</span>}
                </div>
              )}
              {setRow(k, i, s.warmup ? 'W' : cool ? 'S' : String(n))}
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
          <span>powt. / czas</span>
          <span>kg</span>
          <span title="RPE: jak ciężka była seria, 1–10 (10 = nie dało się zrobić ani jednego powtórzenia więcej)">RPE</span>
          <span />
          <span />
        </div>
        {warm.length > 0 && warm.map(({ k, i }) => setRow(k, i, 'W', `${run.ex[k].label}·W`))}
        {Array.from({ length: rounds }, (_, r) => (
          <div key={r} className="round">
            <div className="round-label">Runda {r + 1}</div>
            {ks.map((k, j) => (work[j][r] ? setRow(k, work[j][r].i, String(r + 1), run.ex[k].label) : null))}
          </div>
        ))}
        {hintNext != null && block.includes(hintNext) && <div className="sughint next-hint">Teraz {run.ex[hintNext].label} · {run.ex[hintNext].name} — {rest ? 'po krótkiej przerwie' : 'bez przerwy'}</div>}
      </>
    );
  };

  return (
    <div className="player fade">
      {trainer &&
        (() => {
          // trener prowadzi trening: przeciwwskazania i ograniczenia z wywiadu (podopieczny tego nie widzi)
          const h = db.trainer_notes.find((n) => n.clientId === client.id)?.health;
          const txt = [h?.contraindications, h?.restrictions, h?.meds && `leki: ${h.meds}`].filter(Boolean).join(' · ');
          return txt ? (
            <div className="coach-note health-bar" role="note">
              <span className="eyebrow">Uwaga z wywiadu</span>
              <p>{txt}</p>
            </div>
          ) : null;
        })()}
      <div className="between">
        <button className="btn btn-ghost btn-sm" onClick={onHome}>
          {homeLabel}
        </button>
        <span className="actions">
          {run.ex.length > 0 && (trainer || !run.editSessionId) && (
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
          {[editing ? `Poprawki treningu z ${fmtDay(run.date)}` : '', run.planName, run.weekName, `${doneSets}/${totalSets} serii`].filter(Boolean).join(' · ')}
        </p>
        {!trainer && <p className="muted small rpe-legend" style={doneSets === 0 ? undefined : { visibility: 'hidden' }} aria-hidden={doneSets > 0}>Wpisz powtórzenia i kg, potem ✓. RPE (1–10) = jak ciężka była seria; możesz zostawić puste.</p>}
      </header>
      <div className="segs">
        {blocks.map((b, i) => (
          <button
            key={i}
            aria-label={`${i + 1}: ${blockName(b)}${b.every((k) => run.ex[k].sets.every((s) => s.done)) ? ', zaliczone' : ''}`}
            aria-current={i === bi ? 'step' : undefined}
            className={b.every((k) => run.ex[k].sets.every((s) => s.done)) ? 'on' : i === bi ? 'cur' : ''}
            onClick={() => go(i)}
          />
        ))}
      </div>
      {blocks.length > 0 ? (
        <div className="muted small upper">
          {block.length > 1 ? 'Blok' : 'Ćwiczenie'} {bi + 1} z {blocks.length}
        </div>
      ) : (
        <p className="muted">Dodaj pierwsze ćwiczenie przyciskiem poniżej.</p>
      )}

      {block.length > 0 && (
        <section className="acard">
          {block.length === 1 ? single(block[0]) : superset(block)}
          <div className="between">
            <button className="link small" onClick={() => addSet(block)}>
              {block.length > 1 ? '+ runda' : '+ seria'}
            </button>
            {(trainer || !run.editSessionId) && block.some((k) => run.ex[k].sets.length > 1) && (
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
          onTemplate={(e) => {
            setRun(appendExercise(run, buildRunExercise(e, sessionsOf(db, client.id), undefined, client.tests)));
            setAdding(false);
            window.scrollTo(0, 0);
          }}
          onCardio={(name, bouts, minutes, km) => {
            setRun(appendExercise(run, adHocCardio(name, bouts, minutes, km)));
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
          <button className="btn btn-primary btn-lg" onClick={() => void openFinish()}>
            {editing ? 'Zapisz zmiany' : 'Zakończ trening'}
          </button>
        ) : (
          <>
          <button className="btn btn-primary btn-lg" onClick={() => go(bi + 1)}>
            następne ›
          </button>
          </>
        )}
      </div>
      {!last && (
        <button className="btn btn-ghost btn-block finish-early" onClick={() => void openFinish()}>
          {editing ? 'Zapisz zmiany' : 'Zakończ trening wcześniej'}
        </button>
      )}
      {onCancel && (
        <button
          className="btn btn-ghost btn-block btn-danger-text cancel-run"
          onClick={async () => {
            const n = run.ex.reduce((a, e) => a + e.sets.filter((x) => x.done).length, 0);
            const msg = editing
              ? 'Anulować poprawki? Zapisany trening zostanie bez zmian.'
              : `Anulować ten trening? ${n ? `Zaliczone serie (${n}) i nagrania nie zostaną zapisane.` : 'Nic nie zostanie zapisane.'}`;
            if (await ask(msg, { confirm: editing ? 'Anuluj poprawki' : 'Anuluj trening', danger: true, cancel: editing ? 'Wróć do poprawek' : 'Wróć do treningu' })) onCancel();
          }}
        >
          ✕ {editing ? 'Anuluj poprawki' : 'Anuluj trening'}
        </button>
      )}
      {!last && blocks[bi + 1] && (
        <div className="acard nextup">
          <span className="muted small">Dalej</span> {blockName(blocks[bi + 1])}
        </div>
      )}

      {rest && !hold && <RestBar rest={rest} setRest={setRest} />}
      {hold && <RestBar rest={hold} setRest={setHold} label="Trzymaj" endText="Koniec — zalicz serię ✓" />}
      {layoutOpen && (
        <LayoutSheet
          canSavePlan={trainer}
          run={run}
          setRun={setRun}
          onClose={() => setLayoutOpen(false)}
          onAdd={() => {
            setLayoutOpen(false);
            setAdding(true);
            setTimeout(() => document.querySelector('.add-form')?.scrollIntoView({ behavior: smoothScroll() }), 50);
          }}
        />
      )}
      {tempoOpen && tempoEx?.tempo && <Tempo name={tempoEx.name} phases={tempoEx.tempo} reps={repsN(tempoEx.sets.find((s) => !s.done)?.reps) || 5} onClose={() => setTempoOpen(false)} />}

      {finish && (
        <Sheet label="Podsumowanie treningu" onClose={() => setFinish(null)}>
            <h2>Podsumowanie</h2>
            <div className="scale-h">
              <span>Jak ciężki był cały trening? (wymagane)</span>
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
            <div className="field">
              <span>Z kim był trening?</span>
              <div className="seg" role="radiogroup" aria-label="Z kim był trening">
                {([true, false] as const).map((v) => (
                  <button key={String(v)} type="button" role="radio" aria-checked={finish.solo === v} className={finish.solo === v ? 'active' : ''} onClick={() => setFinish({ ...finish, solo: v })}>
                    {v ? 'Samodzielnie' : 'Z trenerem'}
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              <span>Czas treningu (min)</span>
              <input className="input" inputMode="numeric" value={finish.duration} placeholder="np. 60" onChange={(ev) => setFinish({ ...finish, duration: ev.target.value })} />
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
                      return packageHint(packageStatus(client, sessionsOf(db, client.id))?.left ?? null, editing?.charge !== 'pakiet');
                    })()}
                  </p>
                )}
                {finish.charge === 'pojedyncza' && !editing && (
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
            <button className="btn btn-primary btn-lg btn-block" onClick={save}>
              {editing ? 'Zapisz zmiany' : 'Zapisz trening'}
            </button>
            <button className="btn btn-ghost btn-block" onClick={() => setFinish(null)}>
              Wróć do ćwiczeń
            </button>
          </Sheet>
      )}
    </div>
  );
}

/** Nagłówek kolumny powtórzeń: „powt.”, „sek.”, „min”, z „/str.” dla ćwiczeń na stronę (L | P). */
function repsHead(e: RunExercise): string {
  const u = e.sets.find((x) => !x.warmup)?.unit;
  const base = u === 's' ? 'sek.' : u === 'min' ? 'min' : 'powt.';
  return e.perSide ? (u ? `${base} L|P` : 'L | P') : base;
}

function RestBar({ rest, setRest, label = 'Przerwa', endText = 'Koniec przerwy – następna seria!' }: { rest: { end: number; total: number }; setRest: (r: { end: number; total: number } | null) => void; label?: string; endText?: string }) {
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
      toast(endText);
      setRest(null);
    }
  }, [left, setRest, toast, endText]);
  return (
    <div className={`restbar ${label !== 'Przerwa' ? 'holdbar' : ''}`} role="timer" aria-label={label}>
      <div className="rb-fill" style={{ width: `${100 - (left / rest.total) * 100}%` }} />
      <span>{label}</span>
      <b>{fmtSec(left)}</b>
      <button aria-label="Skróć przerwę o 15 sekund" onClick={() => setRest({ ...rest, end: Math.max(Date.now() + 1000, rest.end - 15000) })}>−15</button>
      <button aria-label="Wydłuż przerwę o 15 sekund" onClick={() => setRest({ end: rest.end + 15000, total: rest.total + 15 })}>+15</button>
      <button aria-label="Pomiń przerwę" onClick={() => setRest(null)}>Pomiń</button>
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
  const tempoRef = useRef<HTMLDivElement>(null);
  useDialog(tempoRef, onClose);
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
    <div ref={tempoRef} className="tempo-ov" role="dialog" aria-modal="true" aria-label="Metronom tempa" tabIndex={-1}>
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

const CARDIO_TYPES = ['Bieżnia', 'Rower stacjonarny', 'Wioślarz (ergometr)', 'Orbitrek', 'Bieg na zewnątrz', 'Marsz / nordic walking', 'Pływanie', 'Skakanka', 'Schody / stepper', 'Air bike', 'Ski erg'];

function AddExercise({
  onAdd,
  onCardio,
  onTemplate,
  onCancel,
  canLink,
}: {
  onAdd: (name: string, sets: number, reps: string, load: string, linked: boolean) => void;
  onCardio: (name: string, bouts: number, minutes: string, km: string) => void;
  onTemplate: (e: PlanExercise) => void;
  onCancel?: () => void;
  canLink?: boolean;
}) {
  const { db, toast } = useStore();
  const [kind, setKind] = useState<'sila' | 'cardio' | 'bieg'>('sila');
  const tabs = (
    <div className="seg seg-sm" role="tablist" aria-label="Rodzaj ćwiczenia">
      {(
        [
          ['sila', 'Siłowe'],
          ['bieg', '🏃 Bieg'],
          ['cardio', '🫀 Cardio'],
        ] as const
      ).map(([k, l]) => (
        <button key={k} type="button" role="tab" className={kind === k ? 'active' : ''} aria-selected={kind === k} onClick={() => setKind(k)}>
          {l}
        </button>
      ))}
    </div>
  );
  const [name, setName] = useState('');
  const [sets, setSets] = useState('3');
  const [reps, setReps] = useState('8');
  const [load, setLoad] = useState('');
  const [linked, setLinked] = useState(false);
  const [bouts, setBouts] = useState('1');
  const [mins, setMins] = useState('20');
  const [km, setKm] = useState('');
  if (kind === 'bieg')
    return (
      <div className="acard add-form">
        {tabs}
        <h3>Dodaj bieg</h3>
        <p className="muted small">Wybierz jednostkę — czasy, dystanse i strefy zmienisz przy każdym odcinku. Czas wpisuj w minutach albo m:ss.</p>
        <ul className="plain run-tpl">
          {RUN_TEMPLATES.map((t) => (
            <li key={t.id}>
              <button type="button" className="btn btn-secondary btn-block run-tpl-btn" onClick={() => onTemplate(t.make())}>
                <b>{t.name}</b>
                <span className="muted small">{t.hint}</span>
              </button>
            </li>
          ))}
        </ul>
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Anuluj
          </button>
        )}
      </div>
    );
  if (kind === 'cardio')
    return (
      <form
        className="acard add-form"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!name.trim()) return toast('Wybierz albo wpisz rodzaj cardio.');
          const n = numIn(bouts, 1, 20);
          if (n == null || !Number.isInteger(n)) return toast('Odcinki: od 1 do 20.');
          if (mins.trim() && numIn(mins, 0.1, 600) == null) return toast('Czas: liczba minut.');
          if (km.trim() && numIn(km, 0.01, 500) == null) return toast('Dystans: liczba km.');
          onCardio(name.trim(), n, mins.trim(), km.trim());
        }}
      >
        {tabs}
        <h3>Dodaj cardio</h3>
        <div className="intake-opts">
          {CARDIO_TYPES.map((t) => (
            <button key={t} type="button" className={name === t ? 'active' : ''} aria-pressed={name === t} onClick={() => setName(t)}>
              {t}
            </button>
          ))}
        </div>
        <label className="field">
          <span>albo wpisz</span>
          <input className="input" value={name} onChange={(ev) => setName(ev.target.value)} placeholder="np. Interwały na rowerze" />
        </label>
        <div className="add-grid">
          <label className="field">
            <span>Odcinki</span>
            <input className="input" inputMode="numeric" value={bouts} onChange={(ev) => setBouts(ev.target.value)} />
          </label>
          <label className="field">
            <span>Czas (min)</span>
            <input className="input" inputMode="decimal" value={mins} onChange={(ev) => setMins(ev.target.value)} />
          </label>
          <label className="field">
            <span>Dystans (km)</span>
            <input className="input" inputMode="decimal" value={km} onChange={(ev) => setKm(ev.target.value)} placeholder="opcjonalnie" />
          </label>
        </div>
        <p className="muted small">Interwały: np. 8 odcinków po 1 min. Tętno i RPE wpiszesz przy każdym odcinku.</p>
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
  return (
    <form
      className="acard add-form"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (!name.trim()) return;
        const n = numIn(sets, 1, 20);
        if (n == null || !Number.isInteger(n)) return toast('Serie: od 1 do 20.');
        if (load.trim() && (num(load) == null || num(load)! < 0)) return toast('Ciężar: wpisz liczbę kg albo zostaw puste.');
        onAdd(name.trim(), n, reps.trim() || '8', load.replace(',', '.'), linked);
      }}
    >
      {tabs}
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
function LayoutSheet({ run, setRun, onClose, onAdd, canSavePlan }: { run: Run; setRun: (r: Run) => void; onClose: () => void; onAdd: () => void; canSavePlan: boolean }) {
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
    <Sheet label="Układ treningu" onClose={onClose}>
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
                  <button className={`chain ${e.linked ? 'on' : ''}`} aria-pressed={!!e.linked} aria-label={e.linked ? `Rozłącz ${e.name} z poprzednim` : `Połącz ${e.name} z poprzednim w superserię`} title={e.linked ? 'Rozłącz z poprzednim' : 'Połącz z poprzednim (superseria / obwód)'} onClick={() => setRun(toggleLink(run, k))}>
                    ⛓
                  </button>
                )}
                <IconBtn icon="up" label={`W górę: ${e.name}`} onClick={() => setRun(moveExercise(run, k, -1))} />
                <IconBtn icon="chevD" label={`W dół: ${e.name}`} onClick={() => setRun(moveExercise(run, k, 1))} />
                <IconBtn
                  icon="trash"
                  label={`Usuń ćwiczenie ${e.name}`}
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
        {canSavePlan && plan && workout && (
          <button className="btn btn-ghost btn-block" onClick={saveToPlan}>
            Zapisz ten układ także w planie
          </button>
        )}
      </Sheet>
  );
}
