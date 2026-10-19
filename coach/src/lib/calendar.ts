import type { Appointment } from '../domain';
import { addDays, toMinutes } from './dates';

export const DEFAULT_APPT_MIN = 60;

/** Wizyty kolidujące: nakładające się [time, time+duration) tego samego dnia, z pominięciem odwołanych. */
export function clashes(a: Pick<Appointment, 'id' | 'date' | 'time' | 'duration'> & { groupId?: string }, all: Appointment[]): Appointment[] {
  if (!a.date || !a.time) return [];
  const start = toMinutes(a.time);
  const end = start + (a.duration || DEFAULT_APPT_MIN);
  return all.filter(
    (o) =>
      o.id !== a.id &&
      // partner z tej samej pary / grupy to nie kolizja
      !(a.groupId && o.groupId === a.groupId) &&
      o.date === a.date &&
      o.status !== 'cancel' &&
      !!o.time &&
      toMinutes(o.time) < end &&
      start < toMinutes(o.time) + (o.duration || DEFAULT_APPT_MIN),
  );
}

/** Daty wizyt cyklicznych co tydzień (4–24 tygodnie). */
export function weeklyDates(start: string, weeks: number): string[] {
  const n = Math.min(24, Math.max(1, Math.round(weeks)));
  return Array.from({ length: n }, (_, i) => addDays(start, 7 * i));
}

/** Kolor klienta: hash id → odcień. */
export function clientHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}
