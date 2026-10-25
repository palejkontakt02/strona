import type { ISODate } from '../domain';
import { addDays, weekStart } from './dates';

/** Stan dnia na pasku tygodnia (Pn–Nd) na ekranie „Dziś”. */
export type DayState = 'done' | 'planned' | 'rest';
export interface StripDay {
  date: ISODate;
  /** „Pn”, „Wt”… */
  label: string;
  state: DayState;
  today: boolean;
}

const DOW = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb', 'Nd'];

/** Tydzień od poniedziałku: zrobione (trening zapisany) > zaplanowane > odpoczynek. */
export function weekStrip(today: ISODate, doneDates: Iterable<ISODate>, plannedDates: Iterable<ISODate>): StripDay[] {
  const done = new Set(doneDates);
  const planned = new Set(plannedDates);
  const ws = weekStart(today);
  return DOW.map((label, i) => {
    const date = addDays(ws, i);
    return { date, label, today: date === today, state: done.has(date) ? 'done' : planned.has(date) ? 'planned' : 'rest' };
  });
}

/**
 * Termin jednostki z planu względem dziś. „overdue” tylko gdy termin faktycznie minął
 * i od tego dnia nie było żadnego treningu z tego planu (kto trenuje po kolei, nie jest „zaległy”,
 * nawet jeśli daty planu rozjechały się z kalendarzem). Inaczej: „upcoming” (dziś / później) albo null.
 */
export function planDue(date: ISODate | null | undefined, today: ISODate, sessions: { planId?: string; date: ISODate }[], planId: string | undefined): 'overdue' | 'upcoming' | null {
  if (!date) return null;
  if (date >= today) return 'upcoming';
  if (sessions.some((s) => s.planId === planId && s.date >= date)) return null;
  return 'overdue';
}

export type Advice = { tone: 'ok' | 'neutral' | 'warn'; tag: string; text: string; lighter: boolean };

/** Krótka rada po check-inie: porównanie z normą (gdy jest) albo z progiem 2,5/5. */
export function checkinAdvice(r: number | null, norm: number | null): Advice | null {
  if (r == null) return null;
  if (r <= 2.5) return { tone: 'warn', tag: 'słabo', text: 'Zrób lżej: mniej serii albo ciężar o RPE niżej. Ból lub zawroty głowy — nie trenuj i napisz do trenera.', lighter: true };
  if (norm == null) return { tone: 'neutral', tag: 'zapisane', text: 'Porównanie z Twoją normą pojawi się po kilku dniach wpisów.', lighter: false };
  const d = r - norm;
  if (d >= 0.25) return { tone: 'ok', tag: 'lepiej niż zwykle', text: 'Jesteś w formie — trenuj zgodnie z planem.', lighter: false };
  if (d > -0.25) return { tone: 'neutral', tag: 'jak zwykle', text: 'Trenuj zgodnie z planem.', lighter: false };
  if (d > -0.5) return { tone: 'neutral', tag: 'trochę gorzej', text: 'Nie forsuj ciężarów, jeśli serie idą ciężko.', lighter: false };
  return { tone: 'warn', tag: 'gorzej niż zwykle', text: 'Zrób lżej: mniej serii albo ciężar o RPE niżej i daj znać trenerowi.', lighter: true };
}

/** Indeks tygodnia planu, od którego lista jest rozwinięta (tydzień następnej jednostki); wcześniejsze = minione. */
export function firstOpenWeek(weeks: { workouts: { id: string }[] }[], nextId: string | undefined): number {
  if (!nextId) return 0;
  const i = weeks.findIndex((w) => w.workouts.some((k) => k.id === nextId));
  return i < 0 ? 0 : i;
}
