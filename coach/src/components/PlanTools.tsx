import { useMemo, useState } from 'react';
import type { Client, Plan, TrainingSession } from '../domain';
import { put } from '../data/db';
import { savePlan } from '../data/ops';
import { useStore } from '../data/store';
import { fmtShort, plural } from '../format';
import { todayISO, weekStart } from '../lib/dates';
import { applySuggestions, suggestLoads, type LoadSuggestion } from '../lib/loadSuggest';
import { fmtWeekdayDate } from '../lib/planGrid';
import { absenceShift, planDates, shiftPlanFrom, shiftPreview, type Absence } from '../lib/planShift';
import { Field, Icon, Tag } from './ui';

const kg = (v: number) => `${String(Math.round(v * 100) / 100).replace('.', ',')} kg`;
const nDays = (n: number) => `${n} ${plural(Math.abs(n), 'dzień', 'dni', 'dni')}`;

/** Nieobecności klienta (pole dopisuje moduł nieobecności; tu tylko odczyt). */
export const absencesOf = (c: Client) => (c as Client & { absences?: Absence[] }).absences;

/** Bursztynowa informacja: na nieobecność klienta wypadają treningi planu → propozycja przesunięcia. */
export function AbsenceNotice({ client, plan, onShift }: { client: Client; plan: Plan; onShift: (from: string, days: number) => void }) {
  const hit = absenceShift(plan, absencesOf(client), todayISO());
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

/** Panel „Przesuń plan”: od wybranego tygodnia / dnia o N dni, z podglądem dat i cofnięciem. */
export function ShiftPanel({ plan, preset, onClose }: { plan: Plan; preset?: { from: string; days: number }; onClose: () => void }) {
  const { db, apply, toast } = useStore();
  const today = todayISO();
  const weeks = useMemo(() => {
    const ds = planDates(plan);
    return plan.weeks.flatMap((w, wi) => {
      const first = ds.filter((x) => x.wi === wi).map((x) => x.date).sort()[0];
      return first ? [{ name: w.name, first }] : [];
    });
  }, [plan]);
  const def = preset?.from ?? weeks.find((w) => w.first >= today)?.first ?? planDates(plan).map((x) => x.date).filter((d) => d >= today).sort()[0] ?? weeks[0]?.first ?? today;
  const [from, setFrom] = useState(def);
  const [days, setDays] = useState(preset?.days ?? 7);
  const custom = !weeks.some((w) => w.first === from);
  const rows = shiftPreview(plan, from, days);
  const total = rows.reduce((a, r) => a + r.count, 0);

  const run = async () => {
    if (!rows.length) return;
    const before = plan;
    if (!(await apply(savePlan(db, shiftPlanFrom(plan, from, days))))) return;
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
        <span className="muted small">Jednostki od wybranego dnia przesuną się o tyle samo; wcześniejsze zostają.</span>
      </div>
      <div className="pt-form">
        <Field label="Od">
          <select className="input" value={custom ? '' : from} onChange={(e) => e.target.value && setFrom(e.target.value)}>
            {weeks.map((w) => (
              <option key={w.name + w.first} value={w.first}>
                {w.name} · od {fmtWeekdayDate(w.first)}
              </option>
            ))}
            <option value="">Inna data…</option>
          </select>
        </Field>
        {custom && (
          <Field label="Od dnia">
            <input className="input" type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </Field>
        )}
        <Field label="O ile dni">
          <input className="input pt-days" type="number" inputMode="numeric" min={-28} max={84} value={days} onChange={(e) => setDays(Math.max(-28, Math.min(84, Math.round(Number(e.target.value) || 0))))} />
        </Field>
      </div>
      <div className="pt-chips">
        {[1, 2, 3].map((n) => (
          <button key={n} type="button" className={`chip ${days === n ? 'active' : ''}`} aria-pressed={days === n} onClick={() => setDays(n)}>
            +{nDays(n)}
          </button>
        ))}
        <button
          type="button"
          className={`chip ${days === 7 && from === weekStart(from) ? 'active' : ''}`}
          onClick={() => {
            setDays(7);
            setFrom(weekStart(from));
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
        <p className="muted small">{days ? 'Od tego dnia nie ma już jednostek planu.' : 'Wpisz liczbę dni.'}</p>
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

const TAG: Record<LoadSuggestion['kind'], { tone: 'ok' | 'warn' | 'muted'; text: (s: LoadSuggestion) => string }> = {
  add: { tone: 'ok', text: (s) => `dodaj +${kg(s.next - s.last)}` },
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
                  <Tag tone={TAG[s.kind].tone}>{TAG[s.kind].text(s)}</Tag>
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
