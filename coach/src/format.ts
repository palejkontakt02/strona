import type { ISODate, YearMonth } from './domain';
import { daysBetween, todayISO } from './lib/dates';

const at = (iso: ISODate) => new Date(iso + 'T12:00:00');

/** 13.10.2026 */
export const fmtDate = (iso?: ISODate) =>
  iso ? at(iso).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
/** 13 paź */
export const fmtDay = (iso?: ISODate) => (iso ? at(iso).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' }) : '—');
/** 13.10 */
export const fmtShort = (iso: ISODate) => at(iso).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
/** wtorek, 13 października */
export const fmtLong = (iso: ISODate) => at(iso).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
/** wt */
export const fmtWeekday = (iso: ISODate) => at(iso).toLocaleDateString('pl-PL', { weekday: 'short' });
/** październik 2026 */
export const fmtMonth = (ym: YearMonth) => at(ym + '-15').toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });

export const pln = (n?: number) => (Number(n) || 0).toLocaleString('pl-PL', { maximumFractionDigits: 2 }) + ' zł';
/** Liczba z przecinkiem i `d` miejscami po przecinku. */
export const fx = (v: number, d = 1) => v.toLocaleString('pl-PL', { minimumFractionDigits: d, maximumFractionDigits: d });
/** Liczba z przecinkiem, bez zbędnych zer. */
export const fnum = (v: number | undefined | null, d = 1) =>
  v == null ? '—' : v.toLocaleString('pl-PL', { maximumFractionDigits: d });

export function ago(iso?: ISODate | null): string {
  if (!iso) return 'brak treningów';
  const d = daysBetween(iso, todayISO());
  return d <= 0 ? 'dziś' : d === 1 ? 'wczoraj' : `${d} dni temu`;
}

export function ageOf(dob?: ISODate): number | null {
  if (!dob) return null;
  const d = at(dob);
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--;
  return a;
}

export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const d = n % 10;
  const t = n % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

export function normalize(s: string): string {
  return s.toLocaleLowerCase('pl-PL').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function slugify(s: string): string {
  return normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
