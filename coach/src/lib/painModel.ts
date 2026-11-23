import type { ISODate, TrainingSession } from '../domain';
import { addDays, todayISO, weekStart } from './dates';

/**
 * Model monitorowania bólu (Silbernagel 2007, Thomeé; konsensus powrotu do sportu Ardern 2016):
 * ból w trakcie / po treningu do 2/10 — bezpiecznie; 3–5 — akceptowalnie, jeśli następnego ranka wraca do zwykłego
 * poziomu; powyżej 5, nieustępujący do rana albo rosnący z tygodnia na tydzień — zmień obciążenie.
 */
export type PainLight = 'green' | 'yellow' | 'red';

export interface PainStatus {
  light: PainLight;
  text: string;
}

export function painStatus(s: Pick<TrainingSession, 'pain' | 'painNext'>): PainStatus | null {
  const during = s.pain;
  const next = s.painNext?.level;
  if (during == null && next == null) return null;
  const d = during ?? 0;
  if (d > 5) return { light: 'red', text: `ból ${d}/10 w trakcie (powyżej 5)` };
  if (next != null && next > 5) return { light: 'red', text: `ból rano ${next}/10` };
  if (next != null && next > Math.max(2, d)) return { light: 'red', text: `rano gorzej niż na treningu (${d} → ${next})` };
  if (next != null && next >= 3) return { light: 'yellow', text: `rano wciąż ${next}/10 — nie ustąpił` };
  if (d >= 3 && next == null) return { light: 'yellow', text: `ból ${d}/10 — sprawdź rano` };
  if (d >= 3) return { light: 'green', text: `ból ${d}/10, rano ustąpił (${next})` };
  return { light: 'green', text: d ? `ból ${d}/10` : 'bez bólu' };
}

/** Trening, po którym trzeba zapytać o ból rano: wczoraj (lub przedwczoraj), ból ≥ 1, bez wpisu rano. */
export function painMorningDue(sessions: TrainingSession[], today: ISODate = todayISO()): TrainingSession | null {
  return (
    [...sessions]
      .filter((s) => (s.pain ?? 0) >= 1 && !s.painNext && s.date < today && s.date >= addDays(today, -2))
      .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null
  );
}

/** Najwyższy ból tygodnia (w trakcie albo rano) przez `n` tygodni do bieżącego, od najstarszego. */
export function weeklyPainMax(sessions: TrainingSession[], n: number, today: ISODate = todayISO()): (number | null)[] {
  const cur = weekStart(today);
  return Array.from({ length: n }, (_x, i) => {
    const w = addDays(cur, -7 * (n - 1 - i));
    const vals = sessions.filter((s) => s.date >= w && s.date <= addDays(w, 6)).flatMap((s) => [s.pain, s.painNext?.level]).filter((v): v is number => v != null);
    return vals.length ? Math.max(...vals) : null;
  });
}

/** Ból rośnie drugi tydzień z rzędu (np. 2 → 3 → 5), a ostatni tydzień ≥ 3. */
export function painRising(sessions: TrainingSession[], today: ISODate = todayISO()): boolean {
  const [a, b, c] = weeklyPainMax(sessions, 3, today);
  return a != null && b != null && c != null && b > a && c > b && c >= 3;
}
