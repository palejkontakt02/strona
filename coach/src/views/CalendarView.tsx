import { useEffect, useState } from 'react';
import { Icon, Seg, Tag } from '../components/ui';
import type { Appointment, AppointmentStatus, ISODate, Plan, PlanWorkout, TrainingSession } from '../domain';
import { clientById, extraState, groupOf, isSolo, type ExtraState } from '../data/ops';
import { useStore } from '../data/store';
import { fmtMonth, fmtShort, fmtWeekday } from '../format';
import { clashes, clientHue } from '../lib/calendar';
import { addDays, todayISO, weekStart } from '../lib/dates';
import { useNav } from '../nav';
import { LocationTag, locStyle } from '../components/location';

export const APPT_STATUS: Record<AppointmentStatus, { label: string; tone: 'neutral' | 'ok' | 'muted' | 'warn' }> = {
  planned: { label: 'Zaplanowana', tone: 'neutral' },
  done: { label: 'Odbyta', tone: 'ok' },
  cancel: { label: 'Odwołana', tone: 'muted' },
  noshow: { label: 'Nieobecność', tone: 'warn' },
};

export function ApptStatusTag({ status }: { status: AppointmentStatus }) {
  const s = APPT_STATUS[status];
  return <Tag tone={s.tone}>{s.label}</Tag>;
}

export const hueStyle = (clientId: string) => ({ '--hue': clientHue(clientId) }) as React.CSSProperties;

type Mode = 'Tydzień' | 'Miesiąc';

export function CalendarView() {
  const { db } = useStore();
  const { openModal } = useNav();
  const today = todayISO();
  const [mode, setMode] = useState<Mode>('Tydzień');
  const [anchor, setAnchor] = useState<ISODate>(today);
  const [locSel, setLoc] = useState('');
  // telefon: tydzień przewija się do wybranego dnia (domyślnie dziś), a nie od poniedziałku
  useEffect(() => {
    if (mode !== 'Tydzień' || !matchMedia('(max-width: 720px)').matches) return;
    const el = document.querySelector<HTMLElement>(`.week-day[data-date="${anchor}"]`) ?? document.querySelector<HTMLElement>('.week-day.is-today');
    if (el && el.previousElementSibling) el.scrollIntoView({ block: 'start' });
  }, [mode, anchor]);
  // Filtr usuniętego miejsca nie może dalej ukrywać wizyt.
  const loc = db.locations.some((l) => l.id === locSel) ? locSel : '';

  const shift = (dir: number) => {
    if (mode === 'Tydzień') setAnchor(addDays(anchor, 7 * dir));
    else {
      const d = new Date(anchor + 'T12:00:00');
      d.setDate(1);
      d.setMonth(d.getMonth() + dir);
      setAnchor(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
    }
  };

  const inLoc = (id?: string) => !loc || id === loc;
  // para / grupa = jeden kafelek (pierwsza wizyta z grupy, pozostałe osoby w nim)
  const apptsOn = (date: ISODate) => {
    const list = db.appointments.filter((a) => a.date === date && inLoc(a.locationId));
    const rep = (a: Appointment) => {
      if (!a.groupId) return true;
      const g = list.filter((x) => x.groupId === a.groupId);
      return (g.find((x) => x.status !== 'cancel') ?? g[0]).id === a.id;
    };
    return list.filter(rep).sort((a, b) => a.time.localeCompare(b.time));
  };
  const linked = new Set(db.appointments.map((a) => a.sessionId).filter(Boolean));
  const looseOn = (date: ISODate) => db.sessions.filter((s) => s.date === date && !linked.has(s.id) && inLoc(s.locationId));
  // treningi zadane na dzień (poza planem), jeszcze niewykonane — przerywana ramka
  const assigned: Assigned[] = db.plans
    .filter((p) => p.extra && db.clients.some((c) => c.id === p.clientId && c.status === 'aktywny' && inLoc(c.locationId)))
    .flatMap((p) => p.weeks.flatMap((w) => w.workouts).filter((k) => k.date).map((k) => ({ plan: p, workout: k, state: extraState(k, p.id, db.sessions.filter((s) => s.clientId === p.clientId), today).state })))
    .filter((x) => x.state !== 'done');
  const assignedOn = (date: ISODate) => assigned.filter((x) => x.workout.date === date);

  const ws = weekStart(anchor);
  const title =
    mode === 'Tydzień' ? `${fmtShort(ws)} – ${fmtShort(addDays(ws, 6))}` : fmtMonth(anchor.slice(0, 7));

  return (
    <div className="page page-wide fade">
      <div className="page-head">
        <h2>Kalendarz</h2>
        <div className="cal-controls">
          <Seg options={['Tydzień', 'Miesiąc'] as const} value={mode} onChange={setMode} label="Widok" />
          <div className="cal-nav">
            <button className="icon-btn" aria-label="Poprzedni" onClick={() => shift(-1)}>
              <Icon name="chevL" />
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setAnchor(today)}>
              Dziś
            </button>
            <button className="icon-btn" aria-label="Następny" onClick={() => shift(1)}>
              <Icon name="chevR" />
            </button>
            <strong className="cal-title first-cap">{title}</strong>
          </div>
          {db.locations.length > 1 && (
            <div className="loc-filter" role="radiogroup" aria-label="Miejsce">
              <button type="button" role="radio" aria-checked={!loc} className={!loc ? 'active' : ''} onClick={() => setLoc('')}>
                Wszystkie
              </button>
              {db.locations.map((l) => (
                <button key={l.id} type="button" role="radio" aria-checked={loc === l.id} className={loc === l.id ? 'active' : ''} style={locStyle(l)} onClick={() => setLoc(loc === l.id ? '' : l.id)}>
                  <i /> {l.name.replace(/\s*\(.*?\)/, '')}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {mode === 'Tydzień' ? (
        <div className="week">
          {Array.from({ length: 7 }, (_, i) => addDays(ws, i)).map((date) => (
            <section key={date} data-date={date} className={`week-day ${date === today ? 'is-today' : ''}`}>
              <header>
                <span className="first-cap">{fmtWeekday(date)}</span> <strong>{fmtShort(date)}</strong>
                <button className="icon-btn icon-btn-sm" aria-label={`Dodaj wizytę ${fmtShort(date)}`} onClick={() => openModal({ kind: 'appt', date })}>
                  <Icon name="plus" size={14} />
                </button>
              </header>
              <div className="week-items">
                {apptsOn(date).map((a) => (
                  <ApptTile key={a.id} a={a} />
                ))}
                {looseOn(date).map((s) => (
                  <SessionTile key={s.id} s={s} />
                ))}
                {assignedOn(date).map((x) => (
                  <AssignedTile key={x.workout.id} x={x} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <MonthGrid
          anchor={anchor}
          today={today}
          apptsOn={apptsOn}
          looseOn={looseOn}
          assignedOn={assignedOn}
          onPickDay={(d) => {
            setAnchor(d);
            setMode('Tydzień');
          }}
        />
      )}
      <p className="muted small legend-note">
        Kolor paska = podopieczny · kropka = miejsce · przerywana ramka = trening zadany do zrobienia (poza planem)
      </p>
    </div>
  );
}

function ApptTile({ a }: { a: Appointment }) {
  const { db } = useStore();
  const { openModal } = useNav();
  const c = clientById(db, a.clientId);
  const partners = groupOf(db.appointments, a).filter((x) => x.id !== a.id && x.status !== 'cancel');
  const clash = a.status === 'planned' && clashes(a, db.appointments).length > 0;
  return (
    <button
      className={`tile tile-${a.status} ${clash ? 'tile-clash' : ''} ${a.status === 'planned' && a.date < todayISO() ? 'tile-overdue' : ''}`}
      style={hueStyle(a.clientId)}
      title={clash ? 'Kolizja z inną wizytą o tej porze' : undefined}
      onClick={() => openModal({ kind: 'appt', appt: a })}
    >
      <span className="tile-time">
        {clash && <span className="clash-mark" aria-label="Kolizja">⚠ </span>}
        {a.time}
        {a.seriesId && <span title="Wizyta cykliczna"> ↻</span>}
      </span>
      <span className="tile-name">
        {partners.length ? `👥 ${[c, ...partners.map((x) => clientById(db, x.clientId))].map((x) => x?.name.split(' ')[0] ?? '—').join(' + ')}` : c?.name ?? '—'}
      </span>
      <LocationTag id={a.locationId} short />
      {a.status !== 'planned' && <span className="tile-status">{APPT_STATUS[a.status].label}</span>}
    </button>
  );
}

function SessionTile({ s }: { s: TrainingSession }) {
  const { db } = useStore();
  const { openModal } = useNav();
  const c = clientById(db, s.clientId);
  // ten sam wygląd co odbyta wizyta: godzina zapisu, podopieczny, miejsce, nazwa treningu
  const time = s.createdAt ? new Date(s.createdAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <button className="tile tile-done" style={hueStyle(s.clientId)} onClick={() => openModal({ kind: 'session', session: s })}>
      <span className="tile-time">{time || 'Trening'}</span>
      <span className="tile-name">{c?.name ?? '—'}</span>
      <LocationTag id={s.locationId} short />
      <span className="tile-status">
        {s.workoutName || 'Trening'}
        {isSolo(db, s) ? ' · samodzielnie' : ''}
      </span>
    </button>
  );
}

interface Assigned {
  plan: Plan;
  workout: PlanWorkout;
  state: ExtraState['state'];
}

/** Trening zadany na ten dzień (jeszcze niewykonany) — otwiera jego edycję. */
function AssignedTile({ x }: { x: Assigned }) {
  const { db } = useStore();
  const { openModal } = useNav();
  const c = clientById(db, x.plan.clientId);
  return (
    <button className="tile tile-loose" style={hueStyle(x.plan.clientId)} onClick={() => openModal({ kind: 'plan', plan: x.plan, focusWorkoutId: x.workout.id })} title="Trening zadany poza planem — kliknij, by zmienić">
      <span className="tile-time">{x.state === 'overdue' ? 'zaległy' : 'do zrobienia'}</span>
      <span className="tile-name">{c?.name ?? '—'}</span>
      <span className="tile-status">{x.workout.name}</span>
    </button>
  );
}

function MonthGrid({
  anchor,
  today,
  apptsOn,
  looseOn,
  assignedOn,
  onPickDay,
}: {
  anchor: ISODate;
  today: ISODate;
  apptsOn: (d: ISODate) => Appointment[];
  looseOn: (d: ISODate) => TrainingSession[];
  assignedOn: (d: ISODate) => Assigned[];
  onPickDay: (d: ISODate) => void;
}) {
  const { db } = useStore();
  const first = anchor.slice(0, 7) + '-01';
  const start = weekStart(first);
  const days: ISODate[] = [];
  for (let d = start; days.length < 42; d = addDays(d, 1)) days.push(d);
  while (days.length > 35 && days[days.length - 7].slice(0, 7) !== first.slice(0, 7)) days.splice(-7);
  return (
    <div className="month">
      {['pon', 'wt', 'śr', 'czw', 'pt', 'sob', 'nd'].map((d) => (
        <div key={d} className="month-dow">
          {d}
        </div>
      ))}
      {days.map((d) => {
        const items = apptsOn(d).filter((a) => a.status !== 'cancel');
        const loose = [...looseOn(d), ...assignedOn(d)];
        return (
          <button key={d} className={`month-cell ${d.slice(0, 7) !== first.slice(0, 7) ? 'other' : ''} ${d === today ? 'is-today' : ''}`} onClick={() => onPickDay(d)}>
            <span className="month-num">{Number(d.slice(8))}</span>
            {items.slice(0, 3).map((a) => (
              <span key={a.id} className={`month-item tile-${a.status}`} style={hueStyle(a.clientId)}>
                <span className="hide-mobile">{a.time} </span>
                {clientById(db, a.clientId)?.name.split(' ')[0]}
              </span>
            ))}
            {loose.slice(0, 1).map((s) =>
              'workout' in s ? (
                <span key={s.workout.id} className="month-item tile-loose" style={hueStyle(s.plan.clientId)}>
                  {clientById(db, s.plan.clientId)?.name.split(' ')[0]}
                </span>
              ) : (
                <span key={s.id} className="month-item tile-done" style={hueStyle(s.clientId)}>
                  {clientById(db, s.clientId)?.name.split(' ')[0]}
                </span>
              ),
            )}
            {items.length + loose.length > Math.min(items.length, 3) + Math.min(loose.length, 1) && (
              <span className="month-more">+{items.length + loose.length - Math.min(items.length, 3) - Math.min(loose.length, 1)}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
