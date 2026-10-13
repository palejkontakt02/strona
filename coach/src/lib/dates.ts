import type { ISODate } from '../domain';

const pad = (n: number) => String(n).padStart(2, '0');

function fromISO(iso: ISODate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toISO(d: Date): ISODate {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Dzisiejsza data w lokalnej strefie czasowej. */
export function todayISO(now = new Date()): ISODate {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(iso: ISODate, n: number): ISODate {
  const d = fromISO(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((fromISO(to).getTime() - fromISO(from).getTime()) / 86_400_000);
}

/** Poniedziałek tygodnia, w którym wypada data. */
export function weekStart(iso: ISODate): ISODate {
  const wd = (fromISO(iso).getUTCDay() + 6) % 7;
  return addDays(iso, -wd);
}

/** „HH:MM” → minuty od północy. */
export function toMinutes(time: string): number {
  const [h, m] = (time || '0:0').split(':').map(Number);
  return h * 60 + m;
}
