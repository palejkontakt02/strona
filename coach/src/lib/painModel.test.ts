import { describe, expect, it } from 'vitest';
import { painMorningDue, painRising, painStatus } from './painModel';

const s = (date: string, pain?: number, next?: number) => ({ id: date, clientId: 'c', date, charge: 'brak' as const, exercises: [], pain, ...(next != null ? { painNext: { level: next, at: date } } : {}) });

describe('model monitorowania bólu', () => {
  it('światła: ≤2 zielone, 3–5 żółte do rana, >5 lub nieustępujący czerwone', () => {
    expect(painStatus(s('2026-11-20', 2))?.light).toBe('green');
    expect(painStatus(s('2026-11-20', 4))?.light).toBe('yellow');
    expect(painStatus(s('2026-11-20', 4, 1))?.light).toBe('green');
    expect(painStatus(s('2026-11-20', 4, 4))?.light).toBe('yellow');
    expect(painStatus(s('2026-11-20', 2, 5))?.light).toBe('red');
    expect(painStatus(s('2026-11-20', 6))?.light).toBe('red');
    expect(painStatus(s('2026-11-20'))).toBeNull();
  });
  it('pytanie rano: wczoraj z bólem, bez wpisu', () => {
    expect(painMorningDue([s('2026-11-22', 3)], '2026-11-23')?.date).toBe('2026-11-22');
    expect(painMorningDue([s('2026-11-22', 3, 1)], '2026-11-23')).toBeNull();
    expect(painMorningDue([s('2026-11-22', 0)], '2026-11-23')).toBeNull();
    expect(painMorningDue([s('2026-11-18', 3)], '2026-11-23')).toBeNull();
  });
  it('ból rośnie drugi tydzień', () => {
    expect(painRising([s('2026-11-04', 1), s('2026-11-11', 2), s('2026-11-18', 4)], '2026-11-20')).toBe(true);
    expect(painRising([s('2026-11-04', 1), s('2026-11-11', 3), s('2026-11-18', 2)], '2026-11-20')).toBe(false);
  });
});

import { planAdherence, dropReasons } from './adherence';
describe('odpada z planu', () => {
  const plan = { id: 'p', clientId: 'c', name: 'P', active: true, startDate: '2026-11-02', weeks: [{ id: 'w', name: 'T1', workouts: [
    { id: 'a', name: 'A', date: '2026-11-10', exercises: [{ id: 'e', name: 'Przysiad', groups: [] }] },
    { id: 'b', name: 'B', date: '2026-11-13', exercises: [{ id: 'e', name: 'Przysiad', groups: [] }] },
    { id: 'c', name: 'C', date: '2026-11-17', exercises: [{ id: 'e', name: 'Przysiad', groups: [] }] },
  ] }] };
  const done = (id: string, date: string) => ({ id: id + date, clientId: 'c', date, charge: 'brak' as const, planId: 'p', workoutId: id, exercises: [] });
  it('liczy zaplanowane z datą w 14 dniach i zrobione', () => {
    expect(planAdherence([plan], [done('a', '2026-11-10')], '2026-11-20')).toEqual({ planned: 3, done: 1, missed: 2 });
  });
  it('2 opuszczone → sygnał; komplet → brak', () => {
    const c = { id: 'c', name: 'T', status: 'aktywny' as const, payments: [], measurements: [], tests: [], injuryLog: [], checkins: [] };
    expect(dropReasons(c, [plan], [done('a', '2026-11-10')], '2026-11-20')[0].text).toMatch(/1 z 3/);
    expect(dropReasons(c, [plan], [done('a', '2026-11-10'), done('b', '2026-11-14'), done('c', '2026-11-17')], '2026-11-20')).toEqual([]);
  });
});
