import { useMemo, useState } from 'react';
import type { Client, Plan, TrainingSession } from '../domain';
import { put } from '../data/db';
import { savePlan } from '../data/ops';
import { useStore } from '../data/store';
import { fmtShort, plural } from '../format';
import { todayISO, weekStart } from '../lib/dates';
import { applySuggestions, suggestLoads, type LoadSuggestion } from '../lib/loadSuggest';
import { fmtWeekdayDate } from '../lib/planGrid';
import { absenceShift, doneWorkoutIds, planDates, shiftPlanFrom, shiftPreview, type Absence } from '../lib/planShift';
import { nextWorkout } from '../lib/plan';
import { Field, Icon, Tag } from './ui';

const kg = (v: number) => `${String(Math.round(v * 100) / 100).replace('.', ',')} kg`;
const nDays = (n: number) => `${n} ${plural(Math.abs(n), 'dzień', 'dni', 'dni')}`;

/** Nieobecności klienta (pole dopisuje moduł nieobecności; tu tylko odczyt). */
export const absencesOf = (c: Client) => (c as Client & { absences?: Absence[] }).absences;

/** Bursztynowa informacja: na nieobecność klienta wypadają treningi planu → propozycja przesunięcia. */
export function AbsenceNotice({ client, plan, sessions, onShift }: { client: Client; plan: Plan; sessions?: TrainingSession[]; onShift: (from: string, days: number) => void }) {
  const hit = absenceShift(plan, absencesOf(client), todayISO(), sessions);
  if (!hit) return null;
  const { absence: a, from, days } = hit;
  return (
    <div className="warn-box pt-absence" role="status">
      <Icon name="alert" size={16} />
      <span className="pt-absence-text">
        Nieobecność {fmtShort(a.from)}–{fmtShort(a.to)}
        {a.reason ? ` (${a.reason})` : ''} — przesunąć plan o {nDays(days)}?
      </span>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onShift(from, days)}>
        Przesuń o {nDays(days)}
      </button>
    </div>
  );
}

const DAY_CHIPS = [-3, -2, -1, 1, 2, 3, 7];
const MIN_DAYS = -28;
const MAX_DAYS = 56;
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
/** „-3”, „−3”, „+2”, „7” → liczba; inaczej null. */
const parseDays = (t: string) => {
  const m = t.trim().replace(/[−–]/, '-').match(/^([+-]?)\s*(\d{1,3})$/);
  return m ? (m[1] === '-' ? -1 : 1) * Number(m[2]) : null;
};

/** Data następnej niewykonanej jednostki planu (≥ dziś): najpierw „następna” z kolejności, potem najwcześniejsza niewykonana. */
export function nextUndoneDate(plan: Plan, sessions: TrainingSession[] | undefined, today: string): string | undefined {
  const done = doneWorkoutIds(plan, sessions);
  const ds = planDates(plan).filter((x) => !done.has(plan.weeks[x.wi].workouts[x.ki].id) && x.date >= today);
  const nx = nextWorkout(plan, sessions ?? []);
  const nxd = nx && ds.find((x) => plan.weeks[x.wi].workouts[x.ki].id === nx.workout.id)?.date;
  return nxd ?? ds.map((x) => x.date).sort()[0];
}

/** Panel „Przesuń plan”: od wybranego tygodnia / dnia o N dni, z podglądem dat i cofnięciem. */
export function ShiftPanel({ plan, sessions, preset, onClose }: { plan: Plan; sessions?: TrainingSession[]; preset?: { from: string; days: number }; onClose: () => void }) {
  const { db, apply, toast } = useStore();
  const today = todayISO();
  const weeks = useMemo(() => {
    const ds = planDates(plan);
    return plan.weeks.flatMap((w, wi) => {
      const first = ds.filter((x) => x.wi === wi).map((x) => x.date).sort()[0];
      return first ? [{ name: w.name, first }] : [];
    });
  }, [plan]);
  const nextFrom = useMemo(() => nextUndoneDate(plan, sessions, today), [plan, sessions, today]);
  const def = preset?.from ?? nextFrom ?? weeks.find((w) => w.first >= today)?.first ?? weeks[0]?.first ?? today;
  const [from, setFrom] = useState(def);
  // „Inna data…” — własne pole daty (też gdy domyślna data nie jest początkiem tygodnia ani następną jednostką)
  const [custom, setCustom] = useState(() => def !== nextFrom && !weeks.some((w) => w.first === def));
  const [daysText, setDaysText] = useState(String(preset?.days ?? 7));
  const parsed = parseDays(daysText);
  const valid = parsed != null && parsed !== 0 && parsed >= MIN_DAYS && parsed <= MAX_DAYS;
  const days = valid ? parsed! : 0;
  const rows = shiftPreview(plan, from, days, sessions);
  const total = rows.reduce((a, r) => a + r.count, 0);
  const selValue = custom ? '__custom' : from === nextFrom ? '__next' : from;

  const run = async () => {
    if (!rows.length) return;
    const before = plan;
    if (!(await apply(savePlan(db, shiftPlanFrom(plan, from, days, sessions))))) return;
    toast(`Przesunięto ${total} ${plural(total, 'jednostkę', 'jednostki', 'jednostek')} o ${nDays(days)} (od ${fmtShort(from)}).`, {
      label: 'Cofnij',
      run: () => void apply([put('plans', before)], 'Cofnięto przesunięcie planu.'),
    });
    onClose();
  };

  if (!weeks.length) {
    return (
      <div className="pt-panel">
        <p className="muted small">Jednostki planu nie mają dni ani dat — ustaw je w edytorze planu, wtedy da się przesunąć plan.</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Zamknij
        </button>
      </div>
    );
  }

  return (
    <div className="pt-panel" role="group" aria-label="Przesuń plan">
      <div className="pt-panel-head">
        <strong>Przesuń resztę planu</strong>
        <span className="muted small">Jednostki od wybranego dnia przesuną się o tyle samo; wcześniejsze i już zrobione zostają.</span>
      </div>
      <div className="pt-form">
        <Field label="Od">
          <select
            className="input"
            value={selValue}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '__custom') return setCustom(true);
              setCustom(false);
              setFrom(v === '__next' ? nextFrom! : v);
            }}
          >
            {nextFrom && <option value="__next">Następna jednostka · {fmtWeekdayDate(nextFrom)}</option>}
            {weeks.map((w) => (
              <option key={w.name + w.first} value={w.first}>
                {w.name} · od {fmtWeekdayDate(w.first)}
              </option>
            ))}
            <option value="__custom">Inna data…</option>
          </select>
        </Field>
        {custom && (
          <Field label="Od dnia">
            <input className="input" type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} autoFocus />
          </Field>
        )}
        <Field label="O ile dni" hint={!valid && daysText.trim() ? `Liczba od ${signed(MIN_DAYS)} do ${signed(MAX_DAYS)}, bez zera` : 'Minus = wcześniej'}>
          <input className={`input pt-days ${!valid && daysText.trim() ? 'is-invalid' : ''}`} type="text" inputMode="numeric" enterKeyHint="done" aria-invalid={!valid && !!daysText.trim()} value={daysText} placeholder="np. 7 albo -2" onChange={(e) => setDaysText(e.target.value.replace(/[^\d+\-−–]/g, '').slice(0, 4))} />
        </Field>
      </div>
      <div className="pt-chips" role="group" aria-label="Szybki wybór dni">
        {DAY_CHIPS.map((n) => (
          <button key={n} type="button" className={`chip pt-daychip ${days === n ? 'active' : ''}`} aria-pressed={days === n} aria-label={`${n > 0 ? 'Później' : 'Wcześniej'} o ${nDays(n)}`} onClick={() => setDaysText(String(n))}>
            {signed(n)}
          </button>
        ))}
        <button
          type="button"
          className={`chip ${days === 7 && from === weekStart(from) ? 'active' : ''}`}
          onClick={() => {
            setDaysText('7');
            setFrom(weekStart(from));
            setCustom(!weeks.some((w) => w.first === weekStart(from)) && weekStart(from) !== nextFrom);
          }}
        >
          Wstaw tydzień przerwy
        </button>
      </div>
      {rows.length ? (
        <ul className="pt-preview" aria-label="Podgląd przesunięcia">
          {rows.slice(0, 8).map((r) => (
            <li key={r.week} aria-label={`${r.week}: ${fmtShort(r.from)} na ${fmtShort(r.to)}`}>
              <span>{r.week}:</span> <span className="pt-num">{fmtShort(r.from)}</span> <span aria-hidden="true">→</span>{' '}
              <span className="pt-num">{fmtShort(r.to)}</span>
              {r.count > 1 && <span className="muted small"> · {r.count} jedn.</span>}
            </li>
          ))}
          {rows.length > 8 && <li className="muted small">i {rows.length - 8} kolejne tygodnie</li>}
        </ul>
      ) : (
        <p className="muted small">{valid ? 'Od tego dnia nie ma już niewykonanych jednostek planu.' : 'Wpisz liczbę dni albo wybierz z listy.'}</p>
      )}
      <div className="pt-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Anuluj
        </button>
        <button type="button" className="btn btn-primary btn-sm" disabled={!rows.length} onClick={() => void run()}>
          Przesuń {total ? `${total} ${plural(total, 'jednostkę', 'jednostki', 'jednostek')}` : ''}
        </button>
      </div>
    </div>
  );
}

/** Szybkie „Przesuń od dziś” przy „następny”: drugie stuknięcie wybiera +1 dzień / +2 dni / tydzień i od razu zapisuje (z cofnięciem). */
export function QuickShift({ plan, sessions }: { plan: Plan; sessions?: TrainingSession[] }) {
  const { db, apply, toast } = useStore();
  const [open, setOpen] = useState(false);
  const today = todayISO();
  if (!shiftPreview(plan, today, 1, sessions).length) return null;
  const go = async (days: number) => {
    const rows = shiftPreview(plan, today, days, sessions);
    const total = rows.reduce((a, r) => a + r.count, 0);
    const before = plan;
    setOpen(false);
    if (!(await apply(savePlan(db, shiftPlanFrom(plan, today, days, sessions))))) return;
    toast(`Przesunięto ${total} ${plural(total, 'jednostkę', 'jednostki', 'jednostek')} o ${nDays(days)} (od dziś).`, {
      label: 'Cofnij',
      run: () => void apply([put('plans', before)], 'Cofnięto przesunięcie planu.'),
    });
  };
  if (!open)
    return (
      <button type="button" className="btn btn-ghost btn-sm pt-quick" aria-expanded={false} onClick={() => setOpen(true)} title="Przesuń niewykonane jednostki od dziś (np. podopieczny dziś nie może)">
        <Icon name="cal" size={16} /> Przesuń od dziś
      </button>
    );
  return (
    <span className="pt-quick-row" role="group" aria-label="Przesuń od dziś o">
      {[
        [1, '+1 dzień'],
        [2, '+2 dni'],
        [7, '+tydzień'],
      ].map(([n, t]) => (
        <button key={n} type="button" className="chip pt-daychip" onClick={() => void go(n as number)}>
          {t}
        </button>
      ))}
      <button type="button" className="icon-btn" aria-label="Anuluj przesunięcie" onClick={() => setOpen(false)}>
        <Icon name="x" size={16} />
      </button>
    </span>
  );
}

const TAG: Record<LoadSuggestion['kind'], { tone: 'neutral' | 'warn' | 'muted'; text: (s: LoadSuggestion) => string }> = {
  add: { tone: 'neutral', text: (s) => `dodaj +${kg(s.next - s.last)}` },
  cut: { tone: 'warn', text: () => 'zmniejsz −5%' },
  hold: { tone: 'muted', text: () => 'utrzymaj' },
};

/** Panel „Sugestie na tydzień X”: ciężary na kolejny tydzień z ostatnich wykonań, z wyborem i zastosowaniem w planie. */
export function LoadSuggestPanel({ plan, sessions }: { plan: Plan; sessions: TrainingSession[] }) {
  const { db, apply, toast } = useStore();
  const res = useMemo(() => suggestLoads(plan, sessions, todayISO()), [plan, sessions]);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  if (!res || !res.items.length) return null;
  const week = plan.weeks[res.weekIndex];
  const chosen = picked ?? new Set(res.items.filter((s) => s.applicable && s.kind !== 'hold' && !s.already).map((s) => s.exercise));
  const count = (k: LoadSuggestion['kind']) => res.items.filter((s) => s.kind === k).length;
  const summary = [count('add') && `${count('add')} × dodaj`, count('cut') && `${count('cut')} × zmniejsz`, count('hold') && `${count('hold')} × utrzymaj`].filter(Boolean).join(' · ');
  const title = `Sugestie na tydzień ${res.weekIndex + 1}`;

  const run = async () => {
    const items = res.items.filter((s) => chosen.has(s.exercise) && s.applicable);
    if (!items.length) return;
    const before = plan;
    if (!(await apply(savePlan(db, applySuggestions(plan, res.weekIndex, items))))) return;
    toast(`Zmieniono ciężary w ${week.name}: ${items.map((s) => `${s.exercise} ${kg(s.next)}`).join(', ')}.`, {
      label: 'Cofnij',
      run: () => void apply([put('plans', before)], 'Cofnięto zmianę ciężarów.'),
    });
    setPicked(null);
    setOpen(false);
  };

  return (
    <section className="ls-panel" aria-label={title}>
      <button type="button" className="ls-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="dumbbell" size={18} />
        <span className="ls-title">
          <strong>{title}</strong>
          <span className="muted small">
            {week.name !== `Tydzień ${res.weekIndex + 1}` ? `${week.name} · ` : ''}
            {summary}
          </span>
        </span>
        <span className="ls-toggle">{open ? 'Zwiń' : 'Pokaż'}</span>
      </button>
      {open && (
        <>
          <ul className="ls-list">
            {res.items.map((s) => {
              const on = chosen.has(s.exercise);
              return (
                <li key={s.exercise} className={`ls-row ls-${s.kind}`}>
                  <label className="ls-check">
                    <input
                      type="checkbox"
                      checked={on && s.applicable}
                      disabled={!s.applicable}
                      onChange={() => {
                        const n = new Set(chosen);
                        if (on) n.delete(s.exercise);
                        else n.add(s.exercise);
                        setPicked(n);
                      }}
                    />
                    <span className="ls-name">{s.exercise}</span>
                  </label>
                  <Tag tone={TAG[s.kind].tone} outline={s.kind === 'add'}>{TAG[s.kind].text(s)}</Tag>
                  <span className="ls-load">
                    <span className="pt-num">{kg(s.last)}</span>
                    {s.next !== s.last && (
                      <>
                        {' '}
                        <span aria-hidden="true">→</span> <span className="pt-num ls-next">{kg(s.next)}</span>
                      </>
                    )}
                  </span>
                  <p className="ls-why small">
                    {s.why}
                    {s.already && s.kind !== 'hold' && s.planned != null && <span className="muted"> W planie na ten tydzień już {kg(s.planned)}.</span>}
                    {!s.applicable && <span className="muted"> Ciężar w planie liczony z % — zmień w edytorze.</span>}
                  </p>
                </li>
              );
            })}
          </ul>
          <div className="pt-actions">
            <span className="muted small">Na podstawie ostatnich treningów (do 6 tyg.) i celu z planu.</span>
            <button type="button" className="btn btn-primary btn-sm" disabled={![...chosen].some((n) => res.items.some((s) => s.exercise === n && s.applicable))} onClick={() => void run()}>
              Zastosuj zaznaczone
            </button>
          </div>
        </>
      )}
    </section>
  );
}
