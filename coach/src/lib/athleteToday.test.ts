import { describe, expect, it } from 'vitest';
import { checkinAdvice, firstOpenWeek, planDue, weekStrip } from './athleteToday';

describe('weekStrip', () => {
  it('Pn–Nd z dzisiejszym dniem i stanami', () => {
    // 2026-10-25 to niedziela
    const s = weekStrip('2026-10-25', ['2026-10-19', '2026-10-21'], ['2026-10-21', '2026-10-23']);
    expect(s.map((d) => d.label)).toEqual(['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb', 'Nd']);
    expect(s[0].date).toBe('2026-10-19');
    expect(s.map((d) => d.state)).toEqual(['done', 'rest', 'done', 'rest', 'planned', 'rest', 'rest']);
    expect(s.filter((d) => d.today).map((d) => d.date)).toEqual(['2026-10-25']);
  });
});

describe('planDue', () => {
  const today = '2026-10-25';
  it('bez daty — nic', () => expect(planDue(undefined, today, [], 'p')).toBeNull());
  it('dziś i później — zaplanowany', () => {
    expect(planDue(today, today, [], 'p')).toBe('upcoming');
    expect(planDue('2026-10-30', today, [], 'p')).toBe('upcoming');
  });
  it('minął termin, brak treningu z planu od tego dnia — zaległy', () => {
    expect(planDue('2026-09-04', today, [{ planId: 'p', date: '2026-09-01' }, { planId: 'x', date: '2026-10-01' }], 'p')).toBe('overdue');
  });
  it('trenuje regularnie z planu — nie zaległy', () => {
    expect(planDue('2026-09-04', today, [{ planId: 'p', date: '2026-10-22' }], 'p')).toBeNull();
    expect(planDue('2026-10-22', today, [{ planId: 'p', date: '2026-10-22' }], 'p')).toBeNull();
  });
});

describe('checkinAdvice', () => {
  it('niska gotowość → lżej', () => expect(checkinAdvice(2.2, 3.5)?.lighter).toBe(true));
  it('brak normy', () => expect(checkinAdvice(3.6, null)?.tone).toBe('neutral'));
  it('wyraźnie gorzej niż norma', () => expect(checkinAdvice(3, 3.8)).toMatchObject({ tone: 'warn', lighter: true }));
  it('lepiej', () => expect(checkinAdvice(4.4, 3.8)?.tone).toBe('ok'));
  it('brak wpisu', () => expect(checkinAdvice(null, 3)).toBeNull());
});

describe('firstOpenWeek', () => {
  const weeks = [{ workouts: [{ id: 'a' }] }, { workouts: [{ id: 'b' }, { id: 'c' }] }];
  it('tydzień następnej jednostki', () => expect(firstOpenWeek(weeks, 'c')).toBe(1));
  it('brak następnej — wszystko otwarte', () => expect(firstOpenWeek(weeks, undefined)).toBe(0));
});
