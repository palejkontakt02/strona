import type { Appointment, Client, ISODate, Measurement, Payment, Plan, PlanWorkout, SetGroup, TrainingSession } from '../domain';
import { fmtDay, plural, uid } from '../format';
import { packageMessage, packageStatus, singleSessionPayment } from '../lib/billing';
import { weeklyDates } from '../lib/calendar';
import { addDays } from '../lib/dates';
import { parseDur, parseKm } from '../lib/running';
import { cardioByName } from '../lib/run';
import { del, put, type Change, type Db } from './db';

/* ---------- selektory ---------- */

/** Wszystkie pomiary: trenera i wpisane przez podopiecznego (bez ukrytych). */
export function allMeasurements(c: Client): Measurement[] {
  return [...c.measurements, ...(c.selfMeasurements ?? []).filter((m) => !m.hidden)];
}

/** Trening zrobiony samodzielnie (stare zapisy: bez rozliczenia i bez wizyty). */
export function isSolo(db: Db, s: TrainingSession): boolean {
  return s.solo ?? (s.charge === 'brak' && !db.appointments.some((a) => a.sessionId === s.id));
}

/** Treningi klienta od najnowszego. */
export function sessionsOf(db: Db, clientId: string): TrainingSession[] {
  // w tym samym dniu nowszy zapis (dalej w tablicy) wyżej
  return db.sessions
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.clientId === clientId)
    .sort((a, b) => b.s.date.localeCompare(a.s.date) || (b.s.createdAt ?? '').localeCompare(a.s.createdAt ?? '') || b.i - a.i)
    .map(({ s }) => s);
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

export interface ExtraState {
  /** done — zadany na dzień i wykonany · overdue — termin minął · due — termin przed nami · open — bez daty (do zrobienia w dowolnym momencie). */
  state: 'done' | 'overdue' | 'due' | 'open';
  /** Data wykonania (done / open: ostatnio) albo termin (due / overdue). */
  date?: ISODate;
}

/** Stan treningu poza planem. Zadany na dzień liczy się jako wykonany, gdy jest zapis od dnia przed terminem. */
export function extraState(k: PlanWorkout, extraId: string | undefined, sessions: TrainingSession[], today: ISODate): ExtraState {
  const done = sessions.filter((s) => s.planId === extraId && s.workoutId === k.id).sort((a, b) => b.date.localeCompare(a.date));
  if (!k.date) return { state: 'open', date: done[0]?.date };
  const since = k.assignedAt && k.assignedAt <= k.date ? k.assignedAt : addDays(k.date, -1);
  const hit = done.find((s) => s.date >= since);
  if (hit) return { state: 'done', date: hit.date };
  return { state: k.date < today ? 'overdue' : 'due', date: k.date };
}

/** Dodaje trening do listy „poza planem” (tworzy listę, jeśli jej nie ma). */
export function addExtraWorkout(db: Db, clientId: string, wo: PlanWorkout): Change[] {
  const extra = extraPlanOf(db, clientId) ?? newExtraPlan(clientId);
  const weeks = extra.weeks.length ? extra.weeks : [{ id: uid(), name: 'Dodatkowe', workouts: [] }];
  return savePlan(db, { ...extra, weeks: weeks.map((w, i) => (i === weeks.length - 1 ? { ...w, workouts: [...w.workouts, wo] } : w)) });
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
  session = { ...session, createdAt: session.createdAt ?? new Date().toISOString() };
  const changes: Change[] = [];

  const appt =
    db.appointments.find((a) => a.id === s.appointmentId) ??
    // trening samodzielny nie „zjada” zaplanowanej wizyty z trenerem tego dnia
    (s.matchAppointment === false || session.solo ? undefined : db.appointments.find((a) => a.clientId === session.clientId && a.date === session.date && a.status === 'planned'));
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

const clock = (min: number) => {
  const t = Math.round(min * 60);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/** Zapis treningu jako jednostka do zrobienia (te same ćwiczenia i serie). */
export function sessionToWorkout(s: TrainingSession): PlanWorkout {
  return {
    id: uid(),
    name: s.workoutName?.trim() || `Trening z ${fmtDay(s.date)}`,
    exercises: s.exercises
      .filter((e) => e.name.trim())
      .map((e) => ({
        id: uid(),
        name: e.name,
        rest: e.rest,
        notes: e.notes,
        perSide: e.perSide,
        cardio: e.cardio,
        groups: e.setsLog?.length
          ? e.setsLog.map((x) => ({
              type: x.warmup ? ('Rozgrzewka' as const) : x.label === 'Schłodzenie' || x.label === 'Przerwa' ? x.label : ('Robocze' as const),
              sets: '1',
              // seria na czas zostaje na czas („60 s”), lewa/prawa jako „30/20”; cardio: czas jak w zegarku (3:05)
              reps: e.cardio
                ? x.reps != null ? (Number.isInteger(x.reps) ? String(x.reps) : clock(x.reps)) : ''
                : x.complex ?? (x.reps != null ? `${x.reps}${x.repsR != null ? `/${x.repsR}` : ''}${x.unit ? ` ${x.unit}` : ''}` : ''),
              // cardio: „ciężar” w planie = dystans (km)
              load: e.cardio ? (x.dist != null ? String(x.dist).replace('.', ',') : '') : x.load != null ? String(x.load) : '',
              // wynik RPE biegu to nie cel na następny raz
              rpe: !e.cardio && x.rpe != null ? String(x.rpe) : '',
            }))
          : [{ type: 'Robocze' as const, sets: e.sets || '1', reps: e.reps ?? '', load: e.load ?? '', rpe: e.rpe ?? '' }],
      })),
  };
}

/**
 * „Oznacz jako niewykonany”: usuwa zapis. Trening spoza planu wraca jako jednostka
 * do „Dodatkowych treningów”, żeby nie zniknął z listy (trening z planu wraca sam).
 */
export function undoSession(db: Db, id: string, removePayment = false): Change[] {
  const changes = deleteSession(db, id, removePayment);
  const s = db.sessions.find((x) => x.id === id);
  if (!s || (s.planId && db.plans.some((p) => p.id === s.planId)) || !s.exercises.some((e) => e.name.trim())) return changes;
  const wo = sessionToWorkout(s);
  // powtórka jednostki z planu — wraca sama przez plan, nie dublujemy jej w dodatkowych
  if (s.workoutName && plansOf(db, s.clientId).some((p) => p.weeks.some((w) => w.workouts.some((k) => k.name === s.workoutName)))) return changes;
  const extra = extraPlanOf(db, s.clientId) ?? newExtraPlan(s.clientId);
  const sig = (k: { exercises: { name: string }[] }) => k.exercises.map((e) => e.name.trim().toLowerCase()).join('|');
  const same = extra.weeks.flatMap((w) => w.workouts).filter((k) => k.name === wo.name);
  if (same.some((k) => sig(k) === sig(wo))) return changes; // ten sam trening już jest na liście
  if (same.length) wo.name = `${wo.name} (${fmtDay(s.date)})`;
  const weeks = extra.weeks.length ? extra.weeks : [{ id: uid(), name: 'Dodatkowe', workouts: [] }];
  changes.push(put('plans', { ...extra, weeks: weeks.map((w, i) => (i === weeks.length - 1 ? { ...w, workouts: [...w.workouts, wo] } : w)) }));
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

/** Wizyty z tego samego terminu w parze / grupie (z tą wizytą włącznie). */
export function groupOf(appts: Appointment[], a: Appointment): Appointment[] {
  if (!a.groupId) return [a];
  const g = appts.filter((x) => x.groupId === a.groupId && x.date === a.date);
  return g.some((x) => x.id === a.id) ? g : [a, ...g];
}

/**
 * Zapis wizyty w parze / grupie: ta wizyta + partnerzy w tym samym terminie (godzina, czas, miejsce, powtarzanie).
 * Każdy ma własną wizytę (status, rozliczenie, trening). Usunięty partner: wizyta zaplanowana bez treningu znika,
 * inaczej zostaje jako zwykła (bez pary).
 */
export function saveGroupAppointments(db: Db, draft: Appointment, partnerIds: string[], repeatWeeks: number, original?: Appointment): Change[] {
  const ids = [...new Set(partnerIds.filter((id) => id && id !== draft.clientId))];
  const before = original ? groupOf(db.appointments, original).filter((x) => x.id !== draft.id) : [];
  if (!ids.length) {
    // bez partnerów — zwykła wizyta; dotychczasowi partnerzy odłączeni
    return [...saveAppointment({ ...draft, groupId: undefined }, repeatWeeks), ...before.flatMap((x) => dropPartner(x))];
  }
  const groupId = draft.groupId ?? original?.groupId ?? uid();
  const main = { ...draft, groupId };
  const changes: Change[] = [];
  if (repeatWeeks > 1) {
    // seria: dla każdego tygodnia osobne wizyty partnerów z tym samym groupId (grupa = groupId + data)
    const seriesId = uid();
    const dates = weeklyDates(main.date, repeatWeeks);
    for (const [i, date] of dates.entries()) {
      changes.push(put('appointments', { ...main, id: i === 0 ? main.id : uid(), date, seriesId }));
      for (const cid of ids) changes.push(put('appointments', { ...main, id: uid(), clientId: cid, date, seriesId: `${seriesId}:${cid}`, sessionId: undefined, status: 'planned', note: undefined }));
    }
    return changes;
  }
  changes.push(put('appointments', main));
  for (const cid of ids) {
    const prev = before.find((x) => x.clientId === cid);
    const same = { date: main.date, time: main.time, duration: main.duration, locationId: main.locationId, location: main.location, groupId };
    changes.push(put('appointments', prev ? { ...prev, ...same } : { ...main, ...same, id: uid(), clientId: cid, status: 'planned', sessionId: undefined, seriesId: undefined, note: undefined }));
  }
  for (const x of before.filter((x) => !ids.includes(x.clientId))) changes.push(...dropPartner(x));
  return changes;
}

function dropPartner(a: Appointment): Change[] {
  return a.status === 'planned' && !a.sessionId ? [del('appointments', a.id)] : [put('appointments', { ...a, groupId: undefined })];
}

/** Zmiana godziny / czasu / miejsca w tej i kolejnych zaplanowanych wizytach serii. */
export function updateSeries(db: Db, appt: Appointment): Change[] {
  if (!appt.seriesId) return [put('appointments', appt)];
  // także partnerzy z tej samej pary / grupy (ich seria: `${seriesId}:${clientId}`)
  const later = db.appointments.filter(
    (a) => (a.seriesId === appt.seriesId || (!!appt.groupId && a.groupId === appt.groupId && a.seriesId?.startsWith(`${appt.seriesId}:`))) && a.id !== appt.id && a.date > appt.date && a.status === 'planned',
  );
  return [
    put('appointments', appt),
    ...later.map((a) => put('appointments', { ...a, time: appt.time, duration: appt.duration, locationId: appt.locationId, location: appt.location })),
  ];
}

/** Usunięcie wizyty albo całej przyszłej części serii. */
export function deleteAppointment(db: Db, appt: Appointment, wholeSeries: boolean, withPartners = false): Change[] {
  // partnerzy z pary: ich zaplanowane wizyty bez treningu (w tym terminie albo w całej serii)
  const partners = withPartners && appt.groupId
    ? db.appointments.filter((a) => a.groupId === appt.groupId && a.id !== appt.id && a.status === 'planned' && !a.sessionId && (wholeSeries ? a.date >= appt.date : a.date === appt.date))
    : [];
  const own = !wholeSeries || !appt.seriesId ? [appt] : db.appointments.filter((a) => a.seriesId === appt.seriesId && a.date >= appt.date && a.status === 'planned');
  return [...own, ...partners.filter((p) => !own.some((o) => o.id === p.id))].map((a) => del('appointments', a.id));
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

export function cloneWeek(w: Plan['weeks'][number], name: string, mode: Progression = 'none'): Plan['weeks'][number] {
  return {
    id: uid(),
    name,
    workouts: w.workouts.map((k) => ({
      ...k,
      id: uid(),
      exercises: k.exercises.map((e) => {
        // bieg / cardio: progresja objętości odcinków (czas, dystans, powtórzenia), nie kilogramów
        if (e.cardio ?? cardioByName(e.name)) return { ...e, id: uid(), groups: e.groups.map((g) => progressCardio(g, mode)) };
        let groups = e.groups.map((g) => progressGroup(g, mode));
        // deload przy seriach rozpisanych pojedynczo: jedna seria robocza mniej
        const work = groups.filter((g) => g.type !== 'Rozgrzewka');
        if (mode === 'deload' && work.length > 1 && work.every((g) => !g.sets || g.sets === '1')) {
          const last = groups.lastIndexOf(work[work.length - 1]);
          groups = groups.filter((_, i) => i !== last);
        }
        return { ...e, id: uid(), groups };
      }),
    })),
  };
}

/** Nazwa kolejnego tygodnia: „Tydzień 1” → „Tydzień N+1” (N = najwyższy numer w planie); inaczej „(kopia)”. */
export function nextWeekName(weeks: { name: string }[], name: string): string {
  const m = name.match(/^(\D*?)(\d+)(\D*)$/);
  if (!m) return `${name} (kopia)`;
  const nums = weeks.map((w) => w.name.match(/^(\D*?)(\d+)/)).filter((x): x is RegExpMatchArray => !!x && x[1] === m[1]).map((x) => parseInt(x[2], 10));
  return `${m[1]}${Math.max(parseInt(m[2], 10), ...nums) + 1}`;
}

export type Progression = 'none' | 'load2' | 'load5' | 'rep' | 'rpe' | 'deload';
export const PROGRESSIONS: [Progression, string][] = [
  ['none', 'bez zmian'],
  ['load2', '+2,5% ciężaru (bieg: ~+5% czasu / dystansu)'],
  ['load5', '+5% ciężaru (bieg: ~+10%)'],
  ['rep', '+1 powtórzenie (bieg: +1 odcinek)'],
  ['rpe', '+0,5 RPE'],
  ['deload', 'deload (−1 seria, −10%, RPE −2)'],
];

const r25 = (v: number) => Math.round(v / 2.5) * 2.5;
const fmtN = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');

/**
 * Odcinek biegu po progresji: +5% / +10% czasu lub dystansu części głównej (zasada ok. 10% tygodniowo),
 * +1 powtórzenie odcinków, +0,5 RPE, deload: −30% objętości i jedno powtórzenie mniej.
 * Rozgrzewka, schłodzenie i trucht zostają bez zmian.
 */
export function progressCardio(g: SetGroup, mode: Progression): SetGroup {
  if (mode === 'none' || g.type !== 'Robocze') return { ...g };
  const out = { ...g };
  const n = parseInt(g.sets || '1', 10) || 1;
  const scale = (f: number) => {
    const d = parseDur(g.reps);
    if (d != null) out.reps = fmtMin(d * f);
    const km = parseKm(g.load);
    // w metrach zostaje w metrach (co 50 m), w km — co 0,1 km
    const meters = /\d\s*m$/i.test(g.load.trim()) || (km != null && !/km/i.test(g.load) && parseFloat(g.load.replace(',', '.')) >= 100);
    if (km != null) out.load = meters || km < 1 ? `${Math.round((km * f * 1000) / 50) * 50} m` : fmtN(Math.round(km * f * 10) / 10);
  };
  const rpe = g.rpe ? parseFloat(g.rpe.replace(',', '.')) : null;
  if (mode === 'load2') scale(1.05);
  else if (mode === 'load5') scale(1.1);
  else if (mode === 'rep') {
    if (n > 1) out.sets = String(n + 1);
    else scale(1.1);
  } else if (mode === 'rpe') {
    if (rpe != null) out.rpe = fmtN(Math.min(10, rpe + 0.5));
  } else if (mode === 'deload') {
    if (n > 2) out.sets = String(n - 1);
    else scale(0.7);
    if (rpe != null) out.rpe = fmtN(Math.max(2, rpe - 1));
  }
  return out;
}

/** Minuty do zapisu w planie: pełne „44”, z sekundami „3:15”. */
function fmtMin(min: number): string {
  const s = Math.round(min * 60 / 5) * 5;
  return s % 60 === 0 ? String(s / 60) : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Seria planu po progresji (kg, % 1RM, powtórzenia, RPE); zapis względny („-10%”) zostaje. */
export function progressGroup(g: SetGroup, mode: Progression): SetGroup {
  if (mode === 'none' || g.type === 'Rozgrzewka') return { ...g };
  const out = { ...g };
  const kg = /^\s*\d+(?:[.,]\d+)?\s*(kg)?\s*$/i.test(g.load) ? parseFloat(g.load.replace(',', '.')) : null;
  const pct = g.load.match(/^\s*(\d+(?:[.,]\d+)?)\s*%\s*$/);
  const pctV = pct ? parseFloat(pct[1].replace(',', '.')) : null;
  const rpe = g.rpe ? parseFloat(g.rpe.replace(',', '.')) : null;
  if (mode === 'load2' || mode === 'load5') {
    const f = mode === 'load2' ? 0.025 : 0.05;
    if (kg != null) out.load = fmtN(Math.max(r25(kg * (1 + f)), kg + 2.5));
    else if (pctV != null) out.load = `${fmtN(pctV + f * 100)}%`;
  } else if (mode === 'rep') {
    if (/^\d+$/.test(g.reps.trim())) out.reps = String(parseInt(g.reps, 10) + 1);
  } else if (mode === 'rpe') {
    if (rpe != null) out.rpe = fmtN(Math.min(10, rpe + 0.5));
  } else if (mode === 'deload') {
    const n = parseInt(g.sets || '1', 10);
    if (Number.isFinite(n) && n > 1) out.sets = String(n - 1);
    if (kg != null) out.load = fmtN(r25(kg * 0.9));
    else if (pctV != null) out.load = `${fmtN(pctV - 10)}%`;
    if (rpe != null) out.rpe = fmtN(Math.max(5, rpe - 2));
  }
  return out;
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
