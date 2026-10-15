import { useMemo, useState } from 'react';
import { Field, IconBtn, Modal } from '../components/ui';
import { SetVideoButton } from '../components/SetVideo';
import type { Billing, SessionExercise, TrainingSession, Wellness } from '../domain';
import { chargeProblem, clientById, deleteSession, extraPlanOf, plansOf, saveSession, sessionPayment, sessionsOf } from '../data/ops';
import { useStore } from '../data/store';
import { fnum, pln, uid, nEx } from '../format';
import { defaultCharge, packageHint, packageStatus } from '../lib/billing';
import { todayISO } from '../lib/dates';
import { parseWorkoutNote } from '../lib/note';
import { buildRunExercise } from '../lib/run';
import { num, numIn, repsN } from '../lib/parse';
import { currentPlan, exerciseLabels, exerciseSummary, moveInBlocks, nextWorkout, planSequence, removeFromBlocks } from '../lib/plan';
import { bestE1, resolveLoad } from '../lib/strength';
import { WELLNESS_ITEMS } from '../lib/wellness';
import { useNav, type ModalState } from '../nav';
import { ClientSelect } from './ModalHost';
import { ChargeSelect, LocationSelect } from '../components/location';

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
}
const fromLog = (log: NonNullable<SessionExercise['setsLog']>): SetDraft[] =>
  log.map((x) => ({ key: uid(), load: x.load != null ? fnum(x.load) : '', reps: x.reps != null ? String(x.reps) : '', rpe: x.rpe != null ? fnum(x.rpe) : '', warmup: x.warmup || undefined, label: x.label, video: x.video }));
const toLog = (d: SetDraft[]): NonNullable<SessionExercise['setsLog']> =>
  d
    .filter((x) => x.load.trim() || x.reps.trim() || x.rpe.trim() || x.video)
    .map((x) => {
      const out: NonNullable<SessionExercise['setsLog']>[number] = {};
      const load = num(x.load);
      const reps = numIn(x.reps, 0, 10000);
      const rpe = numIn(x.rpe, 0, 10);
      if (load != null) out.load = load;
      if (reps != null) out.reps = reps;
      if (rpe != null) out.rpe = rpe;
      if (x.warmup) out.warmup = true;
      if (x.label) out.label = x.label;
      if (x.video) out.video = x.video;
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
  return Array.from({ length: Math.min(20, Math.max(1, repsN(e.sets) ?? 1)) }, () => ({ key: uid(), load: e.load ?? '', reps, rpe: e.rpe ?? '' }));
};
const toRow = (e: SessionExercise): ExRow => ({ key: uid(), name: e.name, sets: e.sets ?? '', reps: e.reps ?? '', load: e.load ?? '', rpe: e.rpe ?? '', rest: e.rest ?? '', notes: e.notes ?? '', series: e.setsLog?.length ? fromLog(e.setsLog) : splitSummary(e), linked: linkedFromLabel(e.label) });
const emptyRow = (): ExRow => ({ key: uid(), name: '', sets: '3', reps: '', load: '', rpe: '', rest: '', notes: '', series: [blankSet(), blankSet(), blankSet()] });

function Scale({ value, onChange, max, min = 0, label }: { value: string; onChange: (v: string) => void; max: number; min?: number; label: string }) {
  return (
    <div className="scale" role="radiogroup" aria-label={label}>
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
  const { closeModal, startLive } = useNav();
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
    toast(`Wczytano ${nEx(r.exercises.length)} (${r.exercises.reduce((a, e) => a + (e.setsLog?.length ?? 0), 0)} serii)${r.date ? `, data ${r.date.split('-').reverse().join('.')}` : ''}.${r.skipped.length ? ` Pominięto: ${r.skipped.join(', ')}.` : ''}`);
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
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [charge, setCharge] = useState<Billing | ''>(existing?.charge ?? '');
  const [locationId, setLocationId] = useState(existing?.locationId ?? m.appt?.locationId ?? clientById(db, existing?.clientId ?? m.clientId ?? m.appt?.clientId)?.locationId ?? '');
  const [amount, setAmount] = useState('');
  const [paidNow, setPaidNow] = useState(true);

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
          load: sum.load || (sug.load != null ? String(sug.load) : ''),
          rpe: sum.rpe,
          rest: e.rest ?? '',
          notes: e.notes ?? '',
          hint: sug.why || undefined,
          linked: e.linked,
          // każda seria z planu osobno — ciężary jak w treningu na żywo (%, ±% od poprzedniej, z RPE), cel RPE w podpowiedzi
          series: buildRunExercise(e, history).sets.map((x) => ({
            key: uid(),
            load: x.load,
            reps: x.reps,
            rpe: '',
            tRpe: x.tRpe || undefined,
            warmup: x.warmup || undefined,
            label: x.label && x.label !== 'Robocze' ? x.label : undefined,
          })),
        };
      }),
    );
  };

  // Nowy trening: od razu podpowiedz następną jednostkę z planu.
  const [autoLoaded, setAutoLoaded] = useState(!!existing || !!m.paste); // przy wklejaniu z notatki nie wczytujemy jednostki z planu
  if (!autoLoaded && client) {
    setAutoLoaded(true);
    const nx = nextWorkout(plan, history);
    if (nx) loadWorkout(nx.workout.id);
    if (client.singleRate) setAmount(String(client.singleRate));
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
      pain: num(pain) ?? undefined,
      notes: notes.trim() || undefined,
      wellness: Object.keys(wellness).length ? wellness : undefined,
      sleepH: num(sleepH) ?? undefined,
      rhr: num(rhr) ?? undefined,
      locationId: locationId || undefined,
      planId: planRef.planId,
      workoutId: planRef.workoutId,
      exercises: withBlockLabels(rows).map((r) => ({
        name: r.name.trim(),
        label: r.label,
        ...(r.series ? { ...seriesSummary(r.series, r.reps), rpe: '' } : { sets: r.sets, reps: r.reps, load: r.load, rpe: r.rpe }),
        rest: r.rest || undefined,
        notes: r.notes || undefined,
        setsLog: r.series ? toLog(r.series) : undefined,
      })),
    };
    const { changes, message } = saveSession(db, { session, isNew: !existing, appointmentId: m.appt?.id, amount: num(amount) ?? undefined, paidNow });
    if (!(await apply(changes, message))) return; // formularz zostaje otwarty — można ponowić
    closeModal();
  };

  const remove = async () => {
    if (!existing || !(await ask('Usunąć ten trening? Powiązana wizyta wróci do „zaplanowanej”.'))) return;
    const sp = sessionPayment(db, existing);
    const removePayment =
      !!sp &&
      (await ask(
        `Za ten trening jest płatność ${pln(sp.payment.amount)} (${sp.payment.status === 'paid' ? 'opłacona' : 'do zapłaty'}). Usunąć ją też?`,
        { confirm: 'Usuń płatność' },
      ));
    await apply(deleteSession(db, existing.id, removePayment), removePayment ? 'Trening i płatność usunięte.' : 'Trening usunięty.');
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
        <Field label="Nazwa treningu" wide>
          <input className="input" value={workoutName} onChange={(e) => setWorkoutName(e.target.value)} placeholder="np. A – dół ciała" />
        </Field>
      </div>


      <div className="between form-section">
        <h4>Ćwiczenia</h4>
        {paste === null && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPaste('')}>
            📋 Wklej z notatki
          </button>
        )}
      </div>
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
                <>
                  <input className={`input ${sum ? 'derived' : ''}`} value={sum ? sum.sets : r.sets} readOnly={!!sum} onChange={(e) => setRow(i, { sets: e.target.value })} aria-label="Serie" placeholder="serie" />
                  <input className={`input ${sum ? 'derived' : ''}`} value={sum ? sum.reps : r.reps} readOnly={!!sum} onChange={(e) => setRow(i, { reps: e.target.value })} aria-label="Powtórzenia" placeholder="powt." />
                  <input className={`input ${sum ? 'derived' : ''}`} inputMode="decimal" value={sum ? sum.load : r.load} readOnly={!!sum} onChange={(e) => setRow(i, { load: e.target.value })} aria-label="Ciężar" placeholder="kg" />
                  <input className={`input ${sum ? 'derived' : ''}`} inputMode="decimal" value={sum ? '' : r.rpe} readOnly={!!sum} onChange={(e) => setRow(i, { rpe: e.target.value })} aria-label="RPE" placeholder={sum ? '—' : 'RPE'} />
                </>
              );
            })()}
            <input className="input" value={r.rest} onChange={(e) => setRow(i, { rest: e.target.value })} aria-label="Przerwa" placeholder="przerwa" />
            <span className="ex-actions">
              <IconBtn icon="up" label="Przesuń w górę" onClick={() => moveUp(i)} />
              <IconBtn icon="trash" label="Usuń ćwiczenie" danger onClick={() => setRows(removeFromBlocks(rows, i))} />
            </span>
            <input className="input ex-notes" value={r.notes} onChange={(e) => setRow(i, { notes: e.target.value })} placeholder="Uwagi (np. tempo 3-1-X-0)" aria-label="Uwagi" />
            {r.hint && !r.series && <span className="ex-hint">Podpowiedź: {r.hint}</span>}
            {r.series ? (
              <div className="set-edit">
                <div className="set-edit-head">
                  <span>#</span>
                  <span>powt.</span>
                  <span>kg</span>
                  <span>RPE</span>
                  <span />
                  <span />
                </div>
                {r.series.map((x, k) => {
                  const upd = (patch: Partial<SetDraft>) => setSeries(i, (d) => d.map((y, m) => (m === k ? { ...y, ...patch } : y)));
                  const workNo = r.series!.slice(0, k + 1).filter((y) => !y.warmup).length;
                  return (
                    <div key={x.key} className={`set-edit-row ${x.warmup ? 'warm' : ''}`}>
                      <button type="button" className="set-no" aria-pressed={!!x.warmup} aria-label={x.warmup ? `Seria ${k + 1}: rozgrzewka` : `Seria ${k + 1}: robocza`} title={x.warmup ? 'Rozgrzewka — kliknij, by zmienić na roboczą' : 'Seria robocza — kliknij, by oznaczyć jako rozgrzewkę'} onClick={() => upd({ warmup: !x.warmup || undefined })}>
                        {x.warmup ? 'R' : workNo}
                      </button>
                      <input className="input" inputMode="numeric" value={x.reps} onChange={(e) => upd({ reps: e.target.value })} aria-label={`Powtórzenia, seria ${k + 1}`} placeholder="powt." />
                      <input className="input" inputMode="decimal" value={x.load} onChange={(e) => upd({ load: e.target.value })} aria-label={`Ciężar, seria ${k + 1}`} placeholder="kg" />
                      <input className="input" inputMode="decimal" value={x.rpe} onChange={(e) => upd({ rpe: e.target.value })} aria-label={`RPE, seria ${k + 1}`} placeholder={x.tRpe ? `cel ${x.tRpe}` : 'RPE'} />
                      {clientId ? <SetVideoButton clientId={clientId} video={x.video} title={`${r.name || 'Ćwiczenie'} · seria ${k + 1}`} onChange={(video) => upd({ video })} /> : <span />}
                      <IconBtn icon="trash" label={`Usuń serię ${k + 1}`} danger onClick={() => setSeries(i, (d) => d.filter((_, m) => m !== k))} />
                    </div>
                  );
                })}
                <div className="between">
                  <button type="button" className="link small" onClick={() => setSeries(i, (d) => [...d, blankSet(d[d.length - 1])])}>
                    + seria
                  </button>
                  <span className="muted small">dotknij numeru serii, by oznaczyć rozgrzewkę</span>
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
        <Field label="Notatki" wide>
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
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
        {effCharge === 'pojedyncza' && !existing && (
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
