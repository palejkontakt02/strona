import { describe, expect, it } from 'vitest';
import { createSeed } from '../data/seed';
import { extraState, plansOf, sessionsOf } from '../data/ops';
import { currentPlan, nextWorkout } from '../lib/plan';
import { runFromStart } from './start';
import { sameAsPartner } from './LiveSession';
import type { Plan, TrainingSession } from '../domain';

const db = createSeed();
const client = db.clients.find((c) => {
  const p = currentPlan(plansOf(db, c.id));
  return p && nextWorkout(p, sessionsOf(db, c.id));
})!;
const plan = currentPlan(plansOf(db, client.id))!;
const nx = nextWorkout(plan, sessionsOf(db, client.id))!;

describe('łączenie treningów z planem', () => {
  it('zadany trening = kopia następnej jednostki → zalicza jednostkę planu i zadanie', () => {
    const copy = { ...structuredClone(nx.workout), id: 'copy1', date: '2026-11-08' };
    const extra: Plan = { id: 'ex1', clientId: client.id, name: 'Dodatkowe', active: false, extra: true, weeks: [{ id: 'wx', name: 'Dodatkowe', workouts: [copy] }] };
    const d2 = { ...db, plans: [...db.plans.filter((p) => !(p.clientId === client.id && p.extra)), extra] };
    const r = runFromStart(d2, client.id, { planId: 'ex1', workoutId: 'copy1' }, '2026-11-08');
    if (typeof r === 'string') throw new Error(r);
    expect(r.planId).toBe(plan.id);
    expect(r.workoutId).toBe(nx.workout.id);
    expect(r.extraOf).toEqual({ planId: 'ex1', workoutId: 'copy1' });
    const s = { id: 's1', clientId: client.id, date: '2026-11-08', planId: r.planId, workoutId: r.workoutId, extraOf: r.extraOf, exercises: [], charge: 'brak' } as unknown as TrainingSession;
    expect(extraState(copy, 'ex1', [s], '2026-11-08').state).toBe('done');
  });
  it('powtórka zapisanego treningu pamięta, z którego dnia', () => {
    const s = sessionsOf(db, client.id).find((x) => x.exercises.length)!;
    const r = runFromStart(db, client.id, { repeatSessionId: s.id }, '2026-11-08');
    if (typeof r === 'string') throw new Error(r);
    expect(r.repeatOf).toEqual({ sessionId: s.id, date: s.date });
  });
  it('„ten sam co partner” zalicza jednostkę o tej samej nazwie w planie tej osoby', () => {
    const pr = runFromStart(db, client.id, { planId: plan.id, workoutId: nx.workout.id }, '2026-11-08');
    if (typeof pr === 'string') throw new Error(pr);
    // ta sama osoba jako „partner” — jej jednostka o tej nazwie to następna
    const r = sameAsPartner(pr, db, client.id, '2026-11-08');
    expect(r.workoutId).toBe(nx.workout.id);
  });
});
