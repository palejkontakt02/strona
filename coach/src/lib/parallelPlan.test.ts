import { describe, expect, it } from 'vitest';
import { parallelPlansOf, plansOf, savePlan } from '../data/ops';
import type { Db } from '../data/db';
import type { Plan } from '../domain';
import { currentPlan, nextWorkout } from './plan';

const plan = (id: string, o: Partial<Plan> = {}): Plan => ({
  id,
  clientId: 'c',
  name: id,
  active: true,
  startDate: '2026-11-16',
  weeks: [{ id: `${id}w`, name: 'T1', workouts: [{ id: `${id}k1`, name: `${id} 1`, date: '2026-11-24', exercises: [{ id: 'e', name: 'Bieg', cardio: true, groups: [] }] }] }],
  ...o,
});
const db = (plans: Plan[]): Db => ({ clients: [], plans, sessions: [], appointments: [], library: [], locations: [], trainer_notes: [] });

describe('plan równoległy (np. bieganie obok siłowni)', () => {
  const main = plan('sila');
  const run = plan('bieg', { parallel: true });

  it('główny plan i plany równoległe są rozdzielone', () => {
    const d = db([main, run]);
    expect(plansOf(d, 'c').map((p) => p.id)).toEqual(['sila']);
    expect(parallelPlansOf(d, 'c').map((p) => p.id)).toEqual(['bieg']);
    expect(currentPlan([main, run])?.id).toBe('sila');
    expect(currentPlan([run])).toBeNull();
  });

  it('włączenie planu równoległego nie wyłącza głównego i odwrotnie', () => {
    const ch1 = savePlan(db([main, { ...run, active: false }]), run);
    expect(ch1.map((c) => (c as { item: Plan }).item.id)).toEqual(['bieg']);
    const other = plan('sila2', { active: false });
    const ch2 = savePlan(db([main, run, other]), { ...other, active: true });
    const off = ch2.map((c) => (c as { item: Plan }).item).filter((p) => !p.active).map((p) => p.id);
    expect(off).toEqual(['sila']);
  });

  it('plan równoległy ma własną kolejkę jednostek', () => {
    expect(nextWorkout(run, [])?.workout.id).toBe('biegk1');
    expect(parallelPlansOf(db([{ ...run, active: false }]), 'c')).toEqual([]);
    expect(parallelPlansOf(db([{ ...run, active: false }]), 'c', false)).toHaveLength(1);
  });
});
