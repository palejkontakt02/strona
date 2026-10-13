import { useMemo, useState } from 'react';
import { Field, IconBtn, Modal } from '../components/ui';
import type { Billing, SessionExercise, TrainingSession, Wellness } from '../domain';
import { clientById, deleteSession, plansOf, saveSession, sessionsOf } from '../data/ops';
import { useStore } from '../data/store';
import { fnum, uid } from '../format';
import { defaultCharge, packageStatus } from '../lib/billing';
import { todayISO } from '../lib/dates';
import { num } from '../lib/parse';
import { currentPlan, exerciseSummary, nextWorkout, planSequence } from '../lib/plan';
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
  setsLog?: SessionExercise['setsLog'];
  hint?: string;
}

const s = (v: number | undefined | null) => (v == null ? '' : String(v));
const toRow = (e: SessionExercise): ExRow => ({ key: uid(), name: e.name, sets: e.sets ?? '', reps: e.reps ?? '', load: e.load ?? '', rpe: e.rpe ?? '', rest: e.rest ?? '', notes: e.notes ?? '', setsLog: e.setsLog });
const emptyRow = (): ExRow => ({ key: uid(), name: '', sets: '3', reps: '', load: '', rpe: '', rest: '', notes: '' });

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
  const seq = plan ? planSequence(plan) : [];

  const [date, setDate] = useState(existing?.date ?? m.appt?.date ?? m.date ?? todayISO());
  const [workoutName, setWorkoutName] = useState(existing?.workoutName ?? '');
  const [planRef, setPlanRef] = useState<{ planId?: string; workoutId?: string }>({ planId: existing?.planId, workoutId: existing?.workoutId });
  const [rows, setRows] = useState<ExRow[]>(() => (existing ? existing.exercises.map(toRow) : []));
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
  const pk = client ? packageStatus(client, history) : null;

  /** Wczytuje jednostkę z planu: ćwiczenia z podsumowaniem serii i podpowiedzią ciężaru z historii. */
  const loadWorkout = (workoutId: string) => {
    const step = seq.find((x) => x.workout.id === workoutId);
    if (!step || !plan) return;
    setPlanRef({ planId: plan.id, workoutId });
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
        };
      }),
    );
  };

  // Nowy trening: od razu podpowiedz następną jednostkę z planu.
  const [autoLoaded, setAutoLoaded] = useState(!!existing);
  if (!autoLoaded && client) {
    setAutoLoaded(true);
    const nx = nextWorkout(plan, history);
    if (nx) loadWorkout(nx.workout.id);
    if (client.singleRate) setAmount(String(client.singleRate));
  }

  const setRow = (i: number, patch: Partial<ExRow>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch, setsLog: patch.setsLog ?? (Object.keys(patch).some((k) => ['sets', 'reps', 'load', 'rpe'].includes(k)) ? undefined : x.setsLog) } : x)));
  const moveUp = (i: number) => i > 0 && setRows((r) => [...r.slice(0, i - 1), r[i], r[i - 1], ...r.slice(i + 1)]);

  const au = num(srpe) != null && num(duration) != null ? num(srpe)! * num(duration)! : null;

  const save = async () => {
    if (!client) return toast('Wybierz podopiecznego.');
    if (!date) return toast('Podaj datę treningu.');
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
      duration: num(duration) ?? undefined,
      srpe: num(srpe) ?? undefined,
      pain: num(pain) ?? undefined,
      notes: notes.trim() || undefined,
      wellness: Object.keys(wellness).length ? wellness : undefined,
      sleepH: num(sleepH) ?? undefined,
      rhr: num(rhr) ?? undefined,
      locationId: locationId || undefined,
      planId: planRef.planId,
      workoutId: planRef.workoutId,
      exercises: rows
        .filter((r) => r.name.trim())
        .map((r) => ({ name: r.name.trim(), sets: r.sets, reps: r.reps, load: r.load, rpe: r.rpe, rest: r.rest || undefined, notes: r.notes || undefined, setsLog: r.setsLog })),
    };
    const { changes, message } = saveSession(db, { session, isNew: !existing, appointmentId: m.appt?.id, amount: num(amount) ?? undefined, paidNow });
    await apply(changes, message);
    closeModal();
  };

  const remove = async () => {
    if (!existing || !(await ask('Usunąć ten trening? Powiązana wizyta wróci do „zaplanowanej”.'))) return;
    await apply(deleteSession(db, existing.id), 'Trening usunięty.');
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

      <h4 className="form-section">Samopoczucie przed treningiem</h4>
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

      <h4 className="form-section">Ćwiczenia</h4>
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
            <input className="input" value={r.sets} onChange={(e) => setRow(i, { sets: e.target.value })} aria-label="Serie" />
            <input className="input" value={r.reps} onChange={(e) => setRow(i, { reps: e.target.value })} aria-label="Powtórzenia" />
            <input className="input" inputMode="decimal" value={r.load} onChange={(e) => setRow(i, { load: e.target.value })} aria-label="Ciężar" />
            <input className="input" inputMode="decimal" value={r.rpe} onChange={(e) => setRow(i, { rpe: e.target.value })} aria-label="RPE" />
            <input className="input" value={r.rest} onChange={(e) => setRow(i, { rest: e.target.value })} aria-label="Przerwa" />
            <span className="ex-actions">
              <IconBtn icon="up" label="Przesuń w górę" onClick={() => moveUp(i)} />
              <IconBtn icon="trash" label="Usuń ćwiczenie" danger onClick={() => setRows(rows.filter((_, j) => j !== i))} />
            </span>
            <input className="input ex-notes" value={r.notes} onChange={(e) => setRow(i, { notes: e.target.value })} placeholder="Uwagi (np. tempo 3-1-X-0)" aria-label="Uwagi" />
            {(r.hint || r.setsLog) && (
              <span className="ex-hint">
                {r.setsLog ? `${r.setsLog.filter((x) => !x.warmup).length} serii zapisanych w trybie zawodnika: ${r.setsLog.filter((x) => !x.warmup).map((x) => `${fnum(x.load)}×${x.reps ?? '?'}`).join(', ')}` : `Podpowiedź: ${r.hint}`}
              </span>
            )}
          </div>
        ))}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows([...rows, emptyRow()])}>
          + Ćwiczenie
        </button>
      </div>

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
              return l?.kind === 'klub' ? `Klub ${l.name} wypłaci ${l.clubRate ?? 0} zł za ten trening.` : 'Wybierz klub, który rozlicza ten trening.';
            })()}
          </p>
        )}
        {effCharge === 'pakiet' && (
          <p className="muted small field-wide-2 self-end">
            {pk ? (pk.left > 0 ? `W pakiecie zostało ${pk.left} (po zapisie: ${pk.left - (existing ? 0 : 1)}).` : 'Pakiet wykorzystany — trening będzie ponad pakiet.') : 'Klient nie ma wykupionego pakietu.'}
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
