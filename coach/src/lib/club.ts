import type { ClubPayout, ISODate, Location, TrainingSession, YearMonth } from '../domain';
import { todayISO } from './dates';

export interface ClubMonth {
  month: YearMonth;
  sessions: number;
  amount: number;
  payout?: ClubPayout;
  /** Bieżący miesiąc — jeszcze trwa. */
  current: boolean;
}

/** Treningi rozliczane przez dany klub (charge = „klub”, w tym miejscu). */
export function clubSessions(sessions: TrainingSession[], locationId: string, month?: YearMonth): TrainingSession[] {
  return sessions.filter((s) => s.charge === 'klub' && s.locationId === locationId && (!month || s.date.startsWith(month)));
}

/**
 * Rozliczenie z klubem miesiąc po miesiącu (od najnowszego): liczba treningów × stawka klubu
 * oraz wypłata, jeśli klub już zapłacił za dany miesiąc.
 */
export function clubMonths(location: Location, sessions: TrainingSession[], today: ISODate = todayISO()): ClubMonth[] {
  const rate = location.clubRate ?? 0;
  const cur = today.slice(0, 7);
  const months = new Set<string>([...clubSessions(sessions, location.id).map((s) => s.date.slice(0, 7)), ...location.payouts.map((p) => p.month)]);
  return [...months]
    .sort((a, b) => b.localeCompare(a))
    .map((month) => {
      const n = clubSessions(sessions, location.id, month).length;
      return { month, sessions: n, amount: n * rate, payout: location.payouts.find((p) => p.month === month), current: month === cur };
    });
}

/** Należność od klubu za zakończone miesiące bez wypłaty. */
export function clubOutstanding(location: Location, sessions: TrainingSession[], today: ISODate = todayISO()): { amount: number; months: number } {
  const open = clubMonths(location, sessions, today).filter((m) => !m.current && !m.payout && m.sessions > 0);
  return { amount: open.reduce((a, m) => a + m.amount, 0), months: open.length };
}
