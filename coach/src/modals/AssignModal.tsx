import { useState } from 'react';
import { Field, Icon, Modal, Seg } from '../components/ui';
import type { Plan, PlanExercise, PlanWorkout } from '../domain';
import { addExtraWorkout, clientById, extraPlanOf, newExtraPlan, plansOf, savePlan, sessionToWorkout, sessionsOf } from '../data/ops';
import type { Change } from '../data/db';
import { exercisesFor, matchName, nextMonday, planFromTemplate } from '../lib/analytics';
import { useStore } from '../data/store';
import { fmtDay, nEx, uid } from '../format';
import { addDays, todayISO } from '../lib/dates';
import { currentPlan, planSequence } from '../lib/plan';
import { emptyRunExercise, RUN_TEMPLATES } from '../lib/running';
import { useNav, type ModalState } from '../nav';
import { put } from '../data/db';
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
  // powtórka / kopia z historii: trening może być innego podopiecznego
  const srcSession = m.sessionId ? db.sessions.find((x) => x.id === m.sessionId) : undefined;
  const [src, setSrc] = useState<Source>(srcSession ? 'repeat' : 'empty');
  const [pick, setPick] = useState(srcSession?.id ?? '');
  const [name, setName] = useState(srcSession?.workoutName || '');
  // ciężary z oryginału albo puste (podpowiedź z historii tej osoby) — przy kopii dla kogoś innego domyślnie puste
  const [keepLoads, setKeepLoads] = useState<boolean | null>(null);
  const [time, setTime] = useState('');
  // ten sam trening także dla innych osób (każda dostaje własną kopię; ciężary dobierze historia tej osoby)
  const [others, setOthers] = useState<string[]>([]);
  const [manyOpen, setManyOpen] = useState(false);

  const client = clientById(db, clientId);
  const plan = clientId ? currentPlan(plansOf(db, clientId)) : null;
  const steps = plan ? planSequence(plan) : [];
  const own = clientId ? sessionsOf(db, clientId).filter((s) => s.exercises.length).slice(0, 15) : [];
  const done = srcSession && !own.some((x) => x.id === srcSession.id) ? [srcSession, ...own] : own;
  const fromOther = (id: string) => {
    const se = done.find((x) => x.id === id);
    return !!se && !!clientId && se.clientId !== clientId;
  };
  const keep = keepLoads ?? !(src === 'repeat' && fromOther(pick));
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
      if (!se) return null;
      const ex = copyEx(sessionToWorkout(se).exercises);
      // bez ciężarów: odtwarzacz dobierze je z historii tej osoby (bieg — dystans zostaje)
      return { name: se.workoutName || 'Trening', exercises: keep ? ex : ex.map((e) => (e.cardio ? e : { ...e, groups: e.groups.map((g) => ({ ...g, load: '' })) })) };
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
    if (time && !date) return toast('Godzina wizyty — wybierz też dzień (nie „Kiedy chce”).'), null;
    if (time && !/^\d{1,2}:\d{2}$/.test(time)) return toast('Godzina wizyty, np. 9:00.'), null;
    const n = extraPlanOf(db, client.id)?.weeks.reduce((a, w) => a + w.workouts.length, 0) ?? 0;
    return { id: uid(), name: name.trim() || chosen?.name || `Trening dodatkowy ${n + 1}`, date, assignedAt: date ? today : undefined, exercises: chosen?.exercises ?? [] };
  };

  /** Od razu zapis (gdy trening ma ćwiczenia). */
  const save = async () => {
    const wo = build();
    if (!wo || !client) return;
    if (!hasEx) return edit();
    // z godziną: także wizyta z trenerem tego dnia
    const apptFor = (cid: string, locationId?: string) => (time && date ? [put('appointments', { id: uid(), clientId: cid, date, time: time.padStart(5, '0'), duration: 60, status: 'planned' as const, locationId })] : []);
    const appt = apptFor(client.id, client.locationId);
    const rest = others.map((id) => clientById(db, id)).filter((c): c is NonNullable<typeof c> => !!c && c.id !== client.id);
    const changes: Change[] = [...addExtraWorkout(db, client.id, wo), ...appt];
    for (const c of rest) changes.push(...addExtraWorkout(db, c.id, { ...wo, id: uid(), exercises: exercisesFor(wo.exercises, false) }), ...apptFor(c.id, c.locationId));
    const who = rest.length ? `${rest.length + 1} osobom` : client.name.split(' ')[0];
    const msg = rest.length
      ? `Zadano „${wo.name}”${date ? ` na ${fmtDay(date)}` : ''}${appt.length ? ` · wizyty ${time}` : ''} — ${who}.`
      : `Zadano „${wo.name}”${date ? ` na ${fmtDay(date)}` : ''}${appt.length ? ` · wizyta ${time}` : ''} — ${who} zobaczy go w aplikacji.`;
    if (await apply(changes, msg)) closeModal();
  };
  /** Do edytora: ułożenie albo dopasowanie ćwiczeń przed zapisem. */
  const edit = () => {
    if (others.length) return toast('Kilka osób: najpierw wybierz trening (z planu, powtórkę albo bieg) — ćwiczenia zmienisz potem u każdej osoby.');
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
        hasEx && !others.length && (
          <button type="button" className="btn btn-secondary" onClick={edit}>
            Zmień ćwiczenia
          </button>
        )
      }
    >
      <p className="muted small">Trening poza planem — plan i jego kolejność zostają bez zmian. Podopieczny zobaczy go na górze ekranu w wybranym dniu (albo na liście „poza planem”, jeśli bez terminu).</p>
      {(!m.clientId || m.sessionId) && (
        <Field label={m.sessionId ? 'Dla kogo' : 'Podopieczny'}>
          <ClientSelect value={clientId} onChange={(id) => (setClientId(id), setKeepLoads(null), setOthers((o) => o.filter((x) => x !== id)), srcSession ? undefined : (setSrc('empty'), setPick(''), setName('')))} />
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
              <b><Icon name="run" size={15} /> Bieg</b>
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
                      {fmtDay(x.date)} · {x.workoutName || 'Trening'}{x.clientId !== clientId ? ` (${clientById(db, x.clientId)?.name ?? ''})` : ''}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          )}
        </div>
        {src === 'repeat' && chosen && (
          <label className="assign-loads small">
            <input type="checkbox" checked={keep} onChange={(e) => setKeepLoads(e.target.checked)} />
            <span>
              {fromOther(pick) ? `Ciężary z oryginału (${clientById(db, done.find((x) => x.id === pick)?.clientId)?.name.split(' ')[0] ?? '—'})` : 'Ciężary jak w tamtym treningu'}
              {!keep && <span className="muted"> — bez zaznaczenia ciężary podpowie historia tej osoby</span>}
            </span>
          </label>
        )}
        {hasEx && <span className="muted small">{nEx(chosen!.exercises.filter((e) => e.name).length)}{others.length ? '' : ' — możesz zadać od razu albo najpierw zmienić'}.</span>}
      </div>
      <div className="field assign-many">
        {!manyOpen && !others.length ? (
          <button type="button" className="link small" onClick={() => setManyOpen(true)} disabled={!clientId}>
            + Ten sam trening także dla innych osób
          </button>
        ) : (
          <>
            <span>Także dla{others.length ? ` (${others.length})` : ''}</span>
            <ClientMultiPick value={others} onChange={setOthers} exclude={clientId ? [clientId] : []} />
            <span className="muted small">Każdy dostaje własną kopię na ten sam dzień{time ? ' i godzinę' : ''}. Kilogramy zostają puste — odtwarzacz podpowie je z historii każdej osoby (zapis w % zostaje).</span>
          </>
        )}
      </div>
      {when !== 'Kiedy chce' && (
        <Field label="Wizyta z trenerem o (opcjonalnie)">
          <input className="input assign-day" type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Godzina wizyty" />
        </Field>
      )}
      <Field label="Nazwa">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={chosen?.name || 'np. Mobilność + core'} />
      </Field>
    </Modal>
  );
}

/** Wybór kilku podopiecznych z wyszukiwarką (aktywni; po wpisaniu imienia — wszyscy). */
export function ClientMultiPick({ value, onChange, exclude = [] }: { value: string[]; onChange: (ids: string[]) => void; exclude?: string[] }) {
  const { db } = useStore();
  const [q, setQ] = useState('');
  const list = [...db.clients]
    .filter((c) => !exclude.includes(c.id) && (value.includes(c.id) || (q.trim() ? matchName(c.name, q) : c.status === 'aktywny')))
    .sort((a, b) => Number(value.includes(b.id)) - Number(value.includes(a.id)) || a.name.localeCompare(b.name, 'pl'));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const shown = list.filter((c) => !value.includes(c.id));
  return (
    <div className="multi-pick">
      {value.length > 0 && (
        <div className="chips multi-pick-chosen">
          {value.map((id) => (
            <button key={id} type="button" className="chip active" onClick={() => toggle(id)} aria-label={`Usuń ${clientById(db, id)?.name ?? ''}`}>
              {clientById(db, id)?.name ?? '—'} ✕
            </button>
          ))}
        </div>
      )}
      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Szukaj podopiecznego…" aria-label="Szukaj podopiecznego" />
      <ul className="multi-pick-list" role="listbox" aria-multiselectable="true" aria-label="Podopieczni">
        {shown.length === 0 && <li className="muted small">{q.trim() ? 'Nikogo nie znaleziono.' : 'Brak innych aktywnych podopiecznych.'}</li>}
        {shown.map((c) => (
          <li key={c.id} role="option" aria-selected={false}>
            <label className="multi-pick-opt">
              <input type="checkbox" checked={false} onChange={() => toggle(c.id)} />
              <span className="grow">{c.name}</span>
              {c.status !== 'aktywny' && <span className="muted small">{c.status}</span>}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Plan z szablonu dla kilku osób naraz: start od najbliższego poniedziałku. */
export function TemplateAssignModal({ template, onClose }: { template: Plan; onClose: () => void }) {
  const { db, apply, toast } = useStore();
  const [ids, setIds] = useState<string[]>([]);
  const [active, setActive] = useState(true);
  const start = nextMonday(todayISO());
  return (
    <Modal
      title={`Przypisz szablon „${template.name}”`}
      onClose={onClose}
      submitLabel={ids.length ? `Przypisz (${ids.length})` : 'Przypisz'}
      onSubmit={async () => {
        if (!ids.length) return toast('Wybierz przynajmniej jedną osobę.');
        const changes: Change[] = [];
        for (const id of ids) {
          const has = plansOf(db, id).length > 0;
          changes.push(...savePlan(db, planFromTemplate(template, id, todayISO(), active || !has)));
        }
        if (await apply(changes, `Plan „${template.name}” przypisany: ${ids.length} ${ids.length === 1 ? 'osoba' : ids.length < 5 ? 'osoby' : 'osób'} · start ${fmtDay(start)}.`)) onClose();
      }}
    >
      <p className="muted small">Każda osoba dostaje własną kopię planu ze startem w poniedziałek {fmtDay(start)}. Szablon zostaje bez zmian.</p>
      <div className="field">
        <span>Dla kogo</span>
        <ClientMultiPick value={ids} onChange={setIds} />
      </div>
      <label className="check">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Ustaw jako aktywny plan (dotychczasowy przestanie być aktywny)
      </label>
    </Modal>
  );
}
