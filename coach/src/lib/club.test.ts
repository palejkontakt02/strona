import { describe, expect, it } from 'vitest';
import type { Location, TrainingSession } from '../domain';
import { clubMonths, clubOutstanding, clubSessions } from './club';

const s = (date: string, charge: TrainingSession['charge'], locationId = 'energy'): TrainingSession => ({ id: date + charge + locationId, clientId: 'c', date, charge, locationId, exercises: [] });
const club: Location = { id: 'energy', name: 'Energy', kind: 'klub', hue: 30, clubRate: 90, payouts: [{ id: 'p', month: '2026-08', amount: 270, sessions: 3, paidDate: '2026-09-05' }] };
const sessions = [
  s('2026-08-03', 'klub'),
  s('2026-08-10', 'klub'),
  s('2026-08-17', 'klub'),
  s('2026-09-02', 'klub'),
  s('2026-09-09', 'klub'),
  s('2026-09-10', 'pakiet'), // płaci klient — nie liczy się do klubu
  s('2026-09-11', 'klub', 'studio'), // inne miejsce
  s('2026-10-06', 'klub'),
];

describe('club billing', () => {
  it('counts only club-charged sessions at this place', () => {
    expect(clubSessions(sessions, 'energy')).toHaveLength(6);
    expect(clubSessions(sessions, 'energy', '2026-09')).toHaveLength(2);
  });
  it('monthly statement with payouts, newest first', () => {
    expect(clubMonths(club, sessions, '2026-10-13')).toEqual([
      { month: '2026-10', sessions: 1, amount: 90, payout: undefined, paid: 0, due: 90, current: true },
      { month: '2026-09', sessions: 2, amount: 180, payout: undefined, paid: 0, due: 180, current: false },
      { month: '2026-08', sessions: 3, amount: 270, payout: club.payouts[0], paid: 270, due: 0, current: false },
    ]);
  });
  it('session added after payout leaves a top-up due', () => {
    const more = [...sessions, s('2026-08-24', 'klub')];
    const aug = clubMonths(club, more, '2026-10-13').find((m) => m.month === '2026-08')!;
    expect(aug).toMatchObject({ sessions: 4, amount: 360, paid: 270, due: 90 });
    expect(clubOutstanding(club, more, '2026-10-13')).toEqual({ amount: 270, months: 2 });
  });
  it('uses the rate stored on the session, not the current one', () => {
    const old = { ...s('2026-09-02', 'klub'), clubRate: 80 };
    expect(clubMonths({ ...club, clubRate: 100 }, [old], '2026-10-13')[0]).toMatchObject({ month: '2026-09', amount: 80 });
  });
  it('outstanding = finished months without payout', () => {
    expect(clubOutstanding(club, sessions, '2026-10-13')).toEqual({ amount: 180, months: 1 });
  });
});
