import type { DayLog, DayTargets, ISODate } from '../domain';
import { addDays } from './dates';

export type MacroKey = 'kcal' | 'protein' | 'fat' | 'carbs';

/** klucz, etykieta, skrót, jednostka, maks. */
export const MACROS: [MacroKey, string, string, string, number][] = [
  ['kcal', 'Kalorie', 'kcal', 'kcal', 10000],
  ['protein', 'Białko', 'B', 'g', 600],
  ['fat', 'Tłuszcze', 'T', 'g', 600],
  ['carbs', 'Węglowodany', 'W', 'g', 1500],
];

/** Czy w dniu jest jakikolwiek wpis o jedzeniu (makro albo zrzut). */
export const hasFood = (l?: DayLog) => !!l && (MACROS.some(([k]) => l[k] != null) || !!l.shot);

export type MacroStatus = 'none' | 'ok' | 'low' | 'high';

/**
 * Wykonanie względem celu: „low” gdy wyraźnie poniżej (< 80% celu), „high” gdy wyraźnie powyżej
 * (> 120% celu; białka powyżej celu nie oznaczamy). Brak celu albo wpisu → „none”.
 */
export function macroStatus(key: MacroKey, value: number | undefined, target: number | undefined): MacroStatus {
  if (!target || value == null) return 'none';
  const r = value / target;
  if (r < 0.8) return 'low';
  if (key !== 'protein' && r > 1.2) return 'high';
  return 'ok';
}

export const hasMacroTargets = (t?: DayTargets) => !!t && MACROS.some(([k]) => (t[k] ?? 0) > 0);

/** Ostatnie `days` dni (od dziś wstecz) z wpisem dnia albo bez. */
export function lastDays(log: DayLog[] | undefined, today: ISODate, days: number): { date: ISODate; log?: DayLog }[] {
  const by = new Map((log ?? []).map((l) => [l.date, l]));
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, -i);
    return { date, log: by.get(date) };
  });
}

export interface WeekAvg {
  /** Pierwszy i ostatni dzień tygodnia (okna 7 dni wstecz od dziś). */
  from: ISODate;
  to: ISODate;
  /** Dni z wpisem jedzenia. */
  days: number;
  avg: Partial<Record<MacroKey, number>>;
}

/**
 * Średnie z kolejnych okien 7-dniowych (najpierw bieżący tydzień: dziś i 6 dni wcześniej).
 * Średnia każdego makro tylko z dni, w których je wpisano — dni bez wpisu nie zaniżają średniej.
 */
export function weeklyAverages(log: DayLog[] | undefined, today: ISODate, weeks = 2): WeekAvg[] {
  const all = lastDays(log, today, weeks * 7);
  return Array.from({ length: weeks }, (_, w) => {
    const chunk = all.slice(w * 7, w * 7 + 7);
    const avg: Partial<Record<MacroKey, number>> = {};
    for (const [k] of MACROS) {
      const vals = chunk.map((d) => d.log?.[k]).filter((v): v is number => v != null);
      if (vals.length) avg[k] = vals.reduce((a, v) => a + v, 0) / vals.length;
    }
    return { from: chunk[chunk.length - 1].date, to: chunk[0].date, days: chunk.filter((d) => hasFood(d.log)).length, avg };
  });
}

/** Kalorie z makro (4/4/9 kcal na g) — podpowiedź, gdy podopieczny wpisał makro bez kcal. */
export function kcalFromMacros(l: Pick<DayLog, 'protein' | 'fat' | 'carbs'>): number | null {
  if (l.protein == null && l.fat == null && l.carbs == null) return null;
  return Math.round((l.protein ?? 0) * 4 + (l.carbs ?? 0) * 4 + (l.fat ?? 0) * 9);
}
