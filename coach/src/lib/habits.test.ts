import { describe, expect, it } from 'vitest';
import type { Habit } from '../domain';
import { dayProgress, habitItemStreak, habitLibrary, habitRate, habitStreak, isDue, isoWeekday, rangeProgress, scheduleLabel, toggleDone, withDay } from './habits';

const daily: Habit = { id: 'a', title: 'Kroki', schedule: { kind: 'daily' } };
const mwf: Habit = { id: 'b', title: 'Mobilność', schedule: { kind: 'week', days: [1, 3, 5] } };
const month: Habit = { id: 'c', title: 'Ważenie', schedule: { kind: 'month', days: [1, 15, 31] } };

describe('habits', () => {
  it('weekday and schedules', () => {
    expect(isoWeekday('2026-10-12')).toBe(1); // poniedziałek
    expect(isoWeekday('2026-10-18')).toBe(7);
    expect(isDue(mwf, '2026-10-12')).toBe(true);
    expect(isDue(mwf, '2026-10-13')).toBe(false);
    expect(isDue(month, '2026-10-15')).toBe(true);
    expect(isDue(month, '2026-11-30')).toBe(true); // 31 → ostatni dzień listopada
    expect(isDue(month, '2026-11-29')).toBe(false);
    expect(isDue({ ...daily, since: '2026-10-10' }, '2026-10-09')).toBe(false);
  });
  it('progress, range and streak', () => {
    const habits = [daily, mwf];
    let log = withDay([], '2026-10-12', ['a', 'b']); // pn: 2/2
    log = withDay(log, '2026-10-13', ['a']); // wt: 1/1
    log = withDay(log, '2026-10-14', ['a']); // śr: 1/2
    expect(dayProgress(habits, log, '2026-10-14')).toEqual({ done: 1, total: 2 });
    const r = rangeProgress(habits, log, '2026-10-14', 3);
    expect(r).toMatchObject({ done: 4, total: 5, closed: 2, active: 3 });
    expect(habitStreak(habits, log, '2026-10-14')).toBe(2); // dziś niezamknięty — nie przerywa
    expect(toggleDone(log, '2026-10-14', 'b').sort()).toEqual(['a', 'b']);
    expect(toggleDone(log, '2026-10-14', 'a')).toEqual([]);
  });
  it('labels', () => {
    expect(scheduleLabel({ kind: 'week', days: [1, 2, 3, 4, 5] })).toBe('pn–pt');
    expect(scheduleLabel(mwf.schedule)).toBe('pn, śr, pt');
    expect(scheduleLabel(month.schedule)).toBe('w dni miesiąca: 1, 15, 31');
  });
  it('streak of a single habit skips days it is not due', () => {
    // pn 12, śr 14, pt 16 odhaczone; dziś sb 17 (nie obowiązuje) → seria 3
    let log = withDay([], '2026-10-12', ['b']);
    log = withDay(log, '2026-10-14', ['b']);
    log = withDay(log, '2026-10-16', ['b', 'a']);
    expect(habitItemStreak(mwf, log, '2026-10-17')).toBe(3);
    // pn 19 nieodhaczone (dziś) — nie przerywa
    expect(habitItemStreak(mwf, log, '2026-10-19')).toBe(3);
    // wt 20: poniedziałek minął bez odhaczenia → 0
    expect(habitItemStreak(mwf, log, '2026-10-20')).toBe(0);
    // codzienne: tylko pt 16, czw 15 nie → 1
    expect(habitItemStreak(daily, log, '2026-10-16')).toBe(1);
    expect(habitItemStreak(daily, [], '2026-10-16')).toBe(0);
  });
  it('compliance of a single habit (7 / 30 days)', () => {
    let log = withDay([], '2026-10-12', ['a']);
    log = withDay(log, '2026-10-13', ['a']);
    log = withDay(log, '2026-10-15', ['a']);
    // 7 dni do 18.10 (12–18): odhaczone 3, dziś 18 nieodhaczony nie liczy się → 3/6
    expect(habitRate(daily, log, '2026-10-18', 7)).toEqual({ done: 3, total: 6, pct: 0.5 });
    // od 10.10 (since) przez 30 dni do 18.10: 12-18 → dni 10–17 = 8 obowiązujących
    expect(habitRate({ ...daily, since: '2026-10-10' }, log, '2026-10-18', 30)).toEqual({ done: 3, total: 8, pct: 3 / 8 });
    // dziś odhaczony liczy się
    expect(habitRate(daily, withDay(log, '2026-10-18', ['a']), '2026-10-18', 7).total).toBe(7);
    // nigdy nie obowiązywało
    expect(habitRate({ ...daily, since: '2026-11-01' }, log, '2026-10-18', 7).pct).toBeNull();
  });
  it('library uses protein target', () => {
    expect(habitLibrary(150).find((h) => h.key === 'protein')?.title).toBe('Białko 150 g');
    expect(habitLibrary().map((h) => h.title)).toContain('Woda 2 l');
  });
});
