import type { Appointment, Client, Payment, Plan, TrainingSession } from '../domain';
import { fmtDay, plural, uid } from '../format';
import { packageMessage, packageStatus, singleSessionPayment } from '../lib/billing';
import { weeklyDates } from '../lib/calendar';
import { del, put, type Change, type Db } from './db';

/* ---------- selektory ---------- */

/** Treningi klienta od najnowszego. */
export function sessionsOf(db: Db, clientId: string): TrainingSession[] {
  return db.sessions.filter((s) => s.clientId === clientId).sort((a, b) => b.date.localeCompare(a.date));
}

export function lastSessionDate(db: Db, clientId: string): string | null {
  return sessionsOf(db, clientId)[0]?.date ?? null;
}

/** Plany treningowe klienta (bez listy dodatkowych treningów). */
export function plansOf(db: Db, clientId: string): Plan[] {
  return db.plans.filter((p) => p.clientId === clientId && !p.extra);
}

/** Dodatkowe treningi klienta — jednostki poza planem, które trener może dopisywać w każdej chwili. */
export function extraPlanOf(db: Db, clientId: string): Plan | undefined {
  return db.plans.find((p) => p.clientId === clientId && p.extra);
}

export function newExtraPlan(clientId: string): Plan {
  return { id: uid(), clientId, name: 'Dodatkowe treningi', active: false, extra: true, weeks: [{ id: uid(), name: 'Dodatkowe', workouts: [] }] };
}

export function clientById(db: Db, id: string | null | undefined): Client | undefined {
  return db.clients.find((c) => c.id === id);
}

export interface PaymentRow extends Payment {
  client: Client;
}

export function allPayments(db: Db): PaymentRow[] {
  return db.clients
    .flatMap((client) => client.payments.map((p) => ({ ...p, client })))
    .sort((a, b) => (b.paidDate || b.date).localeCompare(a.paidDate || a.date));
}

export function paymentLabel(p: Payment): string {
  if (p.type === 'pakiet') return p.sessions ? `Pakiet ${p.sessions} ${plural(p.sessions, 'sesja', 'sesje', 'sesji')}` : 'Pakiet';
  if (p.type === 'abonament') {
    const m = p.month ? new Date(p.month + '-15T12:00:00').toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' }) : '';
    return `Abonament ${m}`.trim();
  }
  return p.desc || 'Sesja pojedyncza';
}

/* ---------- treningi ---------- */

export interface SessionSave {
  session: TrainingSession;
  isNew: boolean;
  /** Wizyta, z której zapisywany jest trening. */
  appointmentId?: string;
  /** Szukaj zaplanowanej wizyty z tego dnia, gdy nie podano `appointmentId` (domyślnie tak). */
  matchAppointment?: boolean;
  /** Kwota za sesję pojedynczą. */
  amount?: number;
  paidNow?: boolean;
}

/**
 * Zapis treningu z efektami ubocznymi (spec p. 4):
 * - wizyta → `done` + `sessionId` (wskazana lub planowana tego dnia),
 * - sesja pojedyncza z kwotą → nowa płatność,
 * - pakiet → komunikat o saldzie.
 */
export function saveSession(db: Db, s: SessionSave): { changes: Change[]; message: string } {
  let message = 'Trening zapisany.';
  let session = withClubRate(db, s.session);
  if (!s.isNew) return { changes: [put('sessions', session)], message };
  const changes: Change[] = [];

  const appt =
    db.appointments.find((a) => a.id === s.appointmentId) ??
    (s.matchAppointment === false ? undefined : db.appointments.find((a) => a.clientId === session.clientId && a.date === session.date && a.status === 'planned'));
  if (appt) changes.push(put('appointments', { ...appt, status: 'done', sessionId: session.id }));

  const client = clientById(db, session.clientId);
  if (client && session.charge === 'pojedyncza' && s.amount) {
    const pay = singleSessionPayment(uid(), session.date, s.amount, !!s.paidNow, `Sesja ${fmtDay(session.date)}`);
    session = { ...session, paymentId: pay.id };
    changes.push(put('clients', { ...client, payments: [...client.payments, pay] }));
    message = s.paidNow ? 'Trening zapisany i opłacony.' : 'Trening zapisany, płatność czeka w „Do zapłaty”.';
  }
  if (client && session.charge === 'pakiet') {
    const pk = packageStatus(client, sessionsOf(db, client.id));
    if (pk) message = packageMessage(pk.left);
  }
  return { changes: [put('sessions', session), ...changes], message };
}

/** Trening „przez klub” zapamiętuje stawkę klubu z chwili zapisu (albo zmiany miejsca). */
function withClubRate(db: Db, session: TrainingSession): TrainingSession {
  if (session.charge !== 'klub') {
    if (session.clubRate == null) return session;
    const { clubRate: _drop, ...rest } = session;
    return rest;
  }
  const prev = db.sessions.find((x) => x.id === session.id);
  if (session.clubRate != null && prev?.locationId === session.locationId && prev?.charge === 'klub') return session;
  const loc = db.locations.find((l) => l.id === session.locationId && l.kind === 'klub');
  return { ...session, clubRate: loc?.clubRate };
}

/** Problem z rozliczeniem „przez klub”: miejsce musi być klubem. */
export function chargeProblem(db: Db, charge: string, locationId?: string): string | null {
  if (charge !== 'klub') return null;
  if (!db.locations.some((l) => l.id === locationId && l.kind === 'klub')) return 'Rozliczenie „przez klub” wymaga miejsca, które jest klubem. Wybierz klub albo zmień rozliczenie.';
  return null;
}

/** Płatność utworzona przy zapisie treningu (sesja pojedyncza), jeśli nadal istnieje. */
export function sessionPayment(db: Db, s: TrainingSession) {
  if (!s.paymentId) return undefined;
  const client = clientById(db, s.clientId);
  const payment = client?.payments.find((p) => p.id === s.paymentId);
  return client && payment ? { client, payment } : undefined;
}

/** Usunięcie treningu; powiązana wizyta wraca do `planned`, opcjonalnie znika też jego płatność. */
export function deleteSession(db: Db, id: string, removePayment = false): Change[] {
  const changes: Change[] = [del('sessions', id)];
  const s = db.sessions.find((x) => x.id === id);
  const sp = s && removePayment ? sessionPayment(db, s) : undefined;
  if (sp) changes.push(put('clients', { ...sp.client, payments: sp.client.payments.filter((p) => p.id !== sp.payment.id) }));
  for (const a of db.appointments.filter((x) => x.sessionId === id)) {
    const { sessionId: _drop, ...rest } = a;
    changes.push(put('appointments', { ...rest, status: 'planned' }));
  }
  return changes;
}

/* ---------- kalendarz ---------- */

/** Zapis wizyty; dla nowej z powtarzaniem tworzy serię co tydzień. */
export function saveAppointment(appt: Appointment, repeatWeeks: number): Change[] {
  if (repeatWeeks <= 1) return [put('appointments', appt)];
  const seriesId = uid();
  return weeklyDates(appt.date, repeatWeeks).map((date, i) =>
    put('appointments', { ...appt, id: i === 0 ? appt.id : uid(), date, seriesId }),
  );
}

/** Usunięcie wizyty albo całej przyszłej części serii. */
export function deleteAppointment(db: Db, appt: Appointment, wholeSeries: boolean): Change[] {
  if (!wholeSeries || !appt.seriesId) return [del('appointments', appt.id)];
  return db.appointments
    .filter((a) => a.seriesId === appt.seriesId && a.date >= appt.date && a.status === 'planned')
    .map((a) => del('appointments', a.id));
}

/* ---------- plany ---------- */

/** Zapis planu; aktywny może być tylko jeden plan klienta. */
export function savePlan(db: Db, plan: Plan): Change[] {
  const changes: Change[] = [put('plans', { ...plan, updatedAt: new Date().toISOString() })];
  if (plan.active && !plan.extra) {
    for (const o of db.plans.filter((p) => p.clientId === plan.clientId && p.id !== plan.id && p.active && !p.extra)) {
      changes.push(put('plans', { ...o, active: false }));
    }
  }
  return changes;
}

/** Głęboka kopia planu z nowymi id (duplikat planu). */
export function clonePlan(plan: Plan, name: string): Plan {
  return {
    ...plan,
    id: uid(),
    name,
    active: false,
    updatedAt: new Date().toISOString(),
    weeks: plan.weeks.map((w) => cloneWeek(w, w.name)),
  };
}

export function cloneWeek(w: Plan['weeks'][number], name: string): Plan['weeks'][number] {
  return {
    id: uid(),
    name,
    workouts: w.workouts.map((k) => ({
      ...k,
      id: uid(),
      exercises: k.exercises.map((e) => ({ ...e, id: uid(), groups: e.groups.map((g) => ({ ...g })) })),
    })),
  };
}

/* ---------- płatności ---------- */

export function setPaymentStatus(client: Client, paymentId: string, paid: boolean, today: string): Change {
  return put('clients', {
    ...client,
    payments: client.payments.map((p) =>
      p.id === paymentId ? { ...p, status: paid ? 'paid' : 'due', paidDate: paid ? today : undefined } : p,
    ),
  });
}
