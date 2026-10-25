import type { Appointment, ApptReply } from '../domain';

/** Odwołanie krócej niż tyle godzin przed wizytą = późne (trening może przepaść / zostać pobrany z pakietu). */
export const CANCEL_HOURS = 24;

export const WARSAW = 'Europe/Warsaw';

/** Przesunięcie strefy (minuty, np. 60 zimą, 120 latem) w danej chwili. */
export function tzOffsetMin(at: Date, timeZone = WARSAW): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(at)
      .filter((x) => x.type !== 'literal')
      .map((x) => [x.type, Number(x.value)]),
  ) as Record<string, number>;
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** Początek wizyty (data i godzina w czasie polskim) jako chwila. */
export function apptStart(a: Pick<Appointment, 'date' | 'time'>): Date {
  const [y, m, d] = a.date.split('-').map(Number);
  const [hh, mm] = /^\d{1,2}:\d{2}$/.test(a.time) ? a.time.split(':').map(Number) : [0, 0];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // dwa przybliżenia wystarczą także przy zmianie czasu
  let t = guess - tzOffsetMin(new Date(guess)) * 60000;
  t = guess - tzOffsetMin(new Date(t)) * 60000;
  return new Date(t);
}

/** Godziny do wizyty (ujemne — już się zaczęła). */
export const hoursUntil = (a: Pick<Appointment, 'date' | 'time'>, now = new Date()) => (apptStart(a).getTime() - now.getTime()) / 3600000;

/** Odwołanie teraz byłoby późne (krócej niż 24 h przed). */
export const isLateCancel = (a: Pick<Appointment, 'date' | 'time'>, now = new Date()) => hoursUntil(a, now) < CANCEL_HOURS;

/** Wizyta po odpowiedzi podopiecznego (to samo robi funkcja w bazie — sekcja 23). */
export function apptWithReply(a: Appointment, kind: ApptReply['kind'], reason?: string, now = new Date()): Appointment {
  const why = (reason ?? '').trim().slice(0, 300);
  const late = kind === 'cancel' && isLateCancel(a, now);
  const reply: ApptReply = { kind, at: now.toISOString(), ...(kind === 'cancel' && why ? { reason: why } : {}), ...(late ? { late: true } : {}) };
  return { ...a, reply, ...(kind === 'cancel' ? { status: 'cancel' as const } : {}) };
}

/** Do pokazania trenerowi w kalendarzu: potwierdzona (zielony ✓) / odwołana przez podopiecznego (bursztyn). */
export function apptReplyState(a: Appointment): 'confirmed' | 'cancelled' | 'cancelled-late' | null {
  if (!a.reply) return null;
  if (a.reply.kind === 'confirm') return a.status === 'planned' || a.status === 'done' ? 'confirmed' : null;
  return a.reply.late ? 'cancelled-late' : 'cancelled';
}
