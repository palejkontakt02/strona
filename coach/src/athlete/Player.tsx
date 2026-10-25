import { useCallback, useEffect, useRef, useState } from 'react';
import { Sheet } from '../components/Sheet';
import { useDialog } from '../components/useDialog';
import { Icon, IconBtn } from '../components/ui';
import { SetVideoButton } from '../components/SetVideo';
import { ChargeSelect, LocationSelect } from '../components/location';
import type { Billing, Client, PainSpot, PlanExercise, RunProfile, SetGroup, TrainingSession } from '../domain';
import { PlateCalc } from '../components/PlateCalc';
import { PainMap } from '../components/PainMap';
import { cleanPainMap, painSummary } from '../lib/painMap';
import { RunBuilder, RunTargetList } from '../components/RunBuilder';
import { chargeProblem, isSolo, savePlan, saveSession, sessionsOf } from '../data/ops';
import { useStore } from '../data/store';
import { doneOn, dueOn } from '../lib/habits';
import { fmtDay, fmtRest, fnum, uid } from '../format';
import { defaultCharge, packageHint, packageStatus } from '../lib/billing';
import { fmtSec as fmtHold, num, numIn, repsN, secOf, sidesOf, sumReps } from '../lib/parse';
import { barbellByName, checkRecord, recentE1, sessionRecords } from '../lib/strength';
import { emptyRunExercise, fmtDur, paceText, parseDur, parseKm, recoverySec, targetText } from '../lib/running';
import {
  adHocCardio,
  adHocExercise,
  timedByName,
  loadPerOf,
  appendExercise,
  applyRunLayout,
  blockRest,
  buildRunExercise,
  completeSet,
  moveExercise,
  nextBlockSet,
  removeExercise,
  renameExercise,
  runBlocks,
  runToExercises,
  toggleLink,
  type Run,
  type RunExercise,
  type RunSet,
} from '../lib/run';
import { LoadPerToggle } from '../components/LoadPerToggle';
import { RefComment } from '../components/RefComment';
import { compareWorkouts, fillFromLast, fmtLast, isNoLoad, lastExerciseLog, previousWorkout, resultDelta, srpeFromSets, workIndex, workoutStats } from '../lib/lastResult';
import type { SetLog } from '../domain';
import { primeRestAudio, restAudioPlaying, restSoundOn, setRestSound, startRestAudio, stopRestAudio, useWakeLock } from './playerDevice';
import { WorkoutDone, type DoneInfo } from './WorkoutDone';

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
  /** Trening w parze: koniec przerwy tej osoby (zakładka partnera pokazuje odliczanie). */
  onRest?: (end: number | null) => void;
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
  /** Gdzie boli (przy bólu > 0). */
  painMap: PainSpot[];
}

/** Ćwiczenie na stronę: czas zmiany strony między lewą a prawą (s). */
const SWITCH_SEC = 5;

interface Hold {
  end: number;
  total: number;
  what?: string;
  /** Na stronę: lewa → zmiana → prawa (druga strona odlicza się sama). */
  side?: 'L' | 'switch' | 'P';
  second?: number;
}

/** Mapa bólu do zapisu: tylko przy bólu > 0 i z zaznaczonymi miejscami. */
function painOf(f: Finish): PainSpot[] | undefined {
  const m = Number(f.pain) > 0 ? cleanPainMap(f.painMap) : [];
  return m.length ? m : undefined;
}

/** Płynne przewijanie, chyba że użytkownik wyłączył animacje. */
const smoothScroll = (): ScrollBehavior => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

/** Czas od startu; po kilku godzinach (trening wznowiony następnego dnia) zostawia pole puste do wpisania. */
function elapsedMinutes(startedAt: number): string {
  const m = Math.round((Date.now() - startedAt) / 60000);
  // kilka minut = trening uzupełniany po fakcie — puste pole zamiast zaniżonego czasu (i obciążenia)
  return m >= 10 && m <= 240 ? String(m) : '';
}

export function Player({ client, run, setRun, onHome, onSaved, onCancel, mode = 'athlete', homeLabel = '‹ Wróć', appointmentId, onRest }: Props) {
  const { db, apply, toast, ask, sendClientNote, saveHabitDay } = useStore();
  const [rest, setRest] = useState<{ end: number; total: number; note?: string } | null>(null);
  useEffect(() => {
    onRest?.(rest?.end ?? null);
  }, [rest, onRest]);
  const [hold, setHold] = useState<Hold | null>(null);
  const [plates, setPlates] = useState<{ kg: number; title: string } | null>(null);
  // obwód / superseria: dokładnie ta seria jest następna (A1 → A2 → przerwa → A1)
  const [nextSet, setNextSet] = useState<{ k: number; i: number } | null>(null);
  /** Historia bez poprawianego treningu (do rekordów). */
  const history = () => sessionsOf(db, client.id).filter((x) => x.id !== run.editSessionId);
  const [tempoOpen, setTempoOpen] = useState(false);
  const [finish, setFinish] = useState<Finish | null>(null);
  const [adding, setAdding] = useState(run.ex.length === 0);
  const [layoutOpen, setLayoutOpen] = useState(false);
  // ćwiczenia z rozwiniętym wyborem typu (cardio / na czas / na stronę)
  const [optsOpen, setOptsOpen] = useState<Set<number>>(new Set());
  const trainer = mode === 'trainer';
  const blocks = runBlocks(run);
  const bi = Math.max(0, blocks.findIndex((b) => b.includes(run.idx)));
  const block = blocks[bi] ?? [];
  const last = bi >= blocks.length - 1;
  const tempoEx = block.map((k) => run.ex[k]).find((x) => x.tempo);
  const [hintNext, setHintNext] = useState<number | null>(null);
  // ekran „Trening zakończony” (podopieczny, nowy trening) — po zapisie, przed powrotem do Dziś
  const [doneInfo, setDoneInfo] = useState<DoneInfo | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  // wysiłek podpowiedziany z RPE serii (żeby opisać, skąd domyślna wartość)
  const [srpeHint, setSrpeHint] = useState<string | null>(null);
  const [sound, setSound] = useState(restSoundOn);
  // ćwiczenia bez ciężaru, przy których ktoś jednak chce wpisać kg
  const [kgOn, setKgOn] = useState<Set<number>>(new Set());

  // ekran nie gaśnie w trakcie treningu (zwolnienie po zakończeniu / wyjściu)
  useWakeLock(!doneInfo);
  // przerwa: plik „cisza + sygnał” gra przy zablokowanym ekranie; pominięcie / zmiana — nowy plik albo stop
  useEffect(() => {
    if (rest && sound && !doneInfo) startRestAudio(rest.end, { title: rest.note ? `Przerwa (${rest.note})` : 'Przerwa', subtitle: run.name });
    else stopRestAudio(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rest?.end, sound, doneInfo]);
  useEffect(() => () => stopRestAudio(), []);

  /** Ostatnie wykonanie ćwiczenia (serie robocze) — „ostatnio 60×8” i strzałki przy wyniku. */
  const lastCache = useRef<{ key: string; map: Map<string, SetLog[]> }>({ key: '', map: new Map() });
  const lastOf = useCallback(
    (name: string): SetLog[] => {
      const key = `${db.sessions.length}|${run.date}|${run.editSessionId ?? ''}`;
      if (lastCache.current.key !== key) lastCache.current = { key, map: new Map() };
      const m = lastCache.current.map;
      if (!m.has(name)) m.set(name, lastExerciseLog(sessionsOf(db, client.id), name, { before: run.date, excludeId: run.editSessionId }));
      return m.get(name)!;
    },
    [db, client.id, run.date, run.editSessionId],
  );
  /** Bez kolumny kg i bez kamery w każdym wierszu (masa ciała, skoki, deska…). */
  const noLoad = (k: number) => {
    const e = run.ex[k];
    if (!e || kgOn.has(k)) return false;
    return isNoLoad(e, { cat: db.library.find((l) => l.name.toLowerCase() === e.name.toLowerCase())?.cat, last: lastOf(e.name) });
  };

  const update = (fn: (r: Run) => void) => {
    const next = structuredClone(run);
    fn(next);
    setRun(next);
    return next;
  };
  const setSet = (k: number, i: number, patch: Partial<RunSet>) => update((r) => void Object.assign(r.ex[k].sets[i], patch));
  const go = (b: number) => {
    setHintNext(null);
    setNextSet(null);
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
      update((r) => void (r.ex[k].sets = completeSet(r.ex[k], i).sets.map((x, j) => (j === i ? { ...x, pr: undefined } : x))));
      setRest(null);
      setHintNext(null);
      setNextSet(null);
      return;
    }
    if (s.rpe.trim() && numIn(s.rpe, 1, 10) == null) return toast('RPE: od 1 do 10 (jak ciężka była seria).');
    if (ex.cardio) {
      if (!s.reps.trim() && !(s.dist ?? '').trim()) return toast('Wpisz czas (min albo m:ss) albo dystans (km).');
      const d = parseDur(s.reps);
      if (s.reps.trim() && (d == null || d < 0.05 || d > 1440)) return toast('Czas: minuty (np. 20) albo minuty:sekundy (np. 3:05).');
      if ((s.dist ?? '').trim() && (parseKm(s.dist) ?? 0) > 300) return toast('Dystans: km (np. 3,5) albo metry (np. 400 m).');
      if ((s.dist ?? '').trim() && parseKm(s.dist) == null) return toast('Dystans: km (np. 3,5) albo metry (np. 400 m).');
      if ((s.hr ?? '').trim() && numIn(s.hr, 30, 240) == null) return toast('Tętno: od 30 do 240.');
      const km = parseKm(s.dist);
      // „1:20” przy 16 km to 1 min 20 s — tempo niemożliwe, prawie na pewno chodziło o godziny
      if (d && km && km >= 0.8 && d / km < 2.4) return toast(`Tempo ${paceText(d, km)} to za szybko — „${s.reps.trim()}” to ${fmtDur(d)}. Dla godzin wpisz np. 1:20:00 albo 80.`);
      const next = update((r) => void (r.ex[k].sets[i].done = true));
      // przerwa po powtórzeniu (z odcinka albo całego biegu) — tylko między powtórzeniami tego samego odcinka
      const nextSet = run.ex[k].sets[i + 1];
      const rec = recoverySec(s.rest || ex.rest);
      // kolejne powtórzenie tego samego odcinka (bez numeru bloku — ten sam rodzaj, nie rozgrzewka)
      const sameBlock = !!nextSet && !nextSet.done && (s.gi != null ? nextSet.gi === s.gi : !s.warmup && !nextSet.warmup && nextSet.label === s.label);
      if (sameBlock && (rec === null || (rec === 0 && (s.rest || ex.rest)))) toast(`Teraz: ${s.rest || ex.rest}`);
      else if (sameBlock && rec && !next.ex.every((e) => e.sets.every((x) => x.done))) setRest({ end: Date.now() + rec * 1000, total: rec });
      return;
    }
    const hasPrev = ex.sets.slice(0, i).some((x) => x.done && !x.warmup);
    if (s.unit === 's') {
      // seria na czas: sekundy, m:ss albo „2 min”; na stronę „30/25”
      if (!s.warmup && !hasPrev && !s.reps.trim()) return toast('Wpisz czas serii (np. 30 albo 1:30).');
      if (s.reps.trim() && !sidesOf(s.reps) && !secOf(s.reps)) return toast('Czas: sekundy (np. 45), minuty:sekundy (1:30) albo „2 min”.');
    } else {
      if (!s.warmup && !hasPrev && !s.reps.trim()) return toast('Wpisz liczbę powtórzeń.');
      if (s.reps.trim() && !/\d/.test(s.reps)) return toast('Powtórzenia: wpisz liczbę.');
      if (s.reps.trim() && sumReps(s.reps) === 0) return toast('Powtórzenia: co najmniej 1.');
    }
    if (s.load.trim() && !/^\s*-?\d+([.,]\d+)?\s*(kg)?\s*$/i.test(s.load)) return toast(`Ciężar „${s.load.trim()}” — wpisz samą liczbę, np. 42,5.`);
    const load = num(s.load);
    if (load != null && load < 0) return toast('Ciężar nie może być ujemny.');
    const best = recentE1(sessionsOf(db, client.id), ex.name);
    if (load != null && (load > 400 || (best != null && load > best * 1.5)) && !(await ask(`${fnum(load)} kg to dużo więcej niż dotychczas${best ? ` (szacowane maks. ${fnum(best, 0)} kg)` : ''}. Na pewno?`, { confirm: 'Tak, zalicz', danger: false }))) return;
    const res = completeSet(ex, i);
    // rekord: seria robocza z ciężarem (bez serii na czas i kompleksów) lepsza niż dotąd w historii i dziś
    const ds = res.sets[i];
    const hit =
      !ds.warmup && !ex.cardio && !ex.timed && !ds.unit && !ds.reps.includes('+')
        ? checkRecord(history(), ex.name, res.sets.slice(0, i).filter((x) => x.done && !x.warmup && !x.unit && !x.reps.includes('+')), ds)
        : null;
    res.sets[i] = { ...ds, pr: hit?.text };
    const next = update((r) => void (r.ex[k].sets = res.sets));
    if (hit) {
      vibrate([80, 60, 80, 60, 160]);
      toast(hit.text);
    }
    const br = blockRest(next, k, i);
    setHintNext(br.next ?? null);
    const allDone = next.ex.every((e) => e.sets.every((x) => x.done));
    // obwód: wskaż następną serię (ta sama runda → kolejne ćwiczenie; runda zamknięta → A1 po przerwie)
    const bl = runBlocks(next).find((b) => b.includes(k)) ?? [k];
    const ns = bl.length > 1 && !s.warmup ? nextBlockSet(next, bl) : null;
    setNextSet(ns ? { k: ns.k, i: ns.i } : null);
    if (ns) {
      setHintNext(ns.k);
      window.setTimeout(() => {
        const row = document.querySelector<HTMLElement>(`[data-set="${ns.k}-${ns.i}"]`);
        row?.scrollIntoView({ behavior: smoothScroll(), block: 'center' });
        row?.querySelector<HTMLButtonElement>('button.ok')?.focus({ preventScroll: true });
      }, 60);
    }
    const roundClosed = ns && br.next == null;
    // po ostatniej serii całego treningu nie ma już przerwy — tylko „Zakończ”
    if (br.rest && !allDone) setRest({ end: Date.now() + br.rest * 1000, total: br.rest, note: roundClosed ? `dalej runda ${ns.round + 1} z ${ns.rounds}` : undefined });
  };

  /** Koniec odliczania serii na czas; na stronę: lewa → „Zmiana strony” → prawa. */
  const onHoldEnd = () => {
    const h = hold;
    if (h?.side === 'L') {
      vibrate([300, 120, 300]);
      beep(660, 0.3);
      toast('Zmiana strony');
      setHold({ end: Date.now() + SWITCH_SEC * 1000, total: SWITCH_SEC, what: h.what, side: 'switch', second: h.second });
      return;
    }
    if (h?.side === 'switch') {
      vibrate(200);
      beep(880, 0.12);
      const sec = h.second || 1;
      setHold({ end: Date.now() + sec * 1000, total: sec, what: h.what, side: 'P' });
      return;
    }
    vibrate([200, 100, 200]);
    beep(880, 0.25);
    toast('Koniec — zalicz serię ✓');
    setHold(null);
  };

  const editing = run.editSessionId ? db.sessions.find((x) => x.id === run.editSessionId) : undefined;

  // jeden zapis naraz: przy słabym zasięgu zapis trwa, a kolejne naciśnięcia nie mogą tworzyć kolejnych treningów
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  // id nowego treningu ustalone przy otwarciu podsumowania — ponowiony zapis nadpisuje ten sam trening, nie dubluje
  const newIdRef = useRef<string | null>(null);
  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await doSave();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const doSave = async () => {
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
        painMap: painOf(finish),
        notes: finish.notes.trim() || undefined,
        locationId: (trainer ? finish.locationId : editing.locationId) || undefined,
        exercises: runToExercises(run),
        solo: finish.solo,
      };
      if (updated.exercises.length === 0) return toast('Zostaw przynajmniej jedną zaliczoną serię (✓).');
      const { changes } = saveSession(db, { session: updated, isNew: false });
      if (!(await apply(changes, 'Zapisano zmiany w treningu.'))) return; // trening zostaje — można ponowić zapis
      // ból podniesiony do ≥5 przy poprawce — trener dostaje informację tak samo jak przy pierwszym zapisie
      if (!trainer && updated.pain != null && updated.pain >= 5 && (editing.pain ?? 0) < 5) {
        void sendClientNote(client.id, `Ból ${updated.pain}/10${updated.painMap?.length ? ` (${painSummary(updated.painMap)})` : ''} po treningu „${updated.workoutName || 'Trening'}”${updated.notes ? `: ${updated.notes}` : ''}`, updated.id);
        void ask(`Ból ${updated.pain}/10 — trener dostał informację. Do czasu jego odpowiedzi: nie zwiększaj ciężarów, a jeśli ból narasta albo nie mija do jutra, odpuść trening, który go wywołuje.`, { confirm: 'Rozumiem', danger: false, cancel: 'Zamknij' });
      }
      setFinish(null);
      onSaved();
      return;
    }
    const today = run.date;
    const check = client.checkins.find((c) => c.date === today);
    const session: TrainingSession = {
      id: (newIdRef.current ??= uid()),
      clientId: client.id,
      date: today,
      workoutName: run.name,
      charge: trainer ? finish.charge : 'brak',
      duration: numIn(finish.duration, 1, 600) ?? undefined,
      srpe: Number(finish.srpe),
      pain: finish.pain === '' ? undefined : Number(finish.pain),
      painMap: painOf(finish),
      notes: finish.notes.trim() || undefined,
      wellness: check ? { sleep: check.sleep, energy: check.energy, muscle: check.muscle, stress: check.stress, mood: check.mood } : undefined,
      // samodzielnie (np. w domu) — bez miejsca klubu, żeby nie liczyło się do rozliczeń z klubem
      locationId: (trainer ? finish.locationId : undefined) || undefined,
      planId: run.planId,
      workoutId: run.workoutId,
      exercises: runToExercises(run),
      solo: finish.solo,
      withIds: run.pairWith?.filter((id) => id !== client.id).length ? run.pairWith.filter((id) => id !== client.id) : undefined,
    };
    if (session.exercises.length === 0) return toast('Zalicz przynajmniej jedną serię (✓), zanim zapiszesz trening.');
    // wizyta z innego dnia: zapis z datą wizyty albo bez łączenia z nią
    let apptId = finish.solo ? undefined : appointmentId;
    const appt = apptId ? db.appointments.find((a) => a.id === apptId) : undefined;
    if (appt && appt.date !== session.date) {
      if (await ask(`Ta wizyta jest ${fmtDay(appt.date)}, a trening zapisuje się z datą ${fmtDay(session.date)}. Zapisać z datą wizyty (${fmtDay(appt.date)})?`, { confirm: `Tak, ${fmtDay(appt.date)}` })) session.date = appt.date;
      else apptId = undefined;
    }
    const { changes, message } = saveSession(db, { session, isNew: true, appointmentId: apptId, matchAppointment: trainer && !(appointmentId && !apptId), amount: trainer ? num(finish.amount) ?? undefined : undefined, paidNow: finish.paidNow });
    // podsumowanie liczone przed zapisem — po nim ten trening jest już w historii (rekordy porównują się z wcześniejszymi)
    const before = history();
    const summary: DoneInfo | null = trainer
      ? null
      : (() => {
          const stats = workoutStats(session);
          const prev = previousWorkout(before, session);
          const cmp = compareWorkouts(stats, prev ? workoutStats(prev) : undefined);
          return {
            sessionId: session.id,
            clientId: client.id,
            name: session.workoutName || 'Trening',
            date: session.date,
            duration: session.duration,
            stats,
            records: recordsOf(before).map((p) => ({ name: p.name, text: `${p.hit.reps} × ${fnum(p.hit.load)} kg` })),
            diff: cmp && prev ? { ...cmp, date: prev.date } : null,
            brand: 'Fitowa',
          };
        })();
    if (!(await apply(changes, trainer ? message : 'Trening zapisany. Dobra robota!'))) return; // trening zostaje — można ponowić zapis
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
        `${hurt ? `Ból ${session.pain}/10${session.painMap?.length ? ` (${painSummary(session.painMap)})` : ''} po treningu` : 'Po treningu'} „${session.workoutName || 'Trening'}”${session.notes ? `: ${session.notes}` : ''}`,
        session.id,
      );
    if (hurt) void ask(`Ból ${session.pain}/10 — trener dostał informację. Do czasu jego odpowiedzi: nie zwiększaj ciężarów, a jeśli ból narasta albo nie mija do jutra, odpuść trening, który go wywołuje.`, { confirm: 'Rozumiem', danger: false, cancel: 'Zamknij' });
    setFinish(null);
    if (summary) {
      // ekran „Trening zakończony”; trening w toku przechodzi w poprawki zapisanego — zamknięcie aplikacji
      // na tym ekranie i powrót nie zapisze go drugi raz
      setRest(null);
      setHold(null);
      setRun({ ...run, editSessionId: session.id });
      setDoneInfo(summary);
      return;
    }
    onSaved();
  };
  /** Rekordy w tym treningu względem historii `hist`. */
  const recordsOf = (hist: TrainingSession[]) =>
    sessionRecords(
      hist,
      run.ex.map((e) => ({ name: e.name, cardio: e.cardio, timed: e.timed, sets: e.sets.filter((x) => x.done).map((x) => ({ load: x.load, reps: x.reps, rpe: x.rpe, warmup: x.warmup, unit: x.unit })) })),
    );

  /** Przed podsumowaniem: nagrania na niezaliczonych seriach i trening skończony dużo wcześniej. */
  const openFinish = async () => {
    if (!editing && !run.ex.some((e) => e.sets.some((x) => x.done || x.video))) return toast('Zalicz przynajmniej jedną serię (✓), zanim zakończysz trening.');
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
    if (!editing && total > 2 && done < total / 2 && !(await ask(`Zaliczono ${done} z ${total} serii roboczych. Zakończyć trening teraz? Niezaliczone serie nie zostaną zapisane.`, { confirm: 'Zakończ' }))) return;
    showFinish();
  };
  const showFinish = () => {
    newIdRef.current = null; // nowe podsumowanie = nowy trening
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
        painMap: editing.painMap ?? [],
      });
      return;
    }
    const solo = !trainer && !db.appointments.some((a) => a.clientId === client.id && a.date === run.date && a.status !== 'cancel' && a.status !== 'noshow');
    // wysiłek całego treningu podpowiedziany ze średniego RPE serii — zwykle wystarczy „Zapisz”
    const fromRpe = srpeFromSets(run.ex.flatMap((e) => e.sets.filter((x) => x.done && !x.warmup).map((x) => x.rpe)));
    setSrpeHint(fromRpe != null ? String(fromRpe) : null);
    setFinish({
      srpe: !trainer && fromRpe != null ? String(fromRpe) : '',
      pain: '',
      // bieg wpisany po fakcie: czas z odcinków (suma wpisanych minut)
      duration: elapsedMinutes(run.startedAt) || (() => {
        const m = run.ex.filter((e) => e.cardio).reduce((a, e) => a + e.sets.filter((x) => x.done).reduce((b, x) => b + (parseDur(x.reps) ?? 0), 0), 0);
        return m >= 1 ? String(Math.round(m)) : '';
      })(),
      notes: '',
      charge,
      // w parze — stawka „w parze” z profilu (jeśli ustawiona)
      amount: run.pairWith?.length && client.pairRate ? String(client.pairRate) : client.singleRate ? String(client.singleRate) : '',
      paidNow: true,
      locationId: db.appointments.find((a) => a.id === appointmentId)?.locationId ?? client.locationId ?? '',
      // podopieczny: domyślnie sam, chyba że ma dziś wizytę; trener prowadzący: z trenerem
      solo,
      painMap: [],
    });
  };

  const totalSets = run.ex.reduce((a, x) => a + x.sets.length, 0);
  const doneSets = run.ex.reduce((a, x) => a + x.sets.filter((s) => s.done).length, 0);
  const blockName = (b: number[]) => b.map((k) => run.ex[k].name).join(' + ');

  /** Długie przytrzymanie numeru serii (trener) — usunięcie z potwierdzeniem; zwykłe stuknięcie nic nie usuwa. */
  const pressRef = useRef<number | null>(null);
  const pressProps = (k: number, i: number, num: string) => ({
    onPointerDown: () => {
      if (pressRef.current) clearTimeout(pressRef.current);
      pressRef.current = window.setTimeout(() => {
        pressRef.current = null;
        vibrate(30);
        void removeAt(k, i, num);
      }, 650);
    },
    onPointerUp: () => {
      if (pressRef.current) {
        clearTimeout(pressRef.current);
        pressRef.current = null;
        toast('Przytrzymaj numer serii, żeby ją usunąć.');
      }
    },
    onPointerLeave: () => {
      if (pressRef.current) clearTimeout(pressRef.current);
      pressRef.current = null;
    },
    onContextMenu: (ev: React.MouseEvent) => ev.preventDefault(),
  });

  const setRow = (k: number, i: number, num: string, label?: string, blockNoLoad?: boolean) => {
    const s = run.ex[k].sets[i];
    const e = run.ex[k];
    const bare = blockNoLoad ?? noLoad(k);
    const isNext = nextSet ? nextSet.k === k && nextSet.i === i && !s.done : hintNext === k && !s.done;
    // narzędzia serii: tempo z planu i kalkulator talerzy (sztanga)
    const kg = numIn(s.load, 0.01, 2000);
    const showTempo = !!e.tempoStr && !s.done && !s.warmup && !s.unit && !e.cardio;
    // talerze tylko przy następnej serii ćwiczenia (bez powtarzania w każdym wierszu)
    const showPlates = !s.done && !e.cardio && !e.timed && kg != null && kg > 20 && barbellByName(e.name) && e.sets.findIndex((x) => !x.done) === i;
    const tools =
      showTempo || showPlates ? (
        <span className="setx">
          {showTempo && (
            <span className="tempo-chip" title="Tempo: opuszczanie – pauza w dole – podnoszenie – pauza w górze (s)">
              tempo {e.tempoStr}
            </span>
          )}
          {showPlates && (
            <button type="button" className="plate-btn" aria-label={`Talerze, ${e.name}, seria ${num}`} onClick={() => setPlates({ kg: kg!, title: e.name })}>
              talerze
            </button>
          )}
        </span>
      ) : null;
    // ta sama seria poprzednim razem: „ostatnio 60×8” (stuknięcie kopiuje do pól) i strzałka po zaliczeniu
    const wi = e.cardio ? null : workIndex(e.sets, i);
    const lastSet = wi != null ? lastOf(e.name)[wi] : undefined;
    const lastText = fmtLast(lastSet);
    const deltas = s.done && lastSet ? resultDelta(lastSet, { load: bare ? '' : s.load, reps: s.reps, unit: s.unit }) : [];
    const lastLine =
      lastText || deltas.length ? (
        <div className="prevhint lastline">
          {lastText &&
            (s.done ? (
              <span className="last-txt">ostatnio {lastText}</span>
            ) : (
              <button
                type="button"
                className="last-btn"
                aria-label={`Wpisz wynik z ostatniego razu: ${lastText}, ${e.name}, seria ${num}`}
                onClick={() => {
                  const f = fillFromLast(lastSet!);
                  setSet(k, i, { reps: f.reps || s.reps, ...(bare || !f.load ? {} : { load: f.load, edited: true }) });
                }}
              >
                ostatnio <b>{lastText}</b>
              </button>
            ))}
          {deltas.map((d) => (
            <span key={d.text} className={`delta ${d.dir === 'same' ? 'delta-same' : ''} ${s.pr && d.dir === 'up' ? 'is-pr' : ''}`}>
              {d.text}
            </span>
          ))}
        </div>
      ) : null;
    const snInner = label ? <span className="ex-label">{label}</span> : num;
    return (
      <div key={`${k}-${i}`} data-set={`${k}-${i}`}>
        <div className={`sgrid ${run.ex[k].cardio ? 'cardio' : ''} ${bare && !e.cardio ? 'noload' : ''} ${blockNoLoad === undefined && e.perSide && !e.cardio && !bare && !sidesWide(e) ? 'sides' : ''} ${s.done ? 'done' : ''} ${s.warmup ? 'warm' : ''} ${isNext ? 'is-next' : ''}`}>
          {trainer && run.ex[k].sets.length > 1 ? (
            <button type="button" className="sn sn-btn" {...pressProps(k, i, num)} aria-label={`Seria ${num}, ${run.ex[k].name} — przytrzymaj, żeby usunąć`} title="Przytrzymaj, żeby usunąć tę serię">
              {snInner}
            </button>
          ) : (
            <span className="sn">{snInner}</span>
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
            <span className={`lr ${sidesWide(run.ex[k]) ? 'wide' : ''}`}>
              {(() => {
                const [l, r] = sidesOf(s.reps)?.map(String) ?? [s.reps, s.reps];
                const set = (nl: string, nr: string) => setSet(k, i, { reps: nl === nr ? nl : `${nl}/${nr}` });
                return (
                  <>
                    <input inputMode="numeric" value={l} placeholder="L" onFocus={selectAll} onChange={(ev) => set(ev.target.value, r)} aria-label={`Lewa strona, ${run.ex[k].name}, seria ${num}`} />
                    <input inputMode="numeric" value={r} placeholder="P" onFocus={selectAll} onChange={(ev) => set(l, ev.target.value)} aria-label={`Prawa strona, ${run.ex[k].name}, seria ${num}`} />
                  </>
                );
              })()}
            </span>
          ) : (
            s.unit && !s.done && holdSec(s) > 0 ? (
              // seria na czas: odliczanie w polu tej serii
              <span className="reps-hold">
                <input inputMode="text" value={s.reps} placeholder="s" onFocus={selectAll} onChange={(ev) => setSet(k, i, { reps: ev.target.value })} aria-label={`Czas, ${run.ex[k].name}, seria ${num}`} />
                <button
                  type="button"
                  className="hold-btn"
                  aria-label={`Odliczaj ${fmtHold(holdSec(s))} — ${run.ex[k].name}, seria ${num}`}
                  title={`Odliczaj ${fmtHold(holdSec(s))}`}
                  onClick={() => setHold({ end: Date.now() + holdSec(s) * 1000, total: holdSec(s), what: `${label ?? run.ex[k].label ?? ''} ${run.ex[k].name.slice(0, 18)} · seria ${num}`.trim() })}
                >
                  <Icon name="timer" size={16} />
                </button>
              </span>
            ) : (
              <input inputMode={s.unit === 's' || complexEx(run.ex[k]) ? 'text' : 'numeric'} value={s.reps} placeholder={s.unit === 's' ? 's' : undefined} onFocus={selectAll} onChange={(ev) => setSet(k, i, { reps: ev.target.value })} aria-label={`${s.unit ? 'Czas' : 'Powtórzenia'}, ${run.ex[k].name}, seria ${num}`} />
            )
          )}
          {!run.ex[k].cardio && (
            <>
              {!sidesWide(run.ex[k]) && !bare && <input inputMode="decimal" value={s.load} className={s.sug && !s.edited ? 'sugg' : ''} onFocus={selectAll} onChange={(ev) => setSet(k, i, { load: ev.target.value, edited: true })} aria-label={`Ciężar, ${run.ex[k].name}, seria ${num}`} />}
              <input inputMode="decimal" value={s.rpe} placeholder={s.tRpe} onChange={(ev) => setSet(k, i, { rpe: ev.target.value })} aria-label={`RPE, ${run.ex[k].name}, seria ${num}`} />
              {!bare && <SetVideoButton clientId={client.id} video={s.video} title={`${run.ex[k].name} · seria ${num}`} onChange={(video) => setSet(k, i, { video })} />}
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
        {s.pr && s.done && (
          <div className="prhint" role="status">
            <Icon name="trophy" size={15} /> {s.pr}
          </div>
        )}
        {(() => {
          const sug = s.sug && !s.done && !e.cardio ? <div className="sughint">{s.sug}</div> : null;
          const hint = sug || lastLine ? (sug && lastLine ? <div className="hintcol">{sug}{lastLine}</div> : sug ?? lastLine) : null;
          if (!tools) return hint;
          return (
            <div className="setline">
              {hint ?? <span />}
              {tools}
            </div>
          );
        })()}
        {/* cardio i „na stronę” — odliczanie pod wierszem (seria na czas ma stoper w polu) */}
        {s.unit && !s.done && (run.ex[k].cardio ? (parseDur(s.reps) ?? 0) > 0 : run.ex[k].perSide && holdSec(s) > 0) && (
          <button
            className="link small hold-start"
            onClick={() => {
              const sec = run.ex[k].cardio ? Math.round((parseDur(s.reps) ?? 0) * 60) : holdSec(s);
              const what = `${run.ex[k].name.slice(0, 18)} · ${num}`;
              if (run.ex[k].cardio) return setHold({ end: Date.now() + sec * 1000, total: sec, what });
              // na stronę: lewa, sygnał „Zmiana strony”, prawa — bez dotykania telefonu
              const lr = sidesOf(s.reps);
              const second = lr ? Math.round(lr[1] * (s.unit === 'min' ? 60 : 1)) : sec;
              setHold({ end: Date.now() + sec * 1000, total: sec, what, side: 'L', second: second || sec });
            }}
          >
            <Icon name="timer" size={16} /> Odliczaj {run.ex[k].cardio ? fmtDur(parseDur(s.reps) ?? 0) : fmtHold(holdSec(s))}
            {run.ex[k].perSide ? ' — jedna strona, potem druga' : ''}
          </button>
        )}
        {trainer && s.warmup && !s.done && (
          <button className="link small muted warm-remove" onClick={() => (s.video ? void removeAt(k, i, 'wstępną') : removeWarmup(k, i))}>
            ✕ usuń tę serię wstępną
          </button>
        )}
        {trainer && !s.warmup && !s.done && !s.reps.trim() && !s.load.trim() && run.ex[k].sets.length > 1 && (
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

  const header = (k: number, blockBare?: boolean) => {
    const e = run.ex[k];
    const bare = blockBare ?? noLoad(k);
    // bez ciężaru: jedna kamera na ćwiczenie — nagranie trafia do bieżącej serii
    const camAt = (() => {
      const i = e.sets.findIndex((x) => !x.done && !x.warmup);
      return i >= 0 ? i : e.sets.length - 1;
    })();
    const kind = [e.cardio && 'cardio', e.timed && 'na czas', e.perSide && 'na każdą stronę'].filter(Boolean).join(' · ');
    return (
      <div key={`h${k}`} className="run-ex-head">
        <div className="between">
          <h2>
            {e.label && <span className="ex-label ex-label-lg">{e.label}</span>} {e.name}
          </h2>
          <span className="ex-head-side">
            {e.video && (
              <a className="small" href={e.video} target="_blank" rel="noreferrer">
                ▶ Wideo
              </a>
            )}
            {!trainer && <RefComment clientId={client.id} sessionId={run.editSessionId} exIndex={k} />}
          </span>
        </div>
        <div className="ex-tools">
          {bare && camAt >= 0 && !e.cardio && (
            <span className="ex-cam">
              <SetVideoButton clientId={client.id} video={e.sets[camAt]?.video} title={`${e.name} · nagranie techniki`} onChange={(video) => setSet(k, camAt, { video })} />
              <span className="muted small">{e.sets.some((x) => x.video) ? 'nagranie dodane' : 'nagraj technikę'}</span>
            </span>
          )}
          {bare && !e.cardio && (
            <button type="button" className="link small ex-kg-on" onClick={() => setKgOn((o) => new Set([...o, k]))}>
              + ciężar
            </button>
          )}
        </div>
        {!trainer && kind && <div className="ex-kind muted small">{kind}</div>}
        {/* typ ćwiczenia (cardio / na czas / na stronę) schowany — na wierzchu tylko włączone; podopieczny go nie zmienia */}
        {trainer && !optsOpen.has(k) && !e.sets.some((x) => x.done) && (
          <button type="button" className="link small ex-opts-btn" onClick={() => setOptsOpen((o) => new Set([...o, k]))}>
            <Icon name="settings" size={14} /> Typ ćwiczenia
          </button>
        )}
        {trainer && (optsOpen.has(k) || e.cardio) && !e.sets.some((x) => x.done) && (
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
            <Icon name="heart" size={14} /> {e.cardio ? 'Cardio — min / km / tętno' : 'Cardio?'}
          </button>
        )}
        {trainer && !e.cardio && !e.timed && (optsOpen.has(k) || !!loadPerOf(e)) && <LoadPerToggle value={loadPerOf(e)} onChange={(v) => update((r) => void (r.ex[k].loadPer = v))} />}
        {trainer && !e.cardio && (optsOpen.has(k) || e.timed) && !e.sets.some((x) => x.done) && (
          <button
            type="button"
            className={`side-toggle ${e.timed ? 'on' : ''}`}
            aria-pressed={!!e.timed}
            onClick={() =>
              update((r) => {
                const x = r.ex[k];
                x.timed = !x.timed || undefined;
                // na czas: sekundy w miejscu powtórzeń (wpisane liczby zostają)
                x.sets = x.sets.map((st) => ({ ...st, unit: x.timed ? 's' : undefined, reps: x.timed ? st.reps : st.reps.replace(/\s*s$/i, ''), sug: x.timed ? '' : st.sug }));
              })
            }
            title="Ćwiczenie na czas (deska, wall sit, zwis): wpisujesz sekundy zamiast powtórzeń"
          >
            <Icon name="timer" size={14} /> {e.timed ? 'Na czas — sekundy zamiast powtórzeń' : 'Na czas?'}
          </button>
        )}
        {trainer && !e.cardio && (optsOpen.has(k) || e.perSide) && (
        <button
          type="button"
          className={`side-toggle ${e.perSide ? 'on' : ''}`}
          aria-pressed={!!e.perSide}
          onClick={() => update((r) => void (r.ex[k].perSide = !r.ex[k].perSide || undefined))}
          title="Ćwiczenie na jedną stronę: wpisuj powtórzenia na każdą stronę"
        >
          ↔ {e.perSide ? (e.sets.some((x) => x.unit) ? 'Na każdą stronę — czas na stronę' : 'Na każdą stronę — powt. na stronę') : 'Na stronę? (np. 8 na lewą i 8 na prawą)'}
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
        {trainer && !e.cardio && (
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
          <div className={`sgrid sgrid-head ${noLoad(k) ? 'noload' : e.perSide && !sidesWide(e) ? 'sides' : ''}`}>
            <span />
            <span className={sidesWide(e) ? 'wide' : undefined}>{repsHead(e)}</span>
            {!sidesWide(e) && !noLoad(k) && <span>{kgHead(e)}</span>}
            <span title="RPE: jak ciężka była seria, 1–10 (10 = nie dało się zrobić ani jednego powtórzenia więcej)">RPE</span>
            {!noLoad(k) && <span />}
            <span />
          </div>
        )}
        {e.sets.map((s, i) => {
          const cool = s.label === 'Schłodzenie' || s.label === 'Przerwa';
          if (!s.warmup && !cool) n++;
          return (
            <div key={i}>
              {s.first && (!s.warmup || e.cardio) && s.gdesc && (
                <div className="ghead">
                  <b>{s.gdesc}</b>
                  {s.rest && <span className="muted small">przerwa {fmtRest(s.rest)}</span>}
                </div>
              )}
              {setRow(k, i, s.warmup ? (e.cardio ? 'R' : 'W') : s.label === 'Przerwa' ? 'P' : cool ? 'S' : String(n))}
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
    const cur = nextBlockSet(run, ks);
    // runda zamknięta: następna seria to pierwsze ćwiczenie bloku w kolejnej rundzie
    const newRound = !!cur && cur.round > 0 && ks.indexOf(cur.k) === 0;
    // kolumna kg znika tylko, gdy żadne ćwiczenie bloku nie ma ciężaru (jedna siatka dla całego bloku)
    const bare = ks.every((k) => noLoad(k));
    return (
      <>
        <div className="block-head">
          <span className="eyebrow">{ks.length === 2 ? 'Superseria' : 'Obwód'} · {ks.length} ćwiczenia na zmianę</span>
          <span className="muted small">przerwa po rundzie {lastRest || '2:00'}</span>
        </div>
        {ks.map((k) => header(k, bare))}
        <div className={`sgrid sgrid-head ${bare ? 'noload' : ''}`}>
          <span />
          <span>powt. / czas</span>
          {!bare && <span>kg</span>}
          <span title="RPE: jak ciężka była seria, 1–10 (10 = nie dało się zrobić ani jednego powtórzenia więcej)">RPE</span>
          {!bare && <span />}
          <span />
        </div>
        {warm.length > 0 && warm.map(({ k, i }) => setRow(k, i, 'W', `${run.ex[k].label}·W`, bare))}
        {Array.from({ length: rounds }, (_, r) => (
          <div key={r} className={`round ${cur && cur.round === r ? 'cur' : ''}`}>
            <div className="round-label">
              Runda {r + 1} z {rounds}
            </div>
            {ks.map((k, j) => (work[j][r] ? setRow(k, work[j][r].i, String(r + 1), run.ex[k].label, bare) : null))}
          </div>
        ))}
        {hintNext != null && block.includes(hintNext) && (
          <div className="sughint next-hint">
            {newRound && cur
              ? `Runda ${cur.round + 1} z ${cur.rounds} — po przerwie ${run.ex[hintNext].label} · ${run.ex[hintNext].name}`
              : `Teraz ${run.ex[hintNext].label} · ${run.ex[hintNext].name} — ${rest ? 'po krótkiej przerwie' : 'bez przerwy'}`}
          </div>
        )}
      </>
    );
  };

  if (doneInfo)
    return (
      <div className="player">
        <WorkoutDone info={doneInfo} onDone={onSaved} />
      </div>
    );

  // podopieczny: „+ Dodaj ćwiczenie” na wierzchu tylko w treningu własnym; w treningu z planu — w menu „Więcej”
  const addInline = trainer || !run.planId;
  const cancelRun = async () => {
    const n = run.ex.reduce((a, e) => a + e.sets.filter((x) => x.done).length, 0);
    const msg = editing
      ? 'Anulować poprawki? Zapisany trening zostanie bez zmian.'
      : `Anulować ten trening? ${n ? `Zaliczone serie (${n}) i nagrania nie zostaną zapisane.` : 'Nic nie zostanie zapisane.'}`;
    if (await ask(msg, { confirm: editing ? 'Anuluj poprawki' : 'Anuluj trening', danger: true, cancel: editing ? 'Wróć do poprawek' : 'Wróć do treningu' })) onCancel?.();
  };

  return (
    <div className="player fade" onPointerDownCapture={primeRestAudio}>
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
          {trainer && run.ex.length > 0 && (
            <button className="btn btn-secondary btn-sm" onClick={() => setLayoutOpen(true)}>
              ✎ Układ
            </button>
          )}
          {tempoEx && (
            <button className="btn btn-ghost btn-sm" onClick={() => setTempoOpen(true)}>
              ◷ Tempo
            </button>
          )}
          <button className="btn btn-ghost btn-sm more-btn" aria-haspopup="dialog" aria-label="Więcej" onClick={() => setMoreOpen(true)}>
            <Icon name="more" size={20} /> Więcej
          </button>
        </span>
      </div>
      <header className="player-head">
        <h1>{run.name}</h1>
        <p className="muted small">
          {[editing ? `Poprawki treningu z ${fmtDay(run.date)}` : '', run.planName, run.weekName, `${doneSets}/${totalSets} serii`].filter(Boolean).join(' · ')}
        </p>
        {!trainer && doneSets === 0 && <p className="muted small rpe-legend">{run.ex.every((x) => x.cardio) ? 'Wpisz czas i dystans (tętno, jeśli masz), potem ✓. RPE (1–10) = jak ciężko było; możesz zostawić puste.' : run.ex.some((x) => x.cardio) ? 'Wpisz wynik (powtórzenia i kg albo czas i dystans), potem ✓. RPE (1–10) = jak ciężka była seria; możesz zostawić puste.' : 'Wpisz wynik, potem ✓. „ostatnio” pod serią wpisuje wynik z poprzedniego razu. RPE (1–10) = jak ciężka była seria; możesz zostawić puste.'}</p>}
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
            {trainer && block.some((k) => run.ex[k].sets.length > 1) && (
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
          onAdd={(name, sets, reps, load, linked, timed) => {
            const next = appendExercise(run, adHocExercise(name, sets, reps, load, '2:00', !!timed));
            setRun(linked ? toggleLink(next, next.ex.length - 1) : next);
            setAdding(false);
            window.scrollTo(0, 0);
          }}
          profile={client.run}
          dob={client.dob}
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
        addInline && (
          <button className="btn btn-ghost btn-block add-ex" onClick={() => setAdding(true)}>
            + Dodaj ćwiczenie
          </button>
        )
      )}

      {!last && blocks[bi + 1] && (
        <div className="acard nextup">
          <span className="muted small">Dalej</span> {blockName(blocks[bi + 1])}
        </div>
      )}
      {!last && (
        <button className="btn btn-ghost btn-block finish-early" onClick={() => void openFinish()}>
          {editing ? 'Zapisz zmiany' : 'Zakończ trening wcześniej'}
        </button>
      )}
      {onCancel && (
        // anulowanie: mały link z potwierdzeniem — nie konkuruje z „Zakończ”
        <button type="button" className="link small btn-danger-text cancel-run" onClick={() => void cancelRun()}>
          {editing ? 'Anuluj poprawki' : 'Anuluj trening'}
        </button>
      )}

      {/* przyklejone do dołu ekranu: poprzednie / następne ćwiczenie, na ostatnim — zakończenie */}
      <nav className="navrow pnav" aria-label="Ćwiczenia">
        <button className="btn btn-ghost pnav-prev" disabled={bi === 0} aria-label="Poprzednie ćwiczenie" onClick={() => go(bi - 1)}>
          ‹
        </button>
        {last ? (
          <button className="btn btn-primary btn-lg" onClick={() => void openFinish()}>
            {editing ? 'Zapisz zmiany' : 'Zakończ trening'}
          </button>
        ) : (
          <button className="btn btn-primary btn-lg" onClick={() => go(bi + 1)}>
            Następne ćwiczenie ›
          </button>
        )}
      </nav>

      {moreOpen && (
        <Sheet label="Więcej" onClose={() => setMoreOpen(false)}>
          <h2>Więcej</h2>
          <div className="more-list">
            {!addInline && !adding && (
              <button
                type="button"
                className="btn btn-secondary btn-block"
                onClick={() => {
                  setMoreOpen(false);
                  setAdding(true);
                  setTimeout(() => document.querySelector('.add-form')?.scrollIntoView({ behavior: smoothScroll() }), 50);
                }}
              >
                + Dodaj ćwiczenie
              </button>
            )}
            <button
              type="button"
              role="switch"
              aria-checked={sound}
              className={`more-switch ${sound ? 'on' : ''}`}
              onClick={() => {
                setRestSound(!sound);
                setSound(!sound);
              }}
            >
              <span>
                <b>Sygnał końca przerwy</b>
                <span className="muted small">Słychać go także przy zablokowanym ekranie. Może ściszyć muzykę na czas przerwy.</span>
              </span>
              <span className="more-switch-state">{sound ? 'wł.' : 'wył.'}</span>
            </button>
            {!trainer && <RefComment clientId={client.id} sessionId={run.editSessionId} label="Komentarz do treningu" />}
          </div>
          <button type="button" className="btn btn-ghost btn-block" onClick={() => setMoreOpen(false)}>
            Zamknij
          </button>
        </Sheet>
      )}
      {rest && !hold && <RestBar rest={rest} setRest={setRest} note={rest.note} />}
      {hold && (
        <RestBar
          rest={hold}
          setRest={(h) => setHold(h && { ...hold, ...h })}
          label={
            hold.side === 'switch'
              ? 'Zmiana strony'
              : `${hold.side === 'L' ? 'Lewa strona' : hold.side === 'P' ? 'Prawa strona' : 'Trzymaj'}${hold.what ? ` · ${hold.what}` : ''}`
          }
          endText="Koniec — zalicz serię ✓"
          onEnd={onHoldEnd}
        />
      )}
      {plates && <PlateCalc kg={plates.kg} title={plates.title} onClose={() => setPlates(null)} />}
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
            {(() => {
              const prs = sessionRecords(
                history(),
                run.ex.map((e) => ({ name: e.name, cardio: e.cardio, timed: e.timed, sets: e.sets.filter((x) => x.done).map((x) => ({ load: x.load, reps: x.reps, rpe: x.rpe, warmup: x.warmup, unit: x.unit })) })),
              );
              return prs.length ? (
                <div className="pr-summary">
                  <span className="eyebrow"><Icon name="trophy" size={14} /> Rekordy w tym treningu</span>
                  <ul>
                    {prs.map((p) => (
                      <li key={p.name}>
                        <span className="pr-name">{p.name}</span>
                        <span className="pr-val">
                          {p.hit.reps} × {fnum(p.hit.load)} kg
                        </span>
                        <span className="muted small">szac. max {Math.round(p.hit.e1)} kg</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null;
            })()}
            <div className="scale-h">
              <span>Jak ciężki był cały trening? (wymagane)</span>
              <span className="muted small">0 = odpoczynek · 10 = maksimum{!trainer && !editing && finish.srpe !== '' && srpeHint === finish.srpe ? ' · podpowiedź ze średniego RPE serii' : ''}</span>
            </div>
            <div className="scale scale-11 scale-fit">
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
            <div className="scale scale-11 scale-fit">
              {Array.from({ length: 11 }, (_, v) => String(v)).map((v) => (
                <button key={v} className={finish.pain === v ? 'active' : ''} onClick={() => setFinish({ ...finish, pain: v })}>
                  {v}
                </button>
              ))}
            </div>
            {Number(finish.pain) > 0 && (
              <div className="field pain-where">
                <span>Gdzie boli?</span>
                <PainMap spots={finish.painMap} onChange={(painMap) => setFinish({ ...finish, painMap })} />
              </div>
            )}
            <div className="field">
              <span>Z kim był trening?</span>
              <div className="seg" role="radiogroup" aria-label="Z kim był trening">
                {([true, false] as const).map((v) => (
                  <button key={String(v)} type="button" role="radio" aria-checked={finish.solo === v} className={finish.solo === v ? 'active' : ''} onClick={() => setFinish({ ...finish, solo: v, ...(trainer && !editing ? { charge: v ? 'brak' : defaultCharge(client, sessionsOf(db, client.id)) } : {}) })}>
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
            <button className="btn btn-primary btn-lg btn-block" onClick={save} disabled={saving} aria-busy={saving}>
              {saving ? 'Zapisywanie…' : editing ? 'Zapisz zmiany' : 'Zapisz trening'}
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
/** Czas serii do odliczania (s): pierwsza strona przy „30/20”, „1:30”, „2 min”. */
/**
 * Pole z wartością podpowiedzianą (ciężar, powtórzenia z planu): dotknięcie zaznacza całość,
 * więc wpisana liczba zastępuje podpowiedź zamiast się do niej dopisać (42,5 + „42” ≠ „42,542”).
 * Opóźnienie — iOS po fokusie sam ustawia kursor i kasowałby zaznaczenie.
 */
function selectAll(ev: React.FocusEvent<HTMLInputElement>) {
  const el = ev.currentTarget;
  window.setTimeout(() => {
    if (document.activeElement === el && el.value) el.setSelectionRange(0, el.value.length);
  }, 0);
}

function holdSec(s: RunSet): number {
  const side = sidesOf(s.reps)?.[0];
  if (side != null) return Math.round(side * (s.unit === 'min' ? 60 : 1));
  if (s.unit === 'min') return Math.round((repsN(s.reps) ?? 0) * 60);
  return secOf(s.reps) ?? 0;
}

/** Kompleks („2+1”: 2 zarzuty + 1 podrzut) — klawiatura z „+”, bo numeryczna na telefonie go nie ma. */
const complexEx = (e: RunExercise) => e.sets.some((x) => x.reps.includes('+')) || /clean|jerk|snatch|zarzut|podrzut|rwanie|kompleks/i.test(e.name);

/** Nagłówek kolumny ciężaru: przy hantlach widać, czy wpisuje się 1 hantel, czy sumę. */
const kgHead = (e: RunExercise) => (loadPerOf(e) === 'one' ? 'kg / 1 hantel' : loadPerOf(e) === 'sum' ? 'kg (suma)' : 'kg');

/** Ćwiczenie na czas na stronę bez ciężaru (deska boczna): pola L i P zajmują miejsce kolumny kg. */
const sidesWide = (e: RunExercise) => !!e.perSide && e.sets.some((x) => x.unit) && e.sets.every((x) => !x.load.trim() && !x.sug);

function repsHead(e: RunExercise): string {
  const u = e.sets.find((x) => !x.warmup)?.unit;
  const base = u === 's' ? 'sek.' : u === 'min' ? 'min' : 'powt.';
  return e.perSide ? (u ? `${base} L|P` : 'L | P') : base;
}

function RestBar({
  rest,
  setRest,
  label = 'Przerwa',
  endText = 'Koniec przerwy – następna seria!',
  note,
  onEnd,
}: {
  rest: { end: number; total: number };
  setRest: (r: { end: number; total: number; note?: string } | null) => void;
  label?: string;
  endText?: string;
  /** Dopisek, np. „dalej runda 2 z 3”. */
  note?: string;
  /** Zamiast domyślnego końca (sygnał + komunikat + zamknięcie) — np. zmiana strony. */
  onEnd?: () => void;
}) {
  const fired = useRef(0);
  const { toast } = useStore();
  const [, tick] = useState(0);
  const left = Math.max(0, Math.round((rest.end - Date.now()) / 1000));
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (left > 0 || fired.current === rest.end) return;
    fired.current = rest.end;
    if (onEnd) return onEnd();
    vibrate([200, 100, 200]);
    // sygnał z pliku przerwy już gra — bez drugiego piknięcia
    if (!restAudioPlaying()) beep(880, 0.25);
    toast(endText);
    setRest(null);
  }, [left, rest.end, setRest, toast, endText, onEnd]);
  return (
    <div className={`restbar ${label !== 'Przerwa' ? 'holdbar' : ''}`} role="timer" aria-label={label}>
      <div className="rb-fill" style={{ width: `${100 - (left / rest.total) * 100}%` }} />
      <span>
        {label}
        {note && <small className="rb-note"> · {note}</small>}
      </span>
      <b>{fmtSec(left)}</b>
      <button aria-label="Skróć przerwę o 15 sekund" onClick={() => setRest({ ...rest, note, end: Math.max(Date.now() + 1000, rest.end - 15000) })}>−15</button>
      <button aria-label="Wydłuż przerwę o 15 sekund" onClick={() => setRest({ ...rest, note, end: rest.end + 15000, total: rest.total + 15 })}>+15</button>
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
  profile,
  dob,
}: {
  profile?: RunProfile;
  dob?: string;
  onAdd: (name: string, sets: number, reps: string, load: string, linked: boolean, timed?: boolean) => void;
  onCardio: (name: string, bouts: number, minutes: string, km: string) => void;
  onTemplate: (e: PlanExercise) => void;
  onCancel?: () => void;
  canLink?: boolean;
}) {
  const { db, toast } = useStore();
  const [kind, setKind] = useState<'sila' | 'cardio' | 'bieg'>('sila');
  const [runName, setRunName] = useState('Bieg');
  const [runGroups, setRunGroups] = useState<SetGroup[]>(() => emptyRunExercise().groups);
  const tabs = (
    <div className="seg seg-sm" role="tablist" aria-label="Rodzaj ćwiczenia">
      {(
        [
          ['sila', 'Siłowe'],
          ['bieg', <><Icon name="run" size={15} /> Bieg</>],
          ['cardio', <><Icon name="heart" size={15} /> Cardio</>],
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
  const [timedOverride, setTimed] = useState<boolean | null>(null);
  // „na czas” — z nazwy (deska, wall sit…), chyba że zmienione ręcznie
  const timedMode = timedOverride ?? timedByName(name);
  const [load, setLoad] = useState('');
  const [linked, setLinked] = useState(false);
  const [bouts, setBouts] = useState('1');
  const [mins, setMins] = useState('20');
  const [km, setKm] = useState('');
  if (kind === 'bieg')
    return (
      <form
        className="acard add-form"
        onSubmit={(ev) => {
          ev.preventDefault();
          const gs = runGroups.filter((x) => x.reps.trim() || x.load.trim() || (x.pace ?? '').trim());
          if (!gs.length) return toast('Wpisz czas albo dystans przynajmniej jednego odcinka.');
          const bad = gs.find((x) => (x.reps.trim() && parseDur(x.reps) == null) || (x.load.trim() && parseKm(x.load) == null));
          if (bad) return toast(`Odcinek „${bad.reps || bad.load}”: czas jako 40 albo 3:05, dystans jako 5 albo 800 m.`);
          onTemplate({ id: uid(), name: runName.trim() || 'Bieg', cardio: true, rest: '', notes: '', groups: gs });
        }}
      >
        {tabs}
        <h3>Dodaj bieg</h3>
        <label className="field">
          <span>Nazwa</span>
          <input className="input" value={runName} onChange={(ev) => setRunName(ev.target.value)} placeholder="np. Rozbieganie, Interwały, Długi bieg" />
        </label>
        <RunTargetList />
        <RunBuilder groups={runGroups} onChange={setRunGroups} profile={profile} dob={dob} />
        <div className="actions">
          <button type="submit" className="btn btn-primary">
            Dodaj bieg
          </button>
          {onCancel && (
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              Anuluj
            </button>
          )}
        </div>
      </form>
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
          if (mins.trim() && parseDur(mins) == null) return toast('Czas: minuty (np. 20) albo minuty:sekundy (np. 1:30).');
          if (km.trim() && parseKm(km) == null) return toast('Dystans: km (np. 3,5) albo metry (np. 400 m).');
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
        if (timedMode && reps.trim() && !secOf(reps)) return toast('Czas: sekundy (np. 45), minuty:sekundy (1:30) albo „2 min”.');
        onAdd(name.trim(), n, reps.trim() || (timedMode ? '30' : '8'), load.replace(',', '.'), linked, timedMode);
      }}
    >
      {tabs}
      <h3>Dodaj ćwiczenie</h3>
      <div className="seg seg-sm" role="radiogroup" aria-label="Powtórzenia czy czas">
        {([false, true] as const).map((v) => (
          <button
            key={String(v)}
            type="button"
            role="radio"
            aria-checked={timedMode === v}
            className={timedMode === v ? 'active' : ''}
            onClick={() => {
              setTimed(v);
              if (v && reps === '8') setReps('30');
              if (!v && reps === '30') setReps('8');
            }}
          >
            {v ? <><Icon name="timer" size={15} /> Na czas</> : 'Powtórzenia'}
          </button>
        ))}
      </div>
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
          <span>{timedMode ? 'Czas (s)' : 'Powt.'}</span>
          <input className="input" value={reps} placeholder={timedMode ? 'np. 45 / 1:30' : undefined} onChange={(ev) => setReps(ev.target.value)} />
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
        <p className="muted small"><Icon name="link" size={14} /> łączy ćwiczenie z poprzednim w superserię / obwód — robi się je na zmianę, przerwa po całej rundzie.</p>
        <ul className="layout-list">
          {run.ex.map((e, k) => (
            <li key={k} className={`layout-row ${e.linked ? 'linked' : ''}`}>
              <span className="ex-label">{e.label}</span>
              <input className="input" value={e.name} onChange={(ev) => setRun(renameExercise(run, k, { name: ev.target.value }))} aria-label={`Nazwa ćwiczenia ${e.label}`} />
              <input className="input layout-rest" value={e.rest} placeholder="Przerwa" onChange={(ev) => setRun(renameExercise(run, k, { rest: ev.target.value }))} aria-label={`Przerwa ${e.label}`} />
              <span className="layout-actions">
                {k > 0 && (
                  <button className={`chain ${e.linked ? 'on' : ''}`} aria-pressed={!!e.linked} aria-label={e.linked ? `Rozłącz ${e.name} z poprzednim` : `Połącz ${e.name} z poprzednim w superserię`} title={e.linked ? 'Rozłącz z poprzednim' : 'Połącz z poprzednim (superseria / obwód)'} onClick={() => setRun(toggleLink(run, k))}>
                    <Icon name="link" size={16} />
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
