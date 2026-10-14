import { describe, expect, it } from 'vitest';
import type { Habit } from '../domain';
import { dayProgress, habitStreak, isDue, isoWeekday, rangeProgress, scheduleLabel, toggleDone, withDay } from './habits';

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
});
