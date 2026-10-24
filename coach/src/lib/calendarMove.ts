import type { Appointment, ISODate } from '../domain';
import { put, type Change, type Db } from '../data/db';
import { groupOf } from '../data/ops';
import { addDays, daysBetween } from './dates';

/** Wizytę można przesunąć: zaplanowana i bez zapisanego treningu. */
export const canMove = (a: Appointment) => a.status === 'planned' && !a.sessionId;

/**
 * Kolejne zaplanowane wizyty z tej serii (także partnerów z pary: seria `${seriesId}:${clientId}`)
 * po dacie `original` — z godziną / czasem / miejscem z `draft` i przesunięte o tyle dni, o ile przesunięto tę wizytę.
 */
export function seriesEdit(db: Db, original: Appointment, draft: Appointment): Change[] {
  if (!original.seriesId) return [];
  const delta = daysBetween(original.date, draft.date);
  const sid = original.seriesId.split(':')[0];
  const later = db.appointments.filter(
    (a) =>
      a.id !== original.id &&
      (a.seriesId === original.seriesId || a.seriesId === sid || (!!a.seriesId && a.seriesId.startsWith(`${sid}:`) && !!original.groupId && a.groupId === original.groupId)) &&
      a.date > original.date &&
      a.status === 'planned' &&
      !a.sessionId,
  );
  return later.map((a) => put('appointments', { ...a, date: addDays(a.date, delta), time: draft.time, duration: draft.duration, locationId: draft.locationId, location: draft.location }));
}

/**
 * Przesunięcie wizyty na inny dzień / godzinę. Para / grupa (groupId) przesuwa się razem;
 * `withSeries` — także kolejne wizyty z serii o tyle samo dni (i na tę samą godzinę).
 */
export function moveVisit(db: Db, appt: Appointment, date: ISODate, time: string, withSeries = false): Change[] {
  const group = groupOf(db.appointments, appt).filter(canMove);
  const moved = (group.length ? group : [appt]).map((a) => ({ ...a, date, time }));
  const changes: Change[] = moved.map((a) => put('appointments', a));
  if (withSeries) {
    const seen = new Set(moved.map((a) => a.id));
    for (const a of group.length ? group : [appt]) {
      for (const ch of seriesEdit(db, a, { ...a, date, time })) {
        const id = (ch as { item: Appointment }).item.id;
        if (!seen.has(id)) {
          seen.add(id);
          changes.push(ch);
        }
      }
    }
  }
  return changes;
}

/** Ile wizyt zostało w pakiecie po odjęciu już zaplanowanych (do „Powtarzaj… do końca pakietu”). */
export function visitsLeftInPackage(db: Db, clientId: string, left: number, today: ISODate): number {
  const planned = db.appointments.filter((a) => a.clientId === clientId && a.status === 'planned' && !a.sessionId && a.date >= today).length;
  return Math.max(0, left - planned);
}
