import { describe, expect, it } from 'vitest';
import type { Client, Payment, Plan } from '../domain';
import { dueBuckets, planLabel, plansToRenew, requiredReportWeek, weekReports } from './dashboard';

const base: Client = { id: 'a', name: 'Anna', status: 'aktywny', payments: [], measurements: [], tests: [], injuryLog: [], checkins: [] };
const rep = (week: string, seen = false) => ({ id: `r${week}`, week, at: `${week}T10:00:00Z`, ...(seen ? { seenAt: 'x' } : {}) });
const plan = (id: string, clientId: string, startDate: string, weeks: number, extra: Partial<Plan> = {}): Plan => ({
  id,
  clientId,
  name: 'S&C',
  startDate,
  active: true,
  weeks: Array.from({ length: weeks }, (_, i) => ({ id: `${id}w${i}`, name: `T${i + 1}`, workouts: [] })),
  ...extra,
});

describe('raporty tygodnia', () => {
  it('wymagany zawsze za poprzedni pełny tydzień', () => {
    expect(requiredReportWeek('2026-10-30')).toBe('2026-10-19'); // piątek → tydzień 19–25 paź
    expect(requiredReportWeek('2026-10-26')).toBe('2026-10-19'); // poniedziałek
    expect(requiredReportWeek('2026-10-25')).toBe('2026-10-12'); // niedziela
  });
  it('piątek: raport za bieżący tydzień nie zaniża licznika; osoba nie jest jednocześnie „nowa” i „nie przysłała”', () => {
    // Anna przysłała w poniedziałek raport za 19–25 paź (nieprzeczytany); Bartek — nic; Celina — za bieżący tydzień (wcześniej)
    const a: Client = { ...base, weeklyReport: true, weeklyReports: [rep('2026-10-19')] };
    const b: Client = { ...base, id: 'b', name: 'Bartek', weeklyReport: true };
    const c: Client = { ...base, id: 'c', name: 'Celina', weeklyReport: true, weeklyReports: [rep('2026-10-19', true), rep('2026-10-26')] };
    const s = weekReports([a, b, c], '2026-10-30');
    expect(s.week).toBe('2026-10-19');
    expect(s.sent.map((x) => x.id)).toEqual(['a', 'c']);
    expect(s.missing.map((x) => x.id)).toEqual(['b']);
    expect(s.early.map((x) => x.id)).toEqual(['c']);
    expect(s.unread.map((x) => x.c.id)).toEqual(['a']);
    expect(s.earlyUnread.map((x) => x.c.id)).toEqual(['c']);
    for (const u of s.unread) expect(s.missing.includes(u.c)).toBe(false);
  });
  it('stare nieprzeczytane nie pojawiają się jako „nowe”; nowy podopieczny nie jest liczony wstecz', () => {
    const a: Client = { ...base, weeklyReport: true, weeklyReports: [rep('2026-10-05')] };
    const n: Client = { ...base, id: 'n', name: 'Nowy', weeklyReport: true, startDate: '2026-10-28' };
    const s = weekReports([a, n], '2026-10-30');
    expect(s.unread).toEqual([]);
    expect(s.expected.map((x) => x.id)).toEqual(['a']);
    expect(s.missing.map((x) => x.id)).toEqual(['a']);
  });
});

describe('do zapłaty', () => {
  it('rozdziela po terminie, w tym tygodniu i później', () => {
    const p = (id: string, dueDate: string | undefined, status: Payment['status'] = 'due'): Payment => ({ id, type: 'inna', amount: 100, date: '2026-10-01', dueDate, status });
    const r = dueBuckets([p('old', '2026-10-20'), p('wk', '2026-11-01'), p('today', '2026-10-30'), p('nx', '2026-11-05'), p('none', undefined), p('paid', '2026-10-01', 'paid')], '2026-10-30');
    expect(r.overdue.map((x) => x.id)).toEqual(['old']);
    expect(r.thisWeek.map((x) => x.id)).toEqual(['none', 'today', 'wk']);
    expect(r.later.map((x) => x.id)).toEqual(['nx']);
    expect(r.overdueSum).toBe(100);
    expect(r.thisWeekSum).toBe(300);
  });
});

describe('plany', () => {
  it('etykieta postępu: „tydz. 3/4 · do 15.11” / „zakończony”', () => {
    // start pon 26 paź, 4 tygodnie → do niedz. 22 lis
    expect(planLabel(plan('p', 'a', '2026-10-26', 4), '2026-11-10')).toEqual({ text: 'tydz. 3/4 · do 22.11', ended: false, soon: false });
    expect(planLabel(plan('p', 'a', '2026-10-26', 4), '2026-11-18').soon).toBe(true);
    expect(planLabel(plan('p', 'a', '2026-10-26', 4), '2026-11-23')).toMatchObject({ text: 'zakończony', ended: true });
    expect(planLabel(plan('p', 'a', '2026-11-02', 4), '2026-10-30').text).toBe('od 2.11');
    expect(planLabel(null, '2026-10-30').text).toBe('—');
  });
  it('do odnowienia: koniec w ≤ 7 dni albo po końcu; pomija przygotowany kolejny blok', () => {
    const b: Client = { ...base, id: 'b', name: 'Bartek' };
    const c: Client = { ...base, id: 'c', name: 'Celina' };
    const d: Client = { ...base, id: 'd', name: 'Darek' };
    const plans = [
      plan('pa', 'a', '2026-10-12', 4), // do 8 lis — za 9 dni → nie
      plan('pb', 'b', '2026-10-12', 3), // do 1 lis — za 2 dni
      plan('pc', 'c', '2026-09-28', 3), // do 18 paź — zakończony
      plan('pd', 'd', '2026-10-12', 3),
      plan('pd2', 'd', '2026-11-02', 3, { active: false }), // kolejny blok gotowy
      plan('px', 'b', '2026-10-01', 1, { extra: true }),
    ];
    const r = plansToRenew([base, b, c, d], plans, '2026-10-30');
    expect(r.map((x) => [x.client.id, x.ended, x.daysLeft])).toEqual([
      ['c', true, -12],
      ['b', false, 2],
    ]);
  });
});
