import type { Habit, HabitDay, HabitSchedule, ISODate } from '../domain';
import { addDays } from './dates';

const at = (iso: ISODate) => new Date(`${iso}T12:00:00`);
/** Dzień tygodnia 1 = poniedziałek … 7 = niedziela. */
export const isoWeekday = (iso: ISODate) => ((at(iso).getDay() + 6) % 7) + 1;

export const WEEKDAYS = ['pn', 'wt', 'śr', 'cz', 'pt', 'sb', 'nd'] as const;

/** Czy zadanie obowiązuje danego dnia. */
export function isDue(h: Habit, date: ISODate): boolean {
  if (h.archived && (!h.archivedAt || date >= h.archivedAt)) return false;
  if (h.since && date < h.since) return false;
  const s = h.schedule;
  if (s.kind === 'daily') return true;
  if (s.kind === 'week') return s.days.includes(isoWeekday(date));
  const d = at(date).getDate();
  // „31” w miesiącu, który ma mniej dni → ostatni dzień miesiąca
  const last = new Date(at(date).getFullYear(), at(date).getMonth() + 1, 0).getDate();
  return s.days.includes(d) || (d === last && s.days.some((x) => x > last));
}

export function dueOn(habits: Habit[] | undefined, date: ISODate): Habit[] {
  return (habits ?? []).filter((h) => isDue(h, date));
}

export function doneOn(log: HabitDay[] | undefined, date: ISODate): string[] {
  return log?.find((d) => d.date === date)?.done ?? [];
}

/** Postęp dnia: ile zadań odhaczono z tych, które obowiązują. */
export function dayProgress(habits: Habit[] | undefined, log: HabitDay[] | undefined, date: ISODate): { done: number; total: number } {
  const due = dueOn(habits, date);
  const done = new Set(doneOn(log, date));
  return { done: due.filter((h) => done.has(h.id)).length, total: due.length };
}

/** Postęp z ostatnich `days` dni (łącznie z `today`): odhaczone / wszystkie obowiązujące, dni zamknięte w całości. */
export function rangeProgress(habits: Habit[] | undefined, log: HabitDay[] | undefined, today: ISODate, days: number) {
  let done = 0;
  let total = 0;
  let closed = 0;
  let active = 0;
  const perDay: { date: ISODate; done: number; total: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const p = dayProgress(habits, log, date);
    perDay.push({ date, ...p });
    done += p.done;
    total += p.total;
    if (p.total) {
      active++;
      if (p.done === p.total) closed++;
    }
  }
  return { done, total, closed, active, perDay };
}

/** Seria dni z rzędu, w których zamknięto wszystkie zadania (dzisiejszy, jeszcze niezamknięty dzień nie przerywa serii). */
export function habitStreak(habits: Habit[] | undefined, log: HabitDay[] | undefined, today: ISODate): number {
  let n = 0;
  for (let i = 0; i < 400; i++) {
    const date = addDays(today, -i);
    const p = dayProgress(habits, log, date);
    if (!p.total) continue;
    if (p.done === p.total) n++;
    else if (i === 0) continue;
    else break;
  }
  return n;
}

/** Zmienia odhaczenie zadania w danym dniu (zwraca nową listę dla tego dnia). */
export function toggleDone(log: HabitDay[] | undefined, date: ISODate, id: string): string[] {
  const cur = doneOn(log, date);
  return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
}

/** Ustawia dzień w dzienniku (zachowuje ostatnie 400 dni). */
export function withDay(log: HabitDay[] | undefined, date: ISODate, done: string[]): HabitDay[] {
  return [...(log ?? []).filter((d) => d.date !== date), { date, done }].sort((a, b) => a.date.localeCompare(b.date)).slice(-400);
}

export function scheduleLabel(s: HabitSchedule): string {
  if (s.kind === 'daily') return 'codziennie';
  if (s.kind === 'week') {
    if (s.days.length === 7) return 'codziennie';
    if (s.days.length === 5 && [1, 2, 3, 4, 5].every((d) => s.days.includes(d))) return 'pn–pt';
    return [...s.days].sort((a, b) => a - b).map((d) => WEEKDAYS[d - 1]).join(', ');
  }
  return `w dni miesiąca: ${[...s.days].sort((a, b) => a - b).join(', ')}`;
}

/**
 * Seria jednego zadania: ile obowiązujących dni z rzędu odhaczono (dni, w których zadanie nie obowiązuje,
 * nie przerywają serii; dzisiejszy, jeszcze nieodhaczony dzień też nie).
 */
export function habitItemStreak(h: Habit, log: HabitDay[] | undefined, today: ISODate): number {
  const byDate = new Map((log ?? []).map((d) => [d.date, d.done]));
  let n = 0;
  for (let i = 0; i < 400; i++) {
    const date = addDays(today, -i);
    if (h.since && date < h.since) break;
    if (!isDue(h, date)) continue;
    if (byDate.get(date)?.includes(h.id)) n++;
    else if (i === 0) continue;
    else break;
  }
  return n;
}

/**
 * Zgodność jednego zadania w ostatnich `days` dniach (łącznie z dziś): odhaczone / obowiązujące.
 * Dzisiejszy dzień liczy się tylko, gdy zadanie już odhaczono (trwający dzień nie zaniża wyniku).
 * `pct` = null, gdy w tym okresie zadanie ani razu nie obowiązywało.
 */
export function habitRate(h: Habit, log: HabitDay[] | undefined, today: ISODate, days: number): { done: number; total: number; pct: number | null } {
  const byDate = new Map((log ?? []).map((d) => [d.date, d.done]));
  let done = 0;
  let total = 0;
  for (let i = 0; i < days; i++) {
    const date = addDays(today, -i);
    if (!isDue(h, date)) continue;
    const ok = !!byDate.get(date)?.includes(h.id);
    if (i === 0 && !ok) continue;
    total++;
    if (ok) done++;
  }
  return { done, total, pct: total ? done / total : null };
}

/** Gotowe zadania do wyboru przez trenera (białko — z celu dziennego, jeśli jest ustawiony). */
export function habitLibrary(proteinTarget?: number): { key: string; title: string }[] {
  return [
    { key: 'water', title: 'Woda 2 l' },
    { key: 'steps', title: '8 000 kroków' },
    { key: 'sleep', title: 'Sen 7 h' },
    { key: 'protein', title: `Białko ${proteinTarget ? Math.round(proteinTarget) : 120} g` },
    { key: 'veg', title: '5 porcji warzyw i owoców' },
    { key: 'stretch', title: 'Rozciąganie 10 min' },
    { key: 'alcohol', title: 'Bez alkoholu' },
  ];
}
