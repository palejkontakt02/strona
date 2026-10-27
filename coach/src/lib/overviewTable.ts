import type { Appointment, Client, ISODate, TrainingSession } from '../domain';
import { isOverdue, packageStatus, PACKAGE_WARN_AT } from './billing';
import { reportExpected, reportFor, reportWeek, trainerUnread } from './comms';
import { addDays, daysBetween } from './dates';
import { dayProgress, rangeProgress } from './habits';
import { weeklyAverages } from './nutrition';
import { readiness } from './wellness';

/* Tabela wszystkich podopiecznych (panel Klienci): jeden wiersz = jeden aktywny podopieczny. */

export type Tone = 'warn' | 'danger' | undefined;

export interface OverviewRow {
  id: string;
  name: string;
  /** Dni od ostatniego treningu (null — jeszcze nie trenował). */
  lastDays: number | null;
  lastTone: Tone;
  /** Najbliższa zaplanowana wizyta. */
  next: { date: ISODate; time: string } | null;
  /** Ile treningów zostało w pakiecie (null — nie rozlicza się pakietem). */
  pkgLeft: number | null;
  pkgTone: Tone;
  /** Suma zaległych płatności (zł). */
  overdue: number;
  /** Ostatnie samopoczucie (średnia 1–5) i czy wyraźnie spadło względem poprzednich. */
  wellness: number | null;
  wellnessDrop: boolean;
  /** Średnio z 7 dni względem celu: kalorie i białko (0–1+), null — brak celu albo wpisów. */
  kcalPct: number | null;
  proteinPct: number | null;
  foodTone: Tone;
  /** Zadania dzienne z 7 dni (0–1), null — brak zadań. */
  habitsPct: number | null;
  habitsTone: Tone;
  /** Raport tygodniowy za bieżący tydzień raportu. */
  report: 'sent' | 'missing' | 'off';
  unread: number;
  /** Coś wymaga uwagi trenera (którykolwiek sygnał bursztynowy / czerwony). */
  attention: boolean;
}

export interface OverviewInput {
  clients: Client[];
  sessions: TrainingSession[];
  appointments: Appointment[];
}

/** Ostatnie odczyty samopoczucia (check-iny + wellness z treningów, jeden na dzień), od najstarszego. */
export function wellnessReadings(c: Pick<Client, 'checkins'>, sessions: TrainingSession[], from: ISODate, to: ISODate): { date: ISODate; v: number }[] {
  const by = new Map<string, number>();
  for (const s of sessions) {
    const v = readiness(s.wellness);
    if (v != null && s.date >= from && s.date <= to) by.set(s.date, v);
  }
  // check-in z danego dnia ma pierwszeństwo przed wellness z treningu
  for (const ch of c.checkins ?? []) {
    const v = readiness(ch);
    if (v != null && ch.date >= from && ch.date <= to) by.set(ch.date, v);
  }
  return [...by.entries()].map(([date, v]) => ({ date, v })).sort((a, b) => a.date.localeCompare(b.date));
}

/** Spadek: ostatni odczyt co najmniej 0,5 pkt poniżej średniej z (do 4) wcześniejszych z 28 dni. */
export const WELLNESS_DROP = 0.5;
export function wellnessTrend(c: Pick<Client, 'checkins'>, sessions: TrainingSession[], today: ISODate): { last: number | null; lastDate: ISODate | null; base: number | null; drop: boolean } {
  const r = wellnessReadings(c, sessions, addDays(today, -28), today);
  if (!r.length) return { last: null, lastDate: null, base: null, drop: false };
  const last = r[r.length - 1];
  const prev = r.slice(-5, -1);
  const base = prev.length ? prev.reduce((a, x) => a + x.v, 0) / prev.length : null;
  return { last: last.v, lastDate: last.date, base, drop: base != null && last.v <= base - WELLNESS_DROP };
}

/** Zadania z 7 dni: dni zamknięte do wczoraj + to, co już odhaczone dziś (trwający dzień nie zaniża wyniku). */
export function habits7(c: Pick<Client, 'habits' | 'habitLog'>, today: ISODate): number | null {
  if (!(c.habits ?? []).length) return null;
  const r = rangeProgress(c.habits, c.habitLog, addDays(today, -1), 6);
  const t = dayProgress(c.habits, c.habitLog, today);
  const total = r.total + t.done;
  return total ? (r.done + t.done) / total : null;
}

/** Jedzenie z 7 dni względem celu (średnia z dni z wpisem). */
export function food7(c: Pick<Client, 'dayLog' | 'targets'>, today: ISODate): { kcal: number | null; protein: number | null; tone: Tone } {
  const w = weeklyAverages(c.dayLog, today, 1)[0];
  const kt = c.targets?.kcal;
  const pt = c.targets?.protein;
  const kcal = kt && w.avg.kcal != null ? w.avg.kcal / kt : null;
  const protein = pt && w.avg.protein != null ? w.avg.protein / pt : null;
  const far = (kcal != null && (kcal < 0.75 || kcal > 1.25)) || (protein != null && protein < 0.75);
  const off = (kcal != null && (kcal < 0.9 || kcal > 1.1)) || (protein != null && protein < 0.9);
  return { kcal, protein, tone: far ? 'danger' : off ? 'warn' : undefined };
}

export function overviewRow(c: Client, input: OverviewInput, today: ISODate): OverviewRow {
  const sessions = input.sessions.filter((s) => s.clientId === c.id);
  const last = sessions.reduce<string | null>((a, s) => (s.date <= today && (!a || s.date > a) ? s.date : a), null);
  const lastDays = last ? daysBetween(last, today) : null;
  const lastTone: Tone = lastDays == null ? undefined : lastDays > 14 ? 'danger' : lastDays > 7 ? 'warn' : undefined;
  const nextA = input.appointments
    .filter((a) => a.clientId === c.id && a.status === 'planned' && a.date >= today)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
  const pk = c.billing === 'pakiet' || !c.billing ? packageStatus(c, sessions) : null;
  const pkgLeft = pk ? pk.left : null;
  const pkgTone: Tone = pkgLeft == null ? undefined : pkgLeft <= 0 ? 'danger' : pkgLeft <= PACKAGE_WARN_AT ? 'warn' : undefined;
  const overdue = (c.payments ?? []).filter((p) => isOverdue(p, today)).reduce((a, p) => a + p.amount, 0);
  const wt = wellnessTrend(c, sessions, today);
  const food = food7(c, today);
  const habitsPct = habits7(c, today);
  const habitsTone: Tone = habitsPct == null ? undefined : habitsPct < 0.5 ? 'danger' : habitsPct < 0.8 ? 'warn' : undefined;
  const report = reportExpected(c) ? (reportFor(c, reportWeek(today)) ? 'sent' : 'missing') : 'off';
  const unread = trainerUnread(c);
  const attention = !!(lastTone || pkgTone || overdue > 0 || wt.drop || food.tone || habitsTone || unread > 0 || report === 'missing');
  return {
    id: c.id,
    name: c.name,
    lastDays,
    lastTone,
    next: nextA ? { date: nextA.date, time: nextA.time } : null,
    pkgLeft,
    pkgTone,
    overdue,
    wellness: wt.last,
    wellnessDrop: wt.drop,
    kcalPct: food.kcal,
    proteinPct: food.protein,
    foodTone: food.tone,
    habitsPct,
    habitsTone,
    report,
    unread,
    attention,
  };
}

/** Wiersze aktywnych podopiecznych (alfabetycznie). */
export function overviewRows(input: OverviewInput, today: ISODate): OverviewRow[] {
  return input.clients
    .filter((c) => c.status === 'aktywny')
    .map((c) => overviewRow(c, input, today))
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'));
}

export type SortKey = 'name' | 'last' | 'next' | 'pkg' | 'overdue' | 'wellness' | 'food' | 'habits' | 'report' | 'unread';

/** Wartość do sortowania; null zawsze na końcu. */
function sortValue(r: OverviewRow, k: SortKey): string | number | null {
  switch (k) {
    case 'name':
      return r.name;
    case 'last':
      return r.lastDays;
    case 'next':
      return r.next ? r.next.date + r.next.time : null;
    case 'pkg':
      return r.pkgLeft;
    case 'overdue':
      return r.overdue || null;
    case 'wellness':
      return r.wellness;
    case 'food':
      return r.kcalPct ?? r.proteinPct;
    case 'habits':
      return r.habitsPct;
    case 'report':
      return r.report === 'off' ? null : r.report === 'missing' ? 0 : 1;
    case 'unread':
      return r.unread || null;
  }
}

/** Domyślny kierunek po kliknięciu nagłówka: to, co pilniejsze, na górze. */
export const DEFAULT_DIR: Record<SortKey, 'asc' | 'desc'> = {
  name: 'asc',
  last: 'desc',
  next: 'asc',
  pkg: 'asc',
  overdue: 'desc',
  wellness: 'asc',
  food: 'asc',
  habits: 'asc',
  report: 'asc',
  unread: 'desc',
};

export function sortRows(rows: OverviewRow[], key: SortKey, dir: 'asc' | 'desc'): OverviewRow[] {
  const m = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va == null && vb == null) return a.name.localeCompare(b.name, 'pl');
    if (va == null) return 1;
    if (vb == null) return -1;
    const c = typeof va === 'string' && typeof vb === 'string' ? va.localeCompare(vb, 'pl') : (va as number) - (vb as number);
    return c * m || a.name.localeCompare(b.name, 'pl');
  });
}
