import type { Appointment, ISODate } from '../domain';
import { clashes } from './calendar';
import { addDays, toMinutes } from './dates';

/* „Przesuń wizytę” z rozmowy: najbliższa wizyta podopiecznego, szybkie przesunięcia, kolizje, gotowa odpowiedź. */

const pad = (n: number) => String(n).padStart(2, '0');
const nowTime = (now: Date) => `${pad(now.getHours())}:${pad(now.getMinutes())}`;

/** Najbliższa zaplanowana wizyta (od teraz), którą można przesunąć — bez zapisanego treningu. */
export function nextAppointment(appts: Appointment[], clientId: string, today: ISODate, now = new Date()): Appointment | undefined {
  const t = nowTime(now);
  return appts
    .filter((a) => a.clientId === clientId && a.status === 'planned' && !a.sessionId && (a.date > today || (a.date === today && a.time >= t)))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
}

/** Godzina przesunięta o `min` minut; null, gdy wychodzi poza dzień. */
export function shiftTime(time: string, min: number): string | null {
  const m = toMinutes(time) + min;
  if (m < 0 || m > 23 * 60 + 59) return null;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export interface MoveOption {
  key: 'plus1' | 'minus1' | 'tomorrow';
  label: string;
  date: ISODate;
  time: string;
}

/** Szybkie opcje: +1 h, −1 h, „jutro” (dzień później, ta sama godzina). */
export function moveOptions(a: Pick<Appointment, 'date' | 'time'>): MoveOption[] {
  const out: MoveOption[] = [];
  const p = shiftTime(a.time, 60);
  const m = shiftTime(a.time, -60);
  if (p) out.push({ key: 'plus1', label: '+1 h', date: a.date, time: p });
  if (m) out.push({ key: 'minus1', label: '−1 h', date: a.date, time: m });
  out.push({ key: 'tomorrow', label: 'jutro', date: addDays(a.date, 1), time: a.time });
  return out;
}

/** Kolizje nowego terminu z innymi wizytami (partner z pary się nie liczy). */
export function moveClashes(a: Appointment, date: ISODate, time: string, all: Appointment[]): Appointment[] {
  return clashes({ ...a, date, time }, all);
}

const WD = ['niedz.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'];

/** „czw. 18:00”, dla innego tygodnia: „czw. 12.11, 18:00”; dziś / jutro słownie. */
export function whenLabel(date: ISODate, time: string, today: ISODate): string {
  if (date === today) return `dziś ${time}`;
  if (date === addDays(today, 1)) return `jutro ${time}`;
  const d = new Date(`${date}T12:00:00`);
  const wd = WD[d.getDay()];
  const far = date > addDays(today, 6) || date < today;
  return far ? `${wd} ${d.getDate()}.${pad(d.getMonth() + 1)}, ${time}` : `${wd} ${time}`;
}

/** Gotowa odpowiedź po przesunięciu: „Przesunąłem na czw. 18:00 ✓”. */
export function moveReply(date: ISODate, time: string, today: ISODate): string {
  return `Przesunąłem na ${whenLabel(date, time, today)} ✓`;
}
