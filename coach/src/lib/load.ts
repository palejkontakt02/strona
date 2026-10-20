import type { ISODate, TrainingSession } from '../domain';
import { addDays, todayISO, weekStart } from './dates';
import { num, repsN } from './parse';

/** Obciążenie sesji (AU) = sRPE × czas (min). */
export function sessionLoad(s: TrainingSession): number | null {
  return s.srpe != null && s.duration != null ? s.srpe * s.duration : null;
}

/** Tonaż = Σ serie × powt. × kg (z setsLog bez rozgrzewek, jeśli jest). */
export function tonnage(s: TrainingSession): number {
  return s.exercises.reduce((acc, e) => {
    // jednostronne: powtórzenia na stronę × 2 strony
    // ciężar za 1 hantel przy ćwiczeniu obiema rękami naraz (2 hantle) — tonaż liczy oba
    const sides = (e.perSide ? 2 : 1) * (e.loadPer === 'one' && !e.perSide && !e.cardio ? 2 : 1);
    if (e.setsLog && e.setsLog.length) {
      // serie na czas bez tonażu; różny wynik na stronę (30/20) — suma obu stron
      return acc + e.setsLog.filter((x) => !x.warmup && !x.unit).reduce((b, x) => b + (x.load || 0) * (x.repsR != null ? (x.reps || 0) + x.repsR : sides * (x.reps || 0)), 0);
    }
    const st = repsN(e.sets);
    if (/\d\s*(s|sek|min)\b/i.test(String(e.reps ?? ''))) return acc;
    const r = repsN(e.reps);
    const l = num(e.load);
    return acc + (st && r && l ? sides * st * r * l : 0);
  }, 0);
}

export function dailyLoads(sessions: TrainingSession[]): Record<ISODate, number> {
  const m: Record<ISODate, number> = {};
  for (const s of sessions) {
    const l = sessionLoad(s);
    if (l != null) m[s.date] = (m[s.date] || 0) + l;
  }
  return m;
}

export interface LoadStats {
  acute: number;
  chronic: number;
  acwr: number | null;
  monotony: number | null;
  strain: number | null;
  hasLoad: boolean;
}

/**
 * Ostre = suma AU z 7 dni (dziś−6…dziś); przewlekłe = suma z 28 dni / 4.
 * ACWR tylko gdy pierwszy wpis ≥ 21 dni wcześniej i przewlekłe > 0.
 * Monotonia = średnia dzienna / odch. std. (7 dni, z zerami); strain = ostre × monotonia.
 */
export function loadStats(sessions: TrainingSession[], at: ISODate = todayISO()): LoadStats {
  const dl = dailyLoads(sessions);
  const days = Object.keys(dl).sort();
  const sumRange = (from: number, to: number) => {
    let t = 0;
    for (let i = from; i <= to; i++) t += dl[addDays(at, -i)] || 0;
    return t;
  };
  const acute = sumRange(0, 6);
  // przewlekłe: średnia tygodniowa z tylu tygodni, ile faktycznie jest danych (max 4) — inaczej ACWR zawyżony na starcie
  const spanDays = days.length ? Math.round((new Date(`${at}T12:00:00`).getTime() - new Date(`${days[0]}T12:00:00`).getTime()) / 864e5) + 1 : 0;
  const weeks = Math.min(4, Math.max(1, spanDays / 7));
  const chronic = sumRange(0, 27) / weeks;
  const enough = days.length > 0 && days[0] <= addDays(at, -21);
  const week = Array.from({ length: 7 }, (_, i) => dl[addDays(at, -i)] || 0);
  const mean = week.reduce((a, b) => a + b, 0) / 7;
  const sd = Math.sqrt(week.reduce((a, b) => a + (b - mean) ** 2, 0) / 7);
  const monotony = sd > 0 ? mean / sd : null;
  return {
    acute,
    chronic,
    acwr: enough && chronic > 0 ? acute / chronic : null,
    monotony,
    strain: monotony != null ? acute * monotony : null,
    hasLoad: days.length > 0,
  };
}

export type Level = 'green' | 'yellow' | 'red';

export function acwrZone(a: number | null): { level: Level | null; label: string } {
  if (a == null) return { level: null, label: 'brak danych' };
  if (a < 0.8) return { level: 'yellow', label: 'niedociążenie' };
  if (a <= 1.3) return { level: 'green', label: 'strefa optymalna' };
  if (a <= 1.5) return { level: 'yellow', label: 'uwaga – szybki wzrost' };
  return { level: 'red', label: 'wysokie ryzyko przeciążenia' };
}

/** Sumy tygodniowe (pn–nd) z ostatnich `n` tygodni, od najstarszego. */
export function weekly(
  sessions: TrainingSession[],
  fn: (s: TrainingSession) => number | null,
  n: number,
  today: ISODate = todayISO(),
): { x: ISODate; y: number }[] {
  const cur = weekStart(today);
  const out: { x: ISODate; y: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const ws = addDays(cur, -7 * i);
    const we = addDays(ws, 6);
    out.push({
      x: ws,
      y: sessions.filter((s) => s.date >= ws && s.date <= we).reduce((a, s) => a + (fn(s) || 0), 0),
    });
  }
  return out;
}

/** Seria tygodni: kolejne tygodnie z ≥1 treningiem, licząc od bieżącego (lub poprzedniego, jeśli bieżący pusty). */
export function streak(sessions: TrainingSession[], today: ISODate = todayISO()): { weeks: number; sessions: number } {
  const weeks = new Set(sessions.map((s) => weekStart(s.date)));
  let w = weekStart(today);
  if (!weeks.has(w)) w = addDays(w, -7);
  let n = 0;
  let cnt = 0;
  while (weeks.has(w)) {
    n++;
    const ws = w;
    cnt += sessions.filter((s) => weekStart(s.date) === ws).length;
    w = addDays(w, -7);
  }
  return { weeks: n, sessions: cnt };
}
