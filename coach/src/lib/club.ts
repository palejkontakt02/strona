import type { ClubPayout, ISODate, Location, TrainingSession, YearMonth } from '../domain';
import { todayISO } from './dates';

export interface ClubMonth {
  month: YearMonth;
  sessions: number;
  /** Należność za miesiąc: suma stawek zapisanych w treningach. */
  amount: number;
  /** Ostatnia wypłata za ten miesiąc. */
  payout?: ClubPayout;
  /** Suma wypłat za ten miesiąc. */
  paid: number;
  /** Ile klub jeszcze winien (np. dopłata za trening dopisany po wypłacie). */
  due: number;
  /** Bieżący miesiąc — jeszcze trwa. */
  current: boolean;
}

/** Treningi rozliczane przez dany klub (charge = „klub”, w tym miejscu). */
export function clubSessions(sessions: TrainingSession[], locationId: string, month?: YearMonth): TrainingSession[] {
  return sessions.filter((s) => s.charge === 'klub' && s.locationId === locationId && (!month || s.date.startsWith(month)));
}

/** Kwota za treningi: stawka zapisana w treningu, a dla starszych zapisów — bieżąca stawka klubu. */
export function clubAmount(location: Location, sessions: TrainingSession[]): number {
  return sessions.reduce((a, s) => a + (s.clubRate ?? location.clubRate ?? 0), 0);
}

/**
 * Rozliczenie z klubem miesiąc po miesiącu (od najnowszego): należność wg stawek z treningów,
 * wypłaty i różnica do dopłaty.
 */
export function clubMonths(location: Location, sessions: TrainingSession[], today: ISODate = todayISO()): ClubMonth[] {
  const cur = today.slice(0, 7);
  const months = new Set<string>([...clubSessions(sessions, location.id).map((s) => s.date.slice(0, 7)), ...location.payouts.map((p) => p.month)]);
  return [...months]
    .sort((a, b) => b.localeCompare(a))
    .map((month) => {
      const list = clubSessions(sessions, location.id, month);
      const amount = clubAmount(location, list);
      const payouts = location.payouts.filter((p) => p.month === month).sort((a, b) => a.paidDate.localeCompare(b.paidDate));
      const paid = payouts.reduce((a, p) => a + p.amount, 0);
      return { month, sessions: list.length, amount, payout: payouts[payouts.length - 1], paid, due: Math.max(0, amount - paid), current: month === cur };
    });
}

/** Należność od klubu za zakończone miesiące (bez wypłaty albo z niedopłatą). */
export function clubOutstanding(location: Location, sessions: TrainingSession[], today: ISODate = todayISO()): { amount: number; months: number } {
  const open = clubMonths(location, sessions, today).filter((m) => !m.current && m.due > 0);
  return { amount: open.reduce((a, m) => a + m.due, 0), months: open.length };
}
