import { describe, expect, it } from 'vitest';
import { undatedWorkouts, workoutDate } from './plan';
import type { Plan } from '../domain';

describe('dni treningów w planie', () => {
  const plan: Plan = {
    id: 'p', clientId: 'c', name: 'P', active: true, startDate: '2026-10-21', // środa → tydzień od pon. 19.10
    weeks: [
      { id: 'w1', name: 'T1', workouts: [{ id: 'a', name: 'A', day: 1, exercises: [{ id: 'e', name: 'Przysiad', groups: [] }] }, { id: 'b', name: 'B', date: '2026-10-23', exercises: [{ id: 'e2', name: 'Martwy', groups: [] }] }] },
      { id: 'w2', name: 'T2', workouts: [{ id: 'a2', name: 'A', day: 4, exercises: [{ id: 'e3', name: 'Przysiad', groups: [] }] }, { id: 'b2', name: 'B', exercises: [{ id: 'e4', name: 'Martwy', groups: [] }] }, { id: 'x', name: 'Pusty', exercises: [] }] },
    ],
  };
  it('data z dnia tygodnia i tygodnia planu; data wpisana wygrywa', () => {
    expect(workoutDate(plan, 0, plan.weeks[0].workouts[0])).toBe('2026-10-19');
    expect(workoutDate(plan, 0, plan.weeks[0].workouts[1])).toBe('2026-10-23');
    expect(workoutDate(plan, 1, plan.weeks[1].workouts[0])).toBe('2026-10-29');
    expect(workoutDate({ ...plan, startDate: undefined }, 1, plan.weeks[1].workouts[0])).toBeUndefined();
  });
  it('bez dnia i daty — do uzupełnienia (puste jednostki pomijane, poza planem bez wymogu)', () => {
    expect(undatedWorkouts(plan)).toEqual(['T2 · B']);
    expect(undatedWorkouts({ ...plan, extra: true })).toEqual([]);
  });
});
