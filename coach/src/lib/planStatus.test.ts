import { describe, expect, it } from 'vitest';
import type { Plan, TrainingSession } from '../domain';
import { doneInPass, nextDate, nextWorkout, planStatus } from './plan';

const sess = (p: Partial<TrainingSession>): TrainingSession => ({ id: Math.random().toString(36), clientId: 'c', date: '2026-10-01', charge: 'brak', exercises: [], ...p } as TrainingSession);
// start w czwartek 2026-10-01 → tydzień 1 od pon. 2026-09-28
const plan: Plan = {
  id: 'p', clientId: 'c', name: 'P', active: true, startDate: '2026-10-01',
  weeks: [
    { id: 'w1', name: 'T1', workouts: [{ id: 'a', name: 'A', day: 1, exercises: [] }, { id: 'b', name: 'B', day: 4, exercises: [] }] },
    { id: 'w2', name: 'T2', workouts: [{ id: 'c', name: 'C', day: 1, exercises: [] }, { id: 'd', name: 'D', day: 4, exercises: [] }] },
  ],
};

describe('stoppedForPain', () => {
  it('przerwany z bólu trening nie zalicza jednostki', () => {
    const ss = [sess({ planId: 'p', workoutId: 'a', date: '2026-09-28' }), sess({ planId: 'p', workoutId: 'b', date: '2026-10-01', stoppedForPain: { level: 7 } })];
    expect(nextWorkout(plan, ss)?.workout.id).toBe('b');
    expect([...doneInPass(plan, ss)]).toEqual(['a']);
    // po ponownym, pełnym B — następna C
    expect(nextWorkout(plan, [...ss, sess({ planId: 'p', workoutId: 'b', date: '2026-10-03' })])?.workout.id).toBe('c');
  });
});

describe('planStatus', () => {
  it('koniec planu = ostatnia data jednostki', () => {
    expect(planStatus(plan, '2026-10-08')).toEqual({ ended: false, endDate: '2026-10-08', cycle: 1 });
    expect(planStatus(plan, '2026-10-09')).toMatchObject({ ended: true, endDate: '2026-10-08' });
  });
  it('cykl wg kalendarza', () => {
    expect(planStatus(plan, '2026-09-30').cycle).toBe(1);
    expect(planStatus(plan, '2026-10-12').cycle).toBe(2);
    expect(planStatus(plan, '2026-10-26').cycle).toBe(3);
  });
  it('bez dat jednostek — niedziela ostatniego tygodnia; bez startu — nie zakończony', () => {
    const p2: Plan = { ...plan, weeks: plan.weeks.map((w) => ({ ...w, workouts: w.workouts.map((k) => ({ ...k, day: undefined })) })) };
    expect(planStatus(p2, '2026-10-12')).toMatchObject({ ended: true, endDate: '2026-10-11' });
    expect(planStatus({ ...p2, startDate: undefined }, '2030-01-01')).toEqual({ ended: false, cycle: 1 });
  });
});

describe('nextDate', () => {
  it('data z planu, gdy nie minęła', () => {
    const nx = nextWorkout(plan, [])!;
    expect(nextDate(plan, nx, '2026-09-27')).toBe('2026-09-28');
  });
  it('drugie przejście: najbliższy dzień tygodnia jednostki ≥ dziś', () => {
    const all = ['a', 'b', 'c', 'd'].map((w, i) => sess({ planId: 'p', workoutId: w, date: `2026-10-0${i + 1}` }));
    const nx = nextWorkout(plan, all)!;
    expect(nx.workout.id).toBe('a');
    expect(nextDate(plan, nx, '2026-10-29')).toBe('2026-11-02'); // czw. → pon.
    expect(nextDate(plan, nx, '2026-11-02')).toBe('2026-11-02');
  });
  it('wpisana data bez dnia: ten sam dzień tygodnia', () => {
    const p3: Plan = { ...plan, weeks: [{ id: 'w', name: 'T', workouts: [{ id: 'x', name: 'X', date: '2026-10-07', exercises: [] }] }] };
    expect(nextDate(p3, nextWorkout(p3, [])!, '2026-10-29')).toBe('2026-11-04');
  });
});
