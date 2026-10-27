import { useMemo, useState } from 'react';
import { Field, Icon, IconBtn, Modal, Seg } from '../components/ui';
import { SetVideoButton } from '../components/SetVideo';
import { RefThread } from '../components/RefComment';
import type { Billing, SessionExercise, TrainingSession, Wellness } from '../domain';
import { chargeProblem, clientById, groupOf, isSolo, deleteSession, extraPlanOf, extraState, plansOf, saveSession, sessionPayment, sessionsOf } from '../data/ops';
import { useStore } from '../data/store';
import { deleteSetVideo, sessionVideos } from '../data/videos';
import { fnum, plural, pln, uid, nEx, nSets } from '../format';
import { defaultCharge, packageHint, packageStatus } from '../lib/billing';
import { todayISO } from '../lib/dates';
import { parseWorkoutNote } from '../lib/note';
import { cardioByName, isTimed, loadPerOf, perSideByName, buildRunExercise } from '../lib/run';
import { LoadPerToggle } from '../components/LoadPerToggle';
import { fmtClock, paceText, parseDur, parseKm } from '../lib/running';
import { num, numIn, repsN, secOf, sidesOf, timeUnit } from '../lib/parse';
import { currentPlan, exerciseLabels, exerciseSummary, moveInBlocks, nextWorkout, planSequence, removeFromBlocks } from '../lib/plan';
import { bestE1, resolveLoad } from '../lib/strength';
import { WELLNESS_ITEMS } from '../lib/wellness';
import { useNav, type ModalState } from '../nav';
import { ClientSelect } from './ModalHost';
import { ChargeSelect, LocationSelect } from '../components/location';
import { PainMap } from '../components/PainMap';
import { cleanPainMap, painSummary } from '../lib/painMap';
import type { PainSpot } from '../domain';
import { fillCardioRows, ImportActivity } from '../components/ImportActivity'; // funkcje: bieg

interface ExRow {
  key: string;
  name: string;
  sets: string;
  reps: string;
  load: string;
  rpe: string;
  rest: string;
  notes: string;
  /** Serie rozpisane pojedynczo (edycja każdej serii osobno). */
  series?: SetDraft[];
  hint?: string;
  /** W bloku z poprzednim ćwiczeniem (superseria / obwód). */
  linked?: boolean;
  /** Powtórzenia na każdą stronę. */
  perSide?: boolean;
  loadPer?: 'one' | 'sum';
  cardio?: boolean;
  /** Serie na czas (sekundy). */
  timed?: boolean;
}

/** Blok odczytany z oznaczenia: „B2”, „C3” → połączone z poprzednim. */
const linkedFromLabel = (label?: string) => {
  const m = label?.match(/^[A-Z]+(\d+)$/);
  return m && m[1] !== '1' ? true : undefined;
};

/** Usuwa puste wiersze (zachowując bloki) i nadaje oznaczenia A, B1, B2… */
function withBlockLabels(rows: ExRow[]): (ExRow & { label: string })[] {
  let list = rows;
  for (let i = list.length - 1; i >= 0; i--) if (!list[i].name.trim()) list = removeFromBlocks(list, i);
  const labels = exerciseLabels(list);
  return list.map((r, i) => ({ ...r, label: labels[i] }));
}

const s = (v: number | undefined | null) => (v == null ? '' : String(v));
/** Liczba zapisana z kropką („132.5”) → z przecinkiem („132,5”) do pola; inny tekst („70%”, „8–10”) bez zmian. */
const dec = (v: string | undefined) => (v ?? '').replace(/^(-?\d+)\.(\d+)$/, '$1,$2');
/** Seria w formularzu — tekst z pól (przecinek dziesiętny itp.), zamieniany na liczby przy zapisie. */
interface SetDraft {
  key: string;
  load: string;
  reps: string;
  rpe: string;
  warmup?: boolean;
  label?: string;
  /** Docelowe RPE z planu (podpowiedź w polu). */
  tRpe?: string;
  video?: string;
  /** Cardio / bieg: dystans (km) i tętno — tekst z pól. */
  dist?: string;
  hr?: string;
}
const fromLog = (log: NonNullable<SessionExercise['setsLog']>, cardio?: boolean): SetDraft[] =>
  log.map((x) => ({
    key: uid(),
    load: x.load != null ? fnum(x.load) : '',
    // bieg: czas jako m:ss, gdy są sekundy
    reps: x.reps != null ? cardio && x.unit === 'min' ? (Number.isInteger(x.reps) ? String(x.reps) : fmtClock(x.reps)) : `${x.reps}${x.repsR != null ? `/${x.repsR}` : ''}${x.unit ? ` ${x.unit}` : ''}` : '',
    rpe: x.rpe != null ? fnum(x.rpe) : '',
    warmup: x.warmup || undefined,
    label: x.label,
    video: x.video,
    dist: x.dist != null ? fnum(x.dist) : undefined,
    hr: x.hr != null ? String(x.hr) : undefined,
  }));
const toLog = (d: SetDraft[], cardio?: boolean, timed?: boolean): NonNullable<SessionExercise['setsLog']> =>
  d
    .filter((x) => x.load.trim() || x.reps.trim() || x.rpe.trim() || x.video || (x.dist ?? '').trim())
    .map((x) => {
      const out: NonNullable<SessionExercise['setsLog']>[number] = {};
      if (cardio) {
        // odcinek: czas (min albo m:ss), dystans, tętno, RPE
        const d = parseDur(x.reps);
        if (d != null) out.reps = Math.round(d * 100) / 100;
        out.unit = 'min';
        const km = parseKm(x.dist);
        if (km != null) out.dist = km;
        const hr = numIn(x.hr, 30, 240);
        if (hr != null) out.hr = hr;
        const rpe = numIn(x.rpe, 0, 10);
        if (rpe != null) out.rpe = rpe;
        if (x.warmup) out.warmup = true;
        if (x.label) out.label = x.label;
        if (x.video) out.video = x.video;
        return out;
      }
      const load = num(x.load);
      // „30 s”, „2 min” — seria na czas; „30/20” — lewa/prawa; ćwiczenie „na czas” — sekundy (też „1:30”)
      const unit = timed ? 's' : timeUnit(x.reps);
      const lr = sidesOf(x.reps);
      const reps = lr ? lr[0] : timed ? secOf(x.reps) : unit ? repsN(x.reps) : numIn(x.reps, 0, 10000);
      if (unit) out.unit = unit;
      if (lr && lr[1] !== lr[0]) out.repsR = lr[1];
      const rpe = numIn(x.rpe, 0, 10);
      if (load != null) out.load = load;
      if (reps != null) out.reps = reps;
      if (rpe != null) out.rpe = rpe;
      if (x.warmup) out.warmup = true;
      if (x.label) out.label = x.label;
      if (x.video) out.video = x.video;
      if (parseKm(x.dist) != null) out.dist = parseKm(x.dist)!;
      if (numIn(x.hr, 30, 240) != null) out.hr = numIn(x.hr, 30, 240)!;
      return out;
    });
/** Podsumowanie ćwiczenia z serii: liczba serii roboczych, powtórzenia i ciężar pierwszej z nich. */
function seriesSummary(d: SetDraft[], repsText: string) {
  const work = d.filter((x) => !x.warmup && (x.load.trim() || x.reps.trim()));
  const first = work[0];
  return { sets: String(work.length), reps: repsText.includes('+') ? repsText : (first?.reps ?? ''), load: first?.load ?? '' };
}
const blankSet = (prev?: SetDraft): SetDraft => ({ key: uid(), load: prev?.load ?? '', reps: prev?.reps ?? '', rpe: '' });
/** Starszy zapis „4 serie × 5 × 100” → cztery osobne serie. */
const splitSummary = (e: SessionExercise): SetDraft[] => {
  const reps = String(e.reps ?? '').includes('+') ? String(String(e.reps).split('+').reduce((a, x) => a + (parseInt(x, 10) || 0), 0)) : (e.reps ?? '');
  return Array.from({ length: Math.min(20, Math.max(1, repsN(e.sets) ?? 1)) }, () => ({ key: uid(), load: dec(e.load), reps, rpe: dec(e.rpe) }));
};
const toRow = (e: SessionExercise): ExRow => ({ key: uid(), name: e.name, sets: e.sets ?? '', reps: e.reps ?? '', load: dec(e.load), rpe: dec(e.rpe), rest: e.rest ?? '', notes: e.notes ?? '', series: e.setsLog?.length ? fromLog(e.setsLog, e.cardio) : splitSummary(e), linked: linkedFromLabel(e.label), perSide: e.perSide, loadPer: e.loadPer, cardio: e.cardio, timed: e.timed || e.setsLog?.some((x) => x.unit === 's') || undefined });
const emptyRow = (): ExRow => ({ key: uid(), name: '', sets: '3', reps: '', load: '', rpe: '', rest: '', notes: '', series: [blankSet(), blankSet(), blankSet()] });

function Scale({ value, onChange, max, min = 0, label }: { value: string; onChange: (v: string) => void; max: number; min?: number; label: string }) {
  return (
    <div className={`scale${max - min === 10 ? ' scale-11 scale-form' : ''}`} role="radiogroup" aria-label={label}>
      {Array.from({ length: max - min + 1 }, (_, i) => String(i + min)).map((v) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'active' : ''} onClick={() => onChange(value === v ? '' : v)}>
          {v}
        </button>
      ))}
    </div>
  );
}

export function SessionModal({ m }: { m: Extract<ModalState, { kind: 'session' }> }) {
  const { db, apply, ask, toast } = useStore();
  const { closeModal, startLive, openModal } = useNav();
  const existing = m.session;
  const [clientId, setClientId] = useState(existing?.clientId ?? m.clientId ?? m.appt?.clientId ?? '');
  const client = clientById(db, clientId);
  const history = useMemo(() => (clientId ? sessionsOf(db, clientId).filter((x) => x.id !== existing?.id) : []), [db, clientId, existing?.id]);
  const plan = currentPlan(plansOf(db, clientId));
  const extra = extraPlanOf(db, clientId);
  // Jednostki z planu i dodatkowe treningi (z informacją, z której listy pochodzą).
  const seq = [...(plan ? planSequence(plan).map((x) => ({ ...x, planId: plan.id })) : []), ...(extra ? planSequence(extra).map((x) => ({ ...x, planId: extra.id })) : [])];

  const [date, setDate] = useState(existing?.date ?? m.appt?.date ?? m.date ?? todayISO());
  const [workoutName, setWorkoutName] = useState(existing?.workoutName ?? '');
  const [planRef, setPlanRef] = useState<{ planId?: string; workoutId?: string }>({ planId: existing?.planId, workoutId: existing?.workoutId });
  const [rows, setRows] = useState<ExRow[]>(() => (existing ? existing.exercises.map(toRow) : []));
  const [paste, setPaste] = useState<string | null>(m.paste ? '' : null);
  /** Wczytuje ćwiczenia (seria po serii) z tekstu notatki trenera. */
  const loadNote = async () => {
    const r = parseWorkoutNote(paste ?? '');
    if (r.exercises.length === 0) return toast('Nie rozpoznano ćwiczeń. Format: nazwa ćwiczenia, pod nią serie, np. „4x100” albo „8x70kg RPE 8”.');
    const keep = rows.filter((x) => x.name.trim());
    if (keep.length && !(await ask(`Zastąpić wpisane ćwiczenia (${keep.length}) tymi z notatki?`, { confirm: 'Zastąp', danger: false }))) return;
    setRows(r.exercises.map(toRow));
    setPlanRef({}); // trening z notatki — nie jednostka z planu
    if (r.date && !existing) setDate(r.date);
    if (!workoutName.trim() || keep.length) setWorkoutName(r.exercises.slice(0, 2).map((e) => e.name.replace(/\s*\(.*\)$/, '')).join(' + '));
    setPaste(null);
    toast(`Wczytano ${nEx(r.exercises.length)} (${nSets(r.exercises.reduce((a, e) => a + (e.setsLog?.length ?? 0), 0))})${r.date ? `, data ${r.date.split('-').reverse().join('.')}` : ''}.${r.skipped.length ? ` Pominięto: ${r.skipped.join(', ')}.` : ''}`);
  };
  const [w, setW] = useState<Record<keyof Wellness, string>>({
    sleep: s(existing?.wellness?.sleep),
    energy: s(existing?.wellness?.energy),
    muscle: s(existing?.wellness?.muscle),
    stress: s(existing?.wellness?.stress),
    mood: s(existing?.wellness?.mood),
  });
  const [sleepH, setSleepH] = useState(s(existing?.sleepH));
  const [rhr, setRhr] = useState(s(existing?.rhr));
  const [duration, setDuration] = useState(s(existing?.duration ?? m.appt?.duration ?? (existing ? undefined : 60)));
  const [srpe, setSrpe] = useState(s(existing?.srpe));
  const [pain, setPain] = useState(s(existing?.pain));
  const [painMap, setPainMap] = useState<PainSpot[]>(() => existing?.painMap ?? []);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [charge, setCharge] = useState<Billing | ''>(existing?.charge ?? '');
  const [locationId, setLocationId] = useState(existing?.locationId ?? m.appt?.locationId ?? clientById(db, existing?.clientId ?? m.clientId ?? m.appt?.clientId)?.locationId ?? '');
  const [amount, setAmount] = useState('');
  // poprawka treningu bez płatności: domyślnie „do zapłaty” (zwykle dopisujemy zaległą)
  const [paidNow, setPaidNow] = useState(!existing);
  // trener zapisuje zwykle trening, który prowadził; stary zapis — jak w historii
  const [solo, setSolo] = useState(existing ? isSolo(db, existing) : false);
  // trening w parze: osoby z tej samej wizyty (bez zapisanego treningu) albo dopisane ręcznie
  const apptPartners = m.appt ? groupOf(db.appointments, m.appt).filter((a) => a.id !== m.appt!.id && !a.sessionId && a.status !== 'cancel' && a.status !== 'noshow') : [];
  const [withIds, setWithIds] = useState<string[]>(() => existing?.withIds ?? apptPartners.map((a) => a.clientId));
  const [copyToPartners, setCopyToPartners] = useState(!existing);
  const [addingWith, setAddingWith] = useState(false);
  // ćwiczenia z rozwiniętym wyborem typu (cardio / na czas / na stronę)
  const [optsOpen, setOptsOpen] = useState<Set<string>>(new Set());

  const effCharge: Billing = charge || (client ? defaultCharge(client, history) : 'brak');

  /** Wczytuje jednostkę z planu: ćwiczenia z podsumowaniem serii i podpowiedzią ciężaru z historii. */
  const loadWorkout = (workoutId: string) => {
    const step = seq.find((x) => x.workout.id === workoutId);
    if (!step) return;
    setPlanRef({ planId: step.planId, workoutId });
    setWorkoutName(step.workout.name);
    setRows(
      step.workout.exercises.map((e) => {
        const sum = exerciseSummary(e.groups);
        const top = e.groups.find((g) => g.type !== 'Rozgrzewka');
        const sug = top ? resolveLoad(top.load, bestE1(history, e.name), top.reps, top.rpe, null) : { load: null, why: '' };
        return {
          key: uid(),
          name: e.name,
          sets: sum.sets,
          reps: sum.reps,
          load: dec(sum.load) || (sug.load != null ? fnum(sug.load, 2) : ''),
          rpe: dec(sum.rpe),
          rest: e.rest ?? '',
          notes: e.notes ?? '',
          hint: sug.why || undefined,
          linked: e.linked,
          perSide: e.perSide ?? (perSideByName(e.name) || undefined),
          loadPer: e.loadPer,
          cardio: e.cardio ?? (cardioByName(e.name) || undefined),
          timed: isTimed(e) || undefined,
          // każda seria z planu osobno — ciężary jak w treningu na żywo (%, ±% od poprzedniej, z RPE), cel RPE w podpowiedzi
          series: buildRunExercise(e, history, undefined, client?.tests ?? []).sets.map((x) => ({
            key: uid(),
            load: dec(x.load),
            reps: x.reps,
            rpe: '',
            tRpe: x.tRpe || undefined,
            warmup: x.warmup || undefined,
            label: x.label && x.label !== 'Robocze' ? x.label : undefined,
            dist: x.dist || undefined,
          })),
        };
      }),
    );
  };

  // Nowy trening: od razu podpowiedz następną jednostkę z planu.
  const [autoLoaded, setAutoLoaded] = useState(!!existing || !!m.paste); // przy wklejaniu z notatki nie wczytujemy jednostki z planu
  if (!autoLoaded && client) {
    setAutoLoaded(true);
    // trening zadany na ten dzień (poza planem) ma pierwszeństwo przed następnym z planu
    const due = extra?.weeks.flatMap((w) => w.workouts).find((k) => k.date === date && k.exercises.some((e) => e.name) && extraState(k, extra.id, history, date).state !== 'done');
    const nx = nextWorkout(plan, history);
    if (due) loadWorkout(due.id);
    else if (nx) loadWorkout(nx.workout.id);
    const rate = withIds.length && client.pairRate ? client.pairRate : client.singleRate;
    if (rate) setAmount(String(rate));
  }

  const setRow = (i: number, patch: Partial<ExRow>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const setSeries = (i: number, f: (d: SetDraft[]) => SetDraft[]) => setRows((r) => r.map((x, j) => (j === i ? { ...x, series: f(x.series ?? []) } : x)));
  /** Rozpisuje podsumowanie („4 × 5 × 100”) na osobne serie do edycji. */
  const splitRow = (i: number) => {
    const r = rows[i];
    const n = Math.min(20, Math.max(1, repsN(r.sets) ?? 1));
    setRow(i, { series: Array.from({ length: n }, () => ({ key: uid(), load: r.load, reps: r.reps.includes('+') ? String(r.reps.split('+').reduce((a, x) => a + (parseInt(x, 10) || 0), 0)) : r.reps, rpe: r.rpe })) });
  };
  const moveUp = (i: number) => i > 0 && setRows((r) => moveInBlocks(r, i, -1));

  const au = num(srpe) != null && num(duration) != null ? num(srpe)! * num(duration)! : null;

  const save = async () => {
    if (!client) return toast('Wybierz podopiecznego.');
    if (!date) return toast('Podaj datę treningu.');
    if (duration.trim() && numIn(duration, 1, 600) == null) return toast('Czas trwania: od 1 do 600 minut.');
    const problem = chargeProblem(db, effCharge, locationId);
    if (num(srpe) == null && rows.some((r) => r.name.trim()) && !(await ask('Nie zaznaczono, jak ciężki był trening (sRPE) — nie wliczy się do obciążenia (ACWR). Zapisać mimo to?', { confirm: 'Zapisz bez sRPE', danger: false })))
      return;
    if (problem) return toast(problem);
    const wellness: Wellness = {};
    for (const [k] of WELLNESS_ITEMS) {
      const v = num(w[k]);
      if (v != null) wellness[k] = v;
    }
    const session: TrainingSession = {
      id: existing?.id ?? uid(),
      clientId: client.id,
      date,
      workoutName: workoutName.trim() || undefined,
      charge: effCharge,
      duration: numIn(duration, 1, 600) ?? undefined,
      srpe: num(srpe) ?? undefined,
      pain: num(pain) ?? (cleanPainMap(painMap).length ? Math.max(...cleanPainMap(painMap).map((x) => x.level)) : undefined),
      painMap: cleanPainMap(painMap).length ? cleanPainMap(painMap) : undefined,
      notes: notes.trim() || undefined,
      wellness: Object.keys(wellness).length ? wellness : undefined,
      sleepH: num(sleepH) ?? undefined,
      rhr: num(rhr) ?? undefined,
      locationId: locationId || undefined,
      planId: planRef.planId,
      workoutId: planRef.workoutId,
      solo,
      withIds: !solo && withIds.length ? withIds : undefined,
      exercises: withBlockLabels(rows).map((r) => ({
        name: r.name.trim(),
        label: r.label,
        ...(r.series ? { ...seriesSummary(r.series, r.reps), rpe: '' } : { sets: r.sets, reps: r.reps, load: r.load, rpe: r.rpe }),
        rest: r.rest || undefined,
        notes: r.notes || undefined,
        setsLog: r.series ? toLog(r.series, r.cardio, r.timed) : undefined,
        timed: r.timed || undefined,
        perSide: r.perSide || undefined,
        loadPer: r.cardio ? undefined : loadPerOf(r),
        cardio: r.cardio || undefined,
      })),
    };
    const { changes, message } = saveSession(db, { session, isNew: !existing, appointmentId: solo ? undefined : m.appt?.id, amount: num(amount) ?? undefined, paidNow });
    // ten sam trening dla partnerów z pary: ich rozliczenie domyślne, ich wizyta z tego terminu
    const copies = !existing && !solo && copyToPartners
      ? withIds.flatMap((pid) => {
          const pc = clientById(db, pid);
          if (!pc) return [];
          const pAppt = apptPartners.find((a) => a.clientId === pid);
          const ps: TrainingSession = { ...session, id: uid(), clientId: pid, charge: defaultCharge(pc, sessionsOf(db, pid)), withIds: [client.id, ...withIds.filter((x) => x !== pid)], paymentId: undefined, wellness: undefined, sleepH: undefined, rhr: undefined, planId: undefined, workoutId: undefined, locationId: locationId || pc.locationId };
          const rate = pc.pairRate ?? pc.singleRate;
          return saveSession(db, { session: ps, isNew: true, appointmentId: pAppt?.id, matchAppointment: !!pAppt, amount: rate, paidNow: false }).changes;
        })
      : [];
    if (!(await apply([...changes, ...copies], copies.length ? `${message} Zapisano też dla: ${withIds.map((id) => clientById(db, id)?.name.split(' ')[0]).join(', ')}.` : message))) return; // formularz zostaje otwarty — można ponowić
    closeModal();
  };

  const remove = async () => {
    if (!existing) return;
    const vids = sessionVideos(existing);
    const linked = db.appointments.some((a) => a.sessionId === existing.id);
    if (!(await ask(`Usunąć ten trening?${linked ? ' Powiązana wizyta wróci do „zaplanowanej”.' : ''}${vids.length ? ` Usunięte zostaną też nagrania (${vids.length}).` : ''}`, { confirm: 'Usuń trening', danger: true }))) return;
    const sp = sessionPayment(db, existing);
    const removePayment =
      !!sp &&
      (await ask(
        `Za ten trening jest płatność ${pln(sp.payment.amount)} (${sp.payment.status === 'paid' ? 'opłacona' : 'do zapłaty'}). Usunąć ją też?`,
        { confirm: 'Usuń płatność' },
      ));
    if (!(await apply(deleteSession(db, existing.id, removePayment), removePayment ? 'Trening i płatność usunięte.' : 'Trening usunięty.'))) return;
    vids.forEach((v) => void deleteSetVideo(v.video));
    closeModal();
  };

  return (
    <Modal
      wide
      title={existing ? 'Trening' : 'Zapisz trening'}
      onClose={closeModal}
      onSubmit={save}
      extraActions={
        existing && (
          <>
            <button type="button" className="btn btn-ghost btn-danger-text" onClick={remove}>
              Usuń trening
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => startLive(existing.clientId, undefined, existing.id)}>
              Popraw seria po serii
            </button>
            {existing.exercises.length > 0 && (
              <button type="button" className="btn btn-secondary" onClick={() => openModal({ kind: 'assign', clientId: existing.clientId, sessionId: existing.id })}>
                ↻ Powtórz / kopiuj
              </button>
            )}
          </>
        )
      }
    >
      <div className="form-grid form-grid-3">
        <Field label="Podopieczny">
          {existing || m.appt ? <input className="input" value={client?.name ?? ''} disabled /> : <ClientSelect value={clientId} onChange={(id) => { setClientId(id); setAutoLoaded(false); setRows([]); setLocationId(clientById(db, id)?.locationId ?? ''); }} />}
        </Field>
        <Field label="Data">
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Jednostka z planu">
          <select className="input" value={planRef.workoutId ?? ''} onChange={(e) => (e.target.value ? loadWorkout(e.target.value) : setPlanRef({}))} disabled={!seq.length}>
            <option value="">{seq.length ? '— bez planu —' : 'brak planu'}</option>
            {seq.map((x) => (
              <option key={x.workout.id} value={x.workout.id}>
                {x.week.name} · {x.workout.name}
              </option>
            ))}
          </select>
        </Field>
        {!solo && (
          <div className="field field-wide">
            <span>W parze / grupie z</span>
            <div className="pair-chips">
              {withIds.map((id) => (
                <span key={id} className="pair-chip">
                  <Icon name="users" size={14} /> {clientById(db, id)?.name ?? '—'}
                  <button type="button" className="icon-btn icon-btn-sm" aria-label={`Usuń ${clientById(db, id)?.name ?? ''}`} onClick={() => setWithIds(withIds.filter((x) => x !== id))}>
                    ×
                  </button>
                </span>
              ))}
              {addingWith ? (
                <ClientSelect
                  value=""
                  required={false}
                  onChange={(id) => {
                    if (id && id !== clientId && !withIds.includes(id)) setWithIds([...withIds, id]);
                    setAddingWith(false);
                  }}
                />
              ) : (
                withIds.length < 3 && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddingWith(true)} disabled={!clientId}>
                    + {withIds.length ? 'kolejna osoba' : 'trening w parze'}
                  </button>
                )
              )}
            </div>
            {!existing && withIds.length > 0 && (
              <label className="check">
                <input type="checkbox" checked={copyToPartners} onChange={(e) => setCopyToPartners(e.target.checked)} /> Zapisz ten sam trening też dla: {withIds.map((id) => clientById(db, id)?.name.split(' ')[0]).join(', ')} (ich rozliczenie, popraw potem ciężary)
              </label>
            )}
          </div>
        )}
        <Field label="Z kim">
          <Seg
            options={['Z trenerem', 'Samodzielnie'] as const}
            value={solo ? 'Samodzielnie' : 'Z trenerem'}
            onChange={(v) => {
              setSolo(v === 'Samodzielnie');
              // samodzielny — bez rozliczenia (pakiet / sesja) i bez łączenia z wizytą; zmienisz niżej, jeśli trzeba
              if (!existing) setCharge(v === 'Samodzielnie' ? 'brak' : '');
            }}
            label="Z kim był trening"
          />
        </Field>
        <Field label="Nazwa treningu" wide>
          <input className="input" value={workoutName} onChange={(e) => setWorkoutName(e.target.value)} placeholder="np. A – dół ciała" />
        </Field>
      </div>


      <div className="between form-section">
        <h4>Ćwiczenia</h4>
        {paste === null && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPaste('')}>
            <Icon name="clipboard" size={16} /> Wklej z notatki
          </button>
        )}
      </div>
      {/* funkcje: bieg — import z zegarka (GPX/TCX/FIT): wstawia odcinki cardio (czas, km, tętno) */}
      <ImportActivity small onImport={(ex, act) => { setRows((rs) => fillCardioRows(rs, toRow(ex))); if (!workoutName.trim()) setWorkoutName(ex.name); setDuration(String(Math.round(act.elapsedMin || act.movingMin))); if (!existing && act.date) setDate(act.date); }} />
      {paste !== null && (
        <div className="paste-box">
          <textarea
            className="input"
            rows={8}
            autoFocus
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={'Wklej trening z notatek, np.\n\n13.10.2026\nFront Squat\n4x100\n4x105\n8x90\n\nWiosłowanie sztangą\n8x70kg RPE 8'}
            aria-label="Tekst treningu z notatki"
          />
          <div className="actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPaste(null)}>
              Anuluj
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={!paste.trim()} onClick={() => void loadNote()}>
              Wczytaj ćwiczenia
            </button>
          </div>
        </div>
      )}
      <div className="ex-table">
        <div className="ex-head">
          <span>Ćwiczenie</span>
          <span>Serie</span>
          <span>Powt.</span>
          <span>kg</span>
          <span>RPE</span>
          <span>Przerwa</span>
          <span />
        </div>
        {rows.map((r, i) => (
          <div key={r.key} className="ex-row">
            <input className="input" list="lib-exercises" value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} placeholder="Ćwiczenie" aria-label="Ćwiczenie" />
            {(() => {
              // Przy seriach rozpisanych podsumowanie liczy się samo — edytujesz serie poniżej.
              const sum = r.series ? seriesSummary(r.series, r.reps) : null;
              return (
                sum ? (
                  // podsumowanie z serii poniżej — tekst z jednostkami zamiast pól tylko do odczytu (4 elementy: układ siatki bez zmian)
                  <>
                    <span className="ex-derived" title="Serie robocze (liczone z serii poniżej)">{sum.sets} {plural(Number(sum.sets) || 0, 'seria', 'serie', 'serii')}</span>
                    <span className="ex-derived" title="Powtórzenia pierwszej serii roboczej">{sum.reps ? `${sum.reps} ${r.timed || r.cardio ? '' : 'powt.'}` : '—'}</span>
                    <span className="ex-derived" title="Ciężar pierwszej serii roboczej">{sum.load ? `${dec(sum.load)} ${r.cardio ? 'km' : 'kg'}` : '—'}</span>
                    <span className="ex-derived" aria-hidden="true" />
                  </>
                ) : (
                <>
                  <input className="input" value={r.sets} onChange={(e) => setRow(i, { sets: e.target.value })} aria-label="Serie" placeholder="serie" />
                  <input className="input" value={r.reps} onChange={(e) => setRow(i, { reps: e.target.value })} aria-label="Powtórzenia" placeholder="powt." />
                  <input className="input" inputMode="decimal" value={r.load} onChange={(e) => setRow(i, { load: e.target.value })} aria-label="Ciężar" placeholder="kg" />
                  <input className="input" inputMode="decimal" value={r.rpe} onChange={(e) => setRow(i, { rpe: e.target.value })} aria-label="RPE" placeholder="RPE" />
                </>
                )
              );
            })()}
            <input className="input" value={r.rest} onChange={(e) => setRow(i, { rest: e.target.value })} aria-label="Przerwa" placeholder="przerwa" />
            <span className="ex-actions">
              <IconBtn icon="up" label="Przesuń w górę" onClick={() => moveUp(i)} />
              <IconBtn icon="trash" label="Usuń ćwiczenie" danger onClick={() => setRows(removeFromBlocks(rows, i))} />
            </span>
            <input className="input ex-notes" value={r.notes} onChange={(e) => setRow(i, { notes: e.target.value })} placeholder="Uwagi (np. tempo 3-1-X-0)" aria-label="Uwagi" />
            {r.hint && !r.series && <span className="ex-hint">Podpowiedź: {r.hint}</span>}
            {!optsOpen.has(r.key) && (
              <button type="button" className="link small ex-opts-btn" onClick={() => setOptsOpen((o) => new Set([...o, r.key]))}>
                <Icon name="settings" size={14} /> Typ ćwiczenia
              </button>
            )}
            {!r.cardio && (optsOpen.has(r.key) || r.timed) && (
              <button type="button" className={`side-toggle ${r.timed ? 'on' : ''}`} aria-pressed={!!r.timed} onClick={() => setRow(i, { timed: !r.timed || undefined })}>
                <Icon name="timer" size={14} /> {r.timed ? 'Na czas — sekundy w miejscu powtórzeń' : 'Na czas?'}
              </button>
            )}
            {!r.cardio && (optsOpen.has(r.key) || r.perSide) && (
              <button type="button" className={`side-toggle ${r.perSide ? 'on' : ''}`} aria-pressed={!!r.perSide} onClick={() => setRow(i, { perSide: !r.perSide || undefined })}>
                ↔ {r.perSide ? 'Na każdą stronę' : 'Na stronę?'}
              </button>
            )}
            {!r.cardio && !r.timed && (optsOpen.has(r.key) || !!loadPerOf(r)) && <LoadPerToggle value={loadPerOf(r)} onChange={(v) => setRow(i, { loadPer: v })} />}
            {(optsOpen.has(r.key) || r.cardio) && <button
              type="button"
              className={`side-toggle ${r.cardio ? 'on' : ''}`}
              aria-pressed={!!r.cardio}
              onClick={async () => {
                // serie siłowe i odcinki cardio mają inne pola — przy zmianie zaczynamy od pustej serii
                const filled = (r.series ?? []).some((x) => x.reps.trim() || x.load.trim() || (x.dist ?? '').trim());
                if (filled && !(await ask(`Zmienić „${r.name || 'ćwiczenie'}” na ${r.cardio ? 'siłowe' : 'cardio / bieg'}? Wpisane serie zostaną wyczyszczone.`, { confirm: 'Zmień' }))) return;
                setRow(i, { cardio: !r.cardio || undefined, perSide: undefined, series: [{ key: uid(), load: '', reps: '', rpe: '' }] });
              }}
            >
              <Icon name="heart" size={14} /> {r.cardio ? 'Cardio / bieg — czas, km, tętno' : 'Cardio / bieg?'}
            </button>}
            {r.series ? (
              <div className="set-edit">
                <div className={`set-edit-head ${r.cardio ? 'cardio' : ''}`}>
                  <span>#</span>
                  <span>{r.cardio || r.timed ? 'czas' : 'powt.'}</span>
                  <span>{r.cardio ? 'km' : 'kg'}</span>
                  {r.cardio && <span>tętno</span>}
                  <span>RPE</span>
                  <span />
                  <span />
                </div>
                {r.series.map((x, k) => {
                  const upd = (patch: Partial<SetDraft>) => setSeries(i, (d) => d.map((y, m) => (m === k ? { ...y, ...patch } : y)));
                  const workNo = r.series!.slice(0, k + 1).filter((y) => !y.warmup).length;
                  return (
                    r.cardio ? (
                      <div key={x.key} className={`set-edit-row cardio ${x.warmup ? 'warm' : ''}`}>
                        <button type="button" className="set-no" aria-pressed={!!x.warmup} aria-label={x.warmup ? `Odcinek ${k + 1}: rozgrzewka` : `Odcinek ${k + 1}`} onClick={() => upd({ warmup: !x.warmup || undefined })}>
                          {x.warmup ? 'R' : x.label === 'Schłodzenie' ? 'S' : x.label === 'Przerwa' ? 'P' : r.series!.slice(0, k + 1).filter((y) => !y.warmup && y.label !== 'Schłodzenie' && y.label !== 'Przerwa').length}
                        </button>
                        <input className="input" value={x.reps} onChange={(e) => upd({ reps: e.target.value })} aria-label={`Czas, odcinek ${k + 1}`} placeholder="min / m:ss" />
                        <input className="input" inputMode="decimal" value={x.dist ?? ''} onChange={(e) => upd({ dist: e.target.value })} aria-label={`Dystans (km), odcinek ${k + 1}`} placeholder="km" />
                        <input className="input" inputMode="numeric" value={x.hr ?? ''} onChange={(e) => upd({ hr: e.target.value })} aria-label={`Tętno, odcinek ${k + 1}`} placeholder="tętno" />
                        <input className="input" inputMode="decimal" value={x.rpe} onChange={(e) => upd({ rpe: e.target.value })} aria-label={`RPE, odcinek ${k + 1}`} placeholder="RPE" />
                        <span className="muted small">{paceText(parseDur(x.reps), parseKm(x.dist))}</span>
                        <IconBtn icon="trash" label={`Usuń odcinek ${k + 1}`} danger onClick={() => setSeries(i, (d) => d.filter((_, m) => m !== k))} />
                      </div>
                    ) :
                    <div key={x.key} className={`set-edit-row ${x.warmup ? 'warm' : ''}`}>
                      <button type="button" className="set-no" aria-pressed={!!x.warmup} aria-label={x.warmup ? `Seria ${k + 1}: rozgrzewka` : `Seria ${k + 1}: robocza`} title={x.warmup ? 'Rozgrzewka — kliknij, by zmienić na roboczą' : 'Seria robocza — kliknij, by oznaczyć jako rozgrzewkę'} onClick={() => upd({ warmup: !x.warmup || undefined })}>
                        {x.warmup ? 'R' : workNo}
                      </button>
                      <input className="input" inputMode={r.timed ? 'text' : 'numeric'} value={x.reps} onChange={(e) => upd({ reps: e.target.value })} aria-label={`${r.timed ? 'Czas' : 'Powtórzenia'}, seria ${k + 1}`} placeholder={r.timed ? 's' : 'powt.'} />
                      <input className="input" inputMode="decimal" value={x.load} onChange={(e) => upd({ load: e.target.value })} aria-label={`Ciężar, seria ${k + 1}`} placeholder="kg" />
                      <input className="input" inputMode="decimal" value={x.rpe} onChange={(e) => upd({ rpe: e.target.value })} aria-label={`RPE, seria ${k + 1}`} placeholder={x.tRpe ? `cel ${x.tRpe}` : 'RPE'} />
                      {clientId ? <SetVideoButton clientId={clientId} video={x.video} title={`${r.name || 'Ćwiczenie'} · seria ${k + 1}`} onChange={(video) => upd({ video })} /> : <span />}
                      <IconBtn icon="trash" label={`Usuń serię ${k + 1}`} danger onClick={() => setSeries(i, (d) => d.filter((_, m) => m !== k))} />
                    </div>
                  );
                })}
                <div className="between">
                  <button type="button" className="link small set-add" onClick={() => setSeries(i, (d) => [...d, blankSet(d[d.length - 1])])}>
                    + seria
                  </button>
                  <span className="muted small set-add-hint">dotknij numeru serii, by oznaczyć rozgrzewkę</span>
                </div>
              </div>
            ) : (
              <button type="button" className="link small ex-split" onClick={() => splitRow(i)}>
                Rozpisz na serie (każda osobno)
              </button>
            )}
          </div>
        ))}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows([...rows, emptyRow()])}>
          + Ćwiczenie
        </button>
      </div>

      <details className="form-section wellness-details" open={Object.values(w).some(Boolean) || !!sleepH || !!rhr}>
        <summary>Samopoczucie przed treningiem (opcjonalnie)</summary>
      <div className="wellness-grid">
        {WELLNESS_ITEMS.map(([k, label]) => (
          <div key={k} className="field">
            <span>{label} (1–5)</span>
            <Scale label={label} value={w[k]} onChange={(v) => setW({ ...w, [k]: v })} min={1} max={5} />
          </div>
        ))}
        <Field label="Sen (h)">
          <input className="input" inputMode="decimal" value={sleepH} onChange={(e) => setSleepH(e.target.value)} />
        </Field>
        <Field label="Tętno spocz.">
          <input className="input" inputMode="numeric" value={rhr} onChange={(e) => setRhr(e.target.value)} />
        </Field>
      </div>
      </details>

      <h4 className="form-section">Po treningu</h4>
      <div className="form-grid form-grid-3">
        <Field label="Czas trwania (min)">
          <input className="input" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} />
        </Field>
        <div className="field field-wide-2">
          <span>sRPE – ciężkość treningu (0–10){au != null && <strong className="text-accent"> · {fnum(au, 0)} AU</strong>}</span>
          <Scale label="sRPE" value={srpe} onChange={setSrpe} max={10} />
        </div>
        <div className="field field-wide">
          <span>Ból (0–10)</span>
          <Scale label="Ból" value={pain} onChange={setPain} max={10} />
        </div>
        <details className="field field-wide pain-edit" open={painMap.length > 0}>
          <summary>
            Gdzie boli (mapa ciała){painMap.length > 0 && <span className="muted small"> · {painSummary(painMap)}</span>}
          </summary>
          <PainMap
            spots={painMap}
            onChange={(sp) => {
              setPainMap(sp);
              // ogólny ból nie niższy niż najmocniejsze zaznaczone miejsce
              const top = Math.max(0, ...sp.map((x) => x.level));
              if (top > (num(pain) ?? 0)) setPain(String(top));
            }}
          />
        </details>
        <Field label="Notatki" wide>
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {existing && <RefThread clientId={existing.clientId} sessionId={existing.id} />}
      </div>

      <h4 className="form-section">Rozliczenie</h4>
      <div className="form-grid form-grid-3">
        <Field label="Rozliczenie treningu">
          <ChargeSelect value={effCharge} onChange={setCharge} />
        </Field>
        <Field label="Miejsce">
          <LocationSelect value={locationId} onChange={setLocationId} />
        </Field>
        {effCharge === 'klub' && (
          <p className="muted small self-end">
            {(() => {
              const l = db.locations.find((x) => x.id === locationId);
              return l?.kind === 'klub' ? `${l.name} wypłaci ${l.clubRate ?? 0} zł za ten trening.` : 'Wybierz klub, który rozlicza ten trening.';
            })()}
          </p>
        )}
        {effCharge === 'pakiet' && (
          <p className="muted small field-wide-2 self-end">
            {packageHint(client ? packageStatus(client, sessionsOf(db, clientId))?.left ?? null : null, existing?.charge !== 'pakiet')}
          </p>
        )}
        {effCharge === 'pojedyncza' && existing && sessionPayment(db, existing) && (
          <p className="muted small field-wide-2 self-end">
            {(() => { const sp = sessionPayment(db, existing)!; return `Płatność ${sp.payment.amount} zł — ${sp.payment.status === 'paid' ? 'opłacona' : 'do zapłaty'} (zmienisz ją w zakładce Płatności).`; })()}
          </p>
        )}
        {effCharge === 'pojedyncza' && (!existing || !sessionPayment(db, existing)) && (
          <>
            <Field label="Kwota (zł)">
              <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <div className="field check-row self-end">
              <label className="check">
                <input type="checkbox" checked={paidNow} onChange={(e) => setPaidNow(e.target.checked)} /> zapłacone od razu
              </label>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
