import type { ISODate, Session } from './types';

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function toISODate(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayISO(): ISODate {
  return toISODate(new Date());
}

function parseISO(iso: ISODate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** „13.10.2026” */
export function formatDate(iso: ISODate): string {
  return parseISO(iso).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** „13.10” */
export function formatShortDate(iso: ISODate): string {
  return parseISO(iso).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
}

/** „wtorek, 13 października 2026” */
export function formatLongDate(iso: ISODate): string {
  return parseISO(iso).toLocaleDateString('pl-PL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function formatMoney(amount: number): string {
  return amount.toLocaleString('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' zł';
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

export function sessionKey(s: Pick<Session, 'date' | 'time'>): string {
  return `${s.date}T${s.time}`;
}

export function compareSessions(a: Session, b: Session): number {
  return sessionKey(a).localeCompare(sessionKey(b));
}

/** Najbliższa zaplanowana sesja (od dziś włącznie). */
export function nextSession(sessions: Session[]): Session | undefined {
  const today = todayISO();
  return sessions
    .filter((s) => s.status === 'Zaplanowana' && s.date >= today)
    .sort(compareSessions)[0];
}

export function normalize(s: string): string {
  return s.toLocaleLowerCase('pl-PL').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
}
