import { useEffect, useState, type DragEvent } from 'react';
import { Icon, Seg, Tag } from '../components/ui';
import type { Appointment, AppointmentStatus, ISODate, Plan, PlanWorkout, TrainingSession } from '../domain';
import { clientById, extraState, groupOf, isSolo, type ExtraState } from '../data/ops';
import { useStore } from '../data/store';
import { fmtMonth, fmtShort, fmtWeekday } from '../format';
import { clashes, clientHue } from '../lib/calendar';
import { addDays, todayISO, weekStart } from '../lib/dates';
import { useNav } from '../nav';
import { workoutDate } from '../lib/plan';
import { LocationTag, locStyle } from '../components/location';
import { put } from '../data/db';
import { canMove, moveVisit } from '../lib/calendarMove';

/** Przeciąganie wizyt (komputer, mysz): typ danych przeciągania i czy urządzenie ma precyzyjny wskaźnik. */
const DRAG_TYPE = 'application/x-fitowa-appt';
const finePointer = () => typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;

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

type Mode = 'Dzień' | 'Tydzień' | 'Miesiąc';
const WHO = ['Wszyscy', 'Ze mną', 'Samodzielnie'] as const;
type Who = (typeof WHO)[number];

export function CalendarView() {
  const { db, apply, ask, toast } = useStore();
  const [dropDay, setDropDay] = useState<ISODate | null>(null);
  const { openModal } = useNav();
  const today = todayISO();
  // telefon: domyślnie jeden dzień (tydzień przy wielu podopiecznych to bardzo długa strona)
  const [mode, setMode] = useState<Mode>(() => (typeof matchMedia === 'function' && matchMedia('(max-width: 720px)').matches ? 'Dzień' : 'Tydzień'));
  const [anchor, setAnchor] = useState<ISODate>(today);
  const [locSel, setLoc] = useState('');
  // kto: wszyscy / treningi ze mną (wizyty) / samodzielne — wybór zapamiętany na tym urządzeniu
  const [who, setWhoState] = useState<Who>(() => {
    try {
      const v = localStorage.getItem('fitowa-cal-who');
      return v === 'Ze mną' || v === 'Samodzielnie' ? v : 'Wszyscy';
    } catch {
      return 'Wszyscy';
    }
  });
  const setWho = (v: Who) => {
    setWhoState(v);
    try {
      localStorage.setItem('fitowa-cal-who', v);
    } catch {
      // bez zapamiętania
    }
  };
  // telefon: tydzień przewija się do wybranego dnia (domyślnie dziś), a nie od poniedziałku
  useEffect(() => {
    if (mode !== 'Tydzień' || !matchMedia('(max-width: 720px)').matches) return;
    const el = document.querySelector<HTMLElement>(`.week-day[data-date="${anchor}"]`) ?? document.querySelector<HTMLElement>('.week-day.is-today');
    if (el && el.previousElementSibling) el.scrollIntoView({ block: 'start' });
  }, [mode, anchor]);
  // Filtr usuniętego miejsca nie może dalej ukrywać wizyt.
  const loc = db.locations.some((l) => l.id === locSel) ? locSel : '';

  const shift = (dir: number) => {
    if (mode === 'Dzień') setAnchor(addDays(anchor, dir));
    else if (mode === 'Tydzień') setAnchor(addDays(anchor, 7 * dir));
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
    if (who === 'Samodzielnie') return [];
    const list = db.appointments.filter((a) => a.date === date && inLoc(a.locationId));
    const rep = (a: Appointment) => {
      if (!a.groupId) return true;
      const g = list.filter((x) => x.groupId === a.groupId);
      return (g.find((x) => x.status !== 'cancel') ?? g[0]).id === a.id;
    };
    return list.filter(rep).sort((a, b) => a.time.localeCompare(b.time));
  };
  const linked = new Set(db.appointments.map((a) => a.sessionId).filter(Boolean));
  const looseOn = (date: ISODate) =>
    db.sessions.filter((s) => s.date === date && !linked.has(s.id) && inLoc(s.locationId) && (who === 'Wszyscy' || (who === 'Samodzielnie') === isSolo(db, s)));
  // treningi zadane na dzień (poza planem), jeszcze niewykonane — przerywana ramka
  const assigned: Assigned[] = db.plans
    .filter((p) => p.extra && db.clients.some((c) => c.id === p.clientId && c.status === 'aktywny' && inLoc(c.locationId)))
    .flatMap((p) => p.weeks.flatMap((w) => w.workouts).filter((k) => k.date).map((k) => ({ plan: p, workout: k, state: extraState(k, p.id, db.sessions.filter((s) => s.clientId === p.clientId), today).state })))
    .filter((x) => x.state !== 'done');
  // treningi z aktywnego planu na dni ustawione przez trenera — do zrobienia (bez wizyty tego dnia)
  for (const p of db.plans.filter((x) => x.active && !x.extra && db.clients.some((c) => c.id === x.clientId && c.status === 'aktywny' && inLoc(c.locationId)))) {
    const done = new Set(db.sessions.filter((x) => x.planId === p.id && x.workoutId).map((x) => x.workoutId));
    p.weeks.forEach((w, wi) =>
      w.workouts.forEach((k) => {
        const d = workoutDate(p, wi, k);
        if (!d || done.has(k.id) || !k.exercises.some((e) => e.name.trim())) return;
        if (db.appointments.some((a) => a.clientId === p.clientId && a.date === d && a.status !== 'cancel')) return;
        assigned.push({ plan: p, workout: { ...k, date: d }, state: d < today ? 'overdue' : 'due', fromPlan: true });
      }),
    );
  }
  // zadane poza planem robi się samodzielnie — nie w widoku „Ze mną”
  const assignedOn = (date: ISODate) => (who === 'Ze mną' ? [] : assigned.filter((x) => x.workout.date === date));

  /** Upuszczenie wizyty na inny dzień: ta sama godzina; para razem; seria — pytanie „Ta i następne?”. */
  const moveTo = async (id: string, date: ISODate) => {
    const a = db.appointments.find((x) => x.id === id);
    if (!a || !canMove(a) || a.date === date) return;
    const later = !!a.seriesId && db.appointments.some((x) => x.seriesId === a.seriesId && x.date > a.date && x.status === 'planned');
    const all = later && (await ask('To wizyta cykliczna. Przesunąć też kolejne zaplanowane wizyty z tej serii o tyle samo dni?', { confirm: 'Ta i następne', cancel: 'Tylko ta', danger: false }));
    const changes = moveVisit(db, a, date, a.time, all);
    const ids = changes.map((c) => (c as { item: Appointment }).item.id);
    const before = db.appointments.filter((x) => ids.includes(x.id));
    const clash = clashes({ ...a, date }, db.appointments.filter((x) => !ids.includes(x.id)));
    if (!(await apply(changes))) return;
    const who = clientById(db, a.clientId)?.name.split(' ')[0] ?? 'Wizyta';
    toast(
      `${who}: przeniesiono na ${fmtWeekday(date)} ${fmtShort(date)}, ${a.time}${all ? ` (i ${ids.length - 1} kolejne)` : ''}.${clash.length ? ` Uwaga: kolizja z ${clash.map((c) => `${clientById(db, c.clientId)?.name.split(' ')[0] ?? '—'} ${c.time}`).join(', ')}.` : ''}`,
      { label: 'Cofnij', run: () => void apply(before.map((x) => put('appointments', x)), 'Cofnięto przeniesienie.') },
    );
  };
  const dropProps = (date: ISODate) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dropDay !== date) setDropDay(date);
    },
    onDragLeave: (e: DragEvent) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDropDay((d) => (d === date ? null : d));
    },
    onDrop: (e: DragEvent) => {
      const id = e.dataTransfer.getData(DRAG_TYPE);
      setDropDay(null);
      if (!id) return;
      e.preventDefault();
      void moveTo(id, date);
    },
  });

  const ws = weekStart(anchor);
  const title =
    mode === 'Dzień' ? `${fmtWeekday(anchor)} ${fmtShort(anchor)}` : mode === 'Tydzień' ? `${fmtShort(ws)} – ${fmtShort(addDays(ws, 6))}` : fmtMonth(anchor.slice(0, 7));

  return (
    <div className="page page-wide fade">
      <div className="page-head">
        <h2>Kalendarz</h2>
        <div className="cal-controls">
          <Seg options={['Dzień', 'Tydzień', 'Miesiąc'] as const} value={mode} onChange={setMode} label="Widok" />
          <Seg options={WHO} value={who} onChange={setWho} label="Kto trenuje" />
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

      {mode === 'Dzień' && (
        // pasek tygodnia: szybki wybór dnia, kropka = coś zaplanowane
        <div className="day-strip" role="tablist" aria-label="Dzień tygodnia">
          {Array.from({ length: 7 }, (_, i) => addDays(ws, i)).map((date) => {
            const n = apptsOn(date).length + looseOn(date).length + assignedOn(date).length;
            return (
              <button key={date} type="button" role="tab" aria-selected={date === anchor} className={`day-strip-btn ${date === anchor ? 'active' : ''} ${date === today ? 'is-today' : ''}`} onClick={() => setAnchor(date)} aria-label={`${fmtWeekday(date)} ${fmtShort(date)}${n ? `, ${n}` : ''}`}>
                <span>{fmtWeekday(date).slice(0, 2)}</span>
                <b>{Number(date.slice(8))}</b>
                <i>{n || ''}</i>
              </button>
            );
          })}
        </div>
      )}
      {mode !== 'Miesiąc' ? (
        <div className={`week ${mode === 'Dzień' ? 'week-one' : ''}`}>
          {(mode === 'Dzień' ? [anchor] : Array.from({ length: 7 }, (_, i) => addDays(ws, i))).map((date) => (
            <section key={date} data-date={date} className={`week-day ${date === today ? 'is-today' : ''} ${dropDay === date ? 'drop-over' : ''}`} {...dropProps(date)}>
              <header>
                <span className="first-cap">{fmtWeekday(date)}</span> <strong>{fmtShort(date)}</strong>
                <button className="icon-btn icon-btn-sm" aria-label={`Dodaj wizytę ${fmtShort(date)}`} onClick={() => openModal({ kind: 'appt', date })}>
                  <Icon name="plus" size={14} />
                </button>
              </header>
              <div className="week-items">
                {apptsOn(date).map((a) => (
                  <ApptTile key={a.id} a={a} onDragEnd={() => setDropDay(null)} />
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
            setMode(matchMedia('(max-width: 720px)').matches ? 'Dzień' : 'Tydzień');
          }}
        />
      )}
      <p className="muted small legend-note">
        Kolor paska = podopieczny · kropka = miejsce · „sam” = trening samodzielny (kropkowany pasek) · przerywana ramka = zadany do zrobienia
      </p>
    </div>
  );
}

function ApptTile({ a, onDragEnd }: { a: Appointment; onDragEnd?: () => void }) {
  const { db } = useStore();
  const { openModal } = useNav();
  const c = clientById(db, a.clientId);
  const partners = groupOf(db.appointments, a).filter((x) => x.id !== a.id && x.status !== 'cancel');
  // para: status każdej osoby osobno (nieobecność jednej nie wyszarza całej wizyty)
  const all = [a, ...partners];
  const mixed = partners.length > 0 && all.some((x) => x.status !== a.status);
  const status = mixed && all.some((x) => x.status === 'planned') ? 'planned' : a.status;
  const first = (id: string) => clientById(db, id)?.name.split(' ')[0] ?? '—';
  const clash = a.status === 'planned' && clashes(a, db.appointments).length > 0;
  // komputer: wizytę zaplanowaną można przeciągnąć na inny dzień (godzina zostaje)
  const drag = !!onDragEnd && canMove(a) && finePointer();
  const [dragging, setDragging] = useState(false);
  return (
    <button
      className={`tile tile-${status} ${clash ? 'tile-clash' : ''} ${a.status === 'planned' && a.date < todayISO() ? 'tile-overdue' : ''} ${drag ? 'tile-draggable' : ''} ${dragging ? 'is-dragging' : ''}`}
      style={hueStyle(a.clientId)}
      title={clash ? 'Kolizja z inną wizytą o tej porze' : drag ? 'Przeciągnij na inny dzień, by przesunąć wizytę' : undefined}
      draggable={drag || undefined}
      onDragStart={
        drag
          ? (e) => {
              e.dataTransfer.setData(DRAG_TYPE, a.id);
              e.dataTransfer.setData('text/plain', `${c?.name ?? ''} ${a.time}`);
              e.dataTransfer.effectAllowed = 'move';
              setDragging(true);
            }
          : undefined
      }
      onDragEnd={
        drag
          ? () => {
              setDragging(false);
              onDragEnd?.();
            }
          : undefined
      }
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
      <span className="tile-meta">
        <LocationTag id={a.locationId} short />
        {mixed ? (
          <span className="tile-status">{all.filter((x) => x.status !== 'planned').map((x) => `${first(x.clientId)}: ${APPT_STATUS[x.status].label.toLowerCase()}`).join(', ')}</span>
        ) : (
          a.status !== 'planned' && <span className="tile-status">{APPT_STATUS[a.status].label}</span>
        )}
      </span>
    </button>
  );
}

function SessionTile({ s }: { s: TrainingSession }) {
  const { db } = useStore();
  const { openModal } = useNav();
  const c = clientById(db, s.clientId);
  // ten sam wygląd co odbyta wizyta: godzina zapisu, podopieczny, miejsce, nazwa treningu
  const time = s.createdAt ? new Date(s.createdAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '';
  const solo = isSolo(db, s);
  return (
    <button className={`tile tile-done ${solo ? 'tile-solo' : ''}`} style={hueStyle(s.clientId)} onClick={() => openModal({ kind: 'session', session: s })}>
      <span className="tile-time">
        {time || 'Trening'} <span className={`who-badge ${solo ? 'solo' : 'with'}`}>{solo ? 'sam' : 'ze mną'}</span>
      </span>
      <span className="tile-name">{c?.name ?? '—'}</span>
      <span className="tile-meta">
        <LocationTag id={s.locationId} short />
        <span className="tile-status">{s.workoutName || 'Trening'}</span>
      </span>
    </button>
  );
}

interface Assigned {
  plan: Plan;
  workout: PlanWorkout;
  state: ExtraState['state'];
  /** Jednostka z planu (dzień ustawiony w planie), nie trening poza planem. */
  fromPlan?: boolean;
}

/** Trening zadany na ten dzień (jeszcze niewykonany) — otwiera jego edycję. */
function AssignedTile({ x }: { x: Assigned }) {
  const { db } = useStore();
  const { openModal } = useNav();
  const c = clientById(db, x.plan.clientId);
  return (
    <button className={`tile tile-loose ${x.state === 'overdue' ? 'tile-loose-overdue' : ''}`} style={hueStyle(x.plan.clientId)} onClick={() => openModal({ kind: 'plan', plan: x.plan, focusWorkoutId: x.workout.id })} title={x.fromPlan ? 'Trening z planu na ten dzień — kliknij, by zmienić plan' : 'Trening zadany poza planem — kliknij, by zmienić'}>
      <span className="tile-time">
        {x.fromPlan ? 'z planu · ' : ''}
        {x.state === 'overdue' ? 'zaległy' : 'do zrobienia'}
      </span>
      <span className="tile-name">{c?.name ?? '—'}</span>
      <span className="tile-meta">
        <span className="tile-status">{x.workout.name}</span>
      </span>
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
                <span key={s.id} className={`month-item tile-done ${isSolo(db, s) ? 'tile-solo' : ''}`} style={hueStyle(s.clientId)}>
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
