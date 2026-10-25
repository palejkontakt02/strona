/**
 * Postępy podopiecznego: trend samopoczucia z check-inów (i wellness zapisanego przy treningu).
 * Skale 1–5, wszędzie „wyżej = lepiej” (mięśnie 5 = świeże, stres 5 = spokój) — patrz lib/wellness.ts.
 */
import type { Checkin, ISODate, TrainingSession, Wellness } from '../domain';
import { addDays, weekStart } from './dates';
import { WELLNESS_ITEMS } from './wellness';

export type WellKey = keyof Wellness;

/** Wartości dzień po dniu: check-in ma pierwszeństwo, bez niego — wellness z treningu tego dnia. */
export function dailyWellness(checkins: Checkin[], sessions: TrainingSession[]): Map<ISODate, Wellness> {
  const m = new Map<ISODate, Wellness>();
  for (const s of sessions) if (s.wellness && !m.has(s.date)) m.set(s.date, s.wellness);
  for (const c of checkins) if (c?.date) m.set(c.date, c);
  return m;
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const valid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 5;

/** Średnia skali z dni [from, to] (włącznie). */
export function meanIn(daily: Map<ISODate, Wellness>, key: WellKey, from: ISODate, to: ISODate): number | null {
  const v: number[] = [];
  for (const [d, w] of daily) if (d >= from && d <= to && valid(w[key])) v.push(w[key]!);
  return mean(v);
}

export interface WellnessWeek {
  /** Poniedziałek tygodnia. */
  week: ISODate;
  avg: Record<WellKey, number | null>;
  /** Ile dni z wpisem. */
  days: number;
}

/** Średnie tygodniowe z ostatnich `weeks` tygodni (do bieżącego włącznie), od najstarszego. */
export function wellnessWeeks(daily: Map<ISODate, Wellness>, today: ISODate, weeks = 8): WellnessWeek[] {
  const w0 = weekStart(today);
  const out: WellnessWeek[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const from = addDays(w0, -7 * i);
    const to = i === 0 ? today : addDays(from, 6);
    let days = 0;
    for (const [d] of daily) if (d >= from && d <= to) days++;
    const avg = Object.fromEntries(WELLNESS_ITEMS.map(([k]) => [k, meanIn(daily, k, from, to)])) as Record<WellKey, number | null>;
    out.push({ week: from, avg, days });
  }
  return out;
}

export type Trend = 'better' | 'same' | 'worse';

export interface WellnessChange {
  key: WellKey;
  /** Średnia z ostatnich 7 dni. */
  now: number;
  /** Średnia z 7 dni sprzed 2 tygodni (dni 14–20 wstecz). */
  before: number;
  diff: number;
  trend: Trend;
  /** Spadek o ≥ 0,5 pkt — warto zwrócić uwagę. */
  attention: boolean;
  text: string;
}

const PHRASES: Record<WellKey, Record<Trend, string>> = {
  sleep: { better: 'sen lepszy', same: 'sen podobny', worse: 'sen gorszy' },
  energy: { better: 'więcej energii', same: 'energia podobna', worse: 'mniej energii' },
  muscle: { better: 'mięśnie mniej obolałe', same: 'mięśnie podobnie', worse: 'mięśnie bardziej obolałe' },
  stress: { better: 'mniej stresu', same: 'stres podobny', worse: 'więcej stresu' },
  mood: { better: 'nastrój lepszy', same: 'nastrój podobny', worse: 'nastrój gorszy' },
};

/** Opis zmiany słowami, np. „sen lepszy niż 2 tyg. temu”. */
export function changeText(key: WellKey, trend: Trend): string {
  return `${PHRASES[key][trend]} ${trend === 'same' ? 'jak' : 'niż'} 2 tyg. temu`;
}

/** Ostatnie 7 dni vs te same 7 dni dwa tygodnie wcześniej. Null, gdy w którymś okresie brak wpisów. */
export function wellnessChange(daily: Map<ISODate, Wellness>, key: WellKey, today: ISODate): WellnessChange | null {
  const now = meanIn(daily, key, addDays(today, -6), today);
  const before = meanIn(daily, key, addDays(today, -20), addDays(today, -14));
  if (now == null || before == null) return null;
  const diff = now - before;
  const trend: Trend = diff >= 0.3 ? 'better' : diff <= -0.3 ? 'worse' : 'same';
  return { key, now, before, diff, trend, attention: diff <= -0.5, text: changeText(key, trend) };
}
