import { useState } from 'react';
import { Field, Modal, Seg } from '../components/ui';
import type { PlanExercise, PlanWorkout } from '../domain';
import { addExtraWorkout, clientById, extraPlanOf, newExtraPlan, plansOf, sessionToWorkout, sessionsOf } from '../data/ops';
import { useStore } from '../data/store';
import { fmtDay, nEx, uid } from '../format';
import { addDays, todayISO } from '../lib/dates';
import { currentPlan, planSequence } from '../lib/plan';
import { emptyRunExercise, RUN_TEMPLATES } from '../lib/running';
import { useNav, type ModalState } from '../nav';
import { ClientSelect } from './ModalHost';

const WHEN = ['Dziś', 'Jutro', 'Inny dzień', 'Kiedy chce'] as const;
type When = (typeof WHEN)[number];
type Source = 'empty' | 'run' | 'plan' | 'repeat';

/** Kopia ćwiczeń z nowymi id (zmiany w zadanym treningu nie ruszają planu). */
const copyEx = (ex: PlanExercise[]): PlanExercise[] => structuredClone(ex).map((e) => ({ ...e, id: uid() }));

/**
 * „Zadaj trening” — jedno miejsce na trening poza planem: na kiedy (dziś / jutro / dzień / bez terminu)
 * i z czego (pusty, bieg z szablonu, kopia jednostki z planu, powtórka wykonanego). Plan i jego kolejność się nie zmieniają.
 */
export function AssignModal({ m }: { m: Extract<ModalState, { kind: 'assign' }> }) {
  const { db, apply, toast } = useStore();
  const { closeModal, openModal } = useNav();
  const today = todayISO();
  const [clientId, setClientId] = useState(m.clientId ?? '');
  // dzień z przeszłości (np. z kalendarza) → dziś
  const start = m.date && m.date >= today ? m.date : undefined;
  const [when, setWhen] = useState<When>(start ? (start === today ? 'Dziś' : start === addDays(today, 1) ? 'Jutro' : 'Inny dzień') : m.date ? 'Dziś' : 'Jutro');
  const [day, setDay] = useState(start ?? addDays(today, 2));
  const [src, setSrc] = useState<Source>('empty');
  const [pick, setPick] = useState('');
  const [name, setName] = useState('');

  const client = clientById(db, clientId);
  const plan = clientId ? currentPlan(plansOf(db, clientId)) : null;
  const steps = plan ? planSequence(plan) : [];
  const done = clientId ? sessionsOf(db, clientId).filter((s) => s.exercises.length).slice(0, 15) : [];
  const date = when === 'Dziś' ? today : when === 'Jutro' ? addDays(today, 1) : when === 'Inny dzień' ? day : undefined;

  /** Ćwiczenia i domyślna nazwa z wybranego źródła. */
  const fromSource = (s: Source, id: string): { name: string; exercises: PlanExercise[] } | null => {
    if (s === 'run') {
      if (id === 'custom') return { name: 'Bieg', exercises: [emptyRunExercise()] };
      const t = RUN_TEMPLATES.find((x) => x.id === id);
      return t ? { name: t.name, exercises: [t.make()] } : null;
    }
    if (s === 'plan') {
      const st = steps.find((x) => x.workout.id === id);
      return st ? { name: st.workout.name, exercises: copyEx(st.workout.exercises) } : null;
    }
    if (s === 'repeat') {
      const se = done.find((x) => x.id === id);
      return se ? { name: se.workoutName || 'Trening', exercises: copyEx(sessionToWorkout(se).exercises) } : null;
    }
    return { name: '', exercises: [] };
  };
  const chosen = fromSource(src, pick);
  const choose = (s: Source, id: string) => {
    setSrc(s);
    setPick(id);
    const r = fromSource(s, id);
    if (r?.name) setName(r.name);
  };

  const build = (): PlanWorkout | null => {
    if (!client) return toast('Wybierz podopiecznego.'), null;
    if (when === 'Inny dzień' && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return toast('Wybierz dzień.'), null;
    if (when === 'Inny dzień' && day < today) return toast('Ten dzień już minął — wybierz dziś albo później.'), null;
    if (src !== 'empty' && !chosen) return toast('Wybierz, z czego ma być trening.'), null;
    const n = extraPlanOf(db, client.id)?.weeks.reduce((a, w) => a + w.workouts.length, 0) ?? 0;
    return { id: uid(), name: name.trim() || chosen?.name || `Trening dodatkowy ${n + 1}`, date, assignedAt: date ? today : undefined, exercises: chosen?.exercises ?? [] };
  };

  /** Od razu zapis (gdy trening ma ćwiczenia). */
  const save = async () => {
    const wo = build();
    if (!wo || !client) return;
    if (!hasEx) return edit();
    if (await apply(addExtraWorkout(db, client.id, wo), `Zadano „${wo.name}”${date ? ` na ${fmtDay(date)}` : ''} — ${client.name.split(' ')[0]} zobaczy go w aplikacji.`)) closeModal();
  };
  /** Do edytora: ułożenie albo dopasowanie ćwiczeń przed zapisem. */
  const edit = () => {
    const wo = build();
    if (!wo || !client) return;
    const extra = extraPlanOf(db, client.id);
    const base = extra ?? newExtraPlan(client.id);
    const weeks = base.weeks.length ? base.weeks : [{ id: uid(), name: 'Dodatkowe', workouts: [] }];
    openModal({ kind: 'plan', plan: { ...base, weeks: weeks.map((w, i) => (i === weeks.length - 1 ? { ...w, workouts: [...w.workouts, wo] } : w)) }, isNew: !extra, focusWorkoutId: wo.id });
  };

  // „ma treść”: ćwiczenie z nazwą i (dla biegu) przynajmniej jeden odcinek z czasem lub dystansem
  const hasEx = !!chosen?.exercises.some((e) => e.name && (!e.cardio || e.groups.some((g) => g.reps.trim() || g.load.trim())));
  return (
    <Modal
      title="Zadaj trening"
      onClose={closeModal}
      onSubmit={() => void save()}
      submitLabel={hasEx ? 'Zadaj' : 'Dalej — ułóż ćwiczenia'}
      extraActions={
        hasEx && (
          <button type="button" className="btn btn-secondary" onClick={edit}>
            Zmień ćwiczenia
          </button>
        )
      }
    >
      <p className="muted small">Trening poza planem — plan i jego kolejność zostają bez zmian. Podopieczny zobaczy go na górze ekranu w wybranym dniu (albo na liście „poza planem”, jeśli bez terminu).</p>
      {!m.clientId && (
        <Field label="Podopieczny">
          <ClientSelect value={clientId} onChange={(id) => (setClientId(id), setSrc('empty'), setPick(''), setName(''))} />
        </Field>
      )}
      <div className="field">
        <span>Na kiedy</span>
        <Seg options={WHEN} value={when} onChange={setWhen} label="Na kiedy" />
        {when === 'Inny dzień' && <input className="input assign-day" type="date" value={day} min={today} onChange={(e) => setDay(e.target.value)} aria-label="Dzień" />}
        {when === 'Kiedy chce' && <span className="muted small">Bez terminu — do zrobienia w dowolnym momencie, można powtarzać.</span>}
      </div>
      <div className="field">
        <span>Z czego</span>
        <div className="assign-src" role="radiogroup" aria-label="Z czego">
          <label className={`assign-opt ${src === 'empty' ? 'on' : ''}`}>
            <input type="radio" checked={src === 'empty'} onChange={() => choose('empty', '')} />
            <span>
              <b>Pusty</b>
              <span className="muted small">ćwiczenia ułożysz w następnym kroku</span>
            </span>
          </label>
          <label className={`assign-opt ${src === 'run' ? 'on' : ''}`}>
            <input type="radio" checked={src === 'run'} onChange={() => choose('run', 'custom')} />
            <span>
              <b>🏃 Bieg</b>
              <select className="input input-sm" value={src === 'run' ? pick : ''} onChange={(e) => choose('run', e.target.value)} aria-label="Rodzaj biegu">
                {src !== 'run' && <option value="">wybierz…</option>}
                <option value="custom">Własny — ułożę odcinki</option>
                {RUN_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    Szablon: {t.name} — {t.hint}
                  </option>
                ))}
              </select>
            </span>
          </label>
          {steps.length > 0 && (
            <label className={`assign-opt ${src === 'plan' ? 'on' : ''}`}>
              <input type="radio" checked={src === 'plan'} onChange={() => choose('plan', steps[0].workout.id)} />
              <span>
                <b>Kopia jednostki z planu</b>
                <select className="input input-sm" value={src === 'plan' ? pick : ''} onChange={(e) => choose('plan', e.target.value)} aria-label="Jednostka z planu">
                  {src !== 'plan' && <option value="">wybierz…</option>}
                  {steps.map((x) => (
                    <option key={x.workout.id} value={x.workout.id}>
                      {x.week.name} · {x.workout.name}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          )}
          {done.length > 0 && (
            <label className={`assign-opt ${src === 'repeat' ? 'on' : ''}`}>
              <input type="radio" checked={src === 'repeat'} onChange={() => choose('repeat', done[0].id)} />
              <span>
                <b>Powtórka wykonanego</b>
                <select className="input input-sm" value={src === 'repeat' ? pick : ''} onChange={(e) => choose('repeat', e.target.value)} aria-label="Wykonany trening">
                  {src !== 'repeat' && <option value="">wybierz…</option>}
                  {done.map((x) => (
                    <option key={x.id} value={x.id}>
                      {fmtDay(x.date)} · {x.workoutName || 'Trening'}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          )}
        </div>
        {hasEx && <span className="muted small">{nEx(chosen!.exercises.filter((e) => e.name).length)} — możesz zadać od razu albo najpierw zmienić.</span>}
      </div>
      <Field label="Nazwa">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={chosen?.name || 'np. Mobilność + core'} />
      </Field>
    </Modal>
  );
}
