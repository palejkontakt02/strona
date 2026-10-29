import { describe, expect, it } from 'vitest';
import type { Plan, PlanExercise } from '../domain';
import { planGrid, setCells } from './planGrid';

const ex = (name: string, p: Partial<PlanExercise> = {}): PlanExercise => ({ id: name, name, rest: '2:00', notes: '', groups: [{ type: 'Robocze', sets: '2', reps: '8', load: '20', rpe: '8' }], ...p });
const plan = (weeks: PlanExercise[][]): Plan => ({ id: 'p', clientId: 'c', name: 'P', active: true, weeks: weeks.map((exs, i) => ({ id: `w${i + 1}`, name: `T${i + 1}`, workouts: [{ id: `k${i + 1}`, name: 'A', exercises: exs }] })) });

describe('setCells /str.', () => {
  it('nie dubluje „/str.”', () => {
    const e = ex('Wykroki', { groups: [{ type: 'Robocze', sets: '1', reps: '8/str.', load: '', rpe: '' }] });
    expect(setCells(e)[0].reps).toBe('8/str.');
    expect(setCells({ ...e, groups: [{ type: 'Robocze', sets: '1', reps: '8', load: '', rpe: '' }] })[0].reps).toBe('8/str.');
  });
});

describe('planGrid — kolejność i notatki per tydzień', () => {
  const p = plan([[ex('Przysiad'), ex('Martwy')], [ex('Martwy', { notes: 'pauza na dole' }), ex('Przysiad')], [ex('Przysiad', { notes: 'tempo 3-1-1' }), ex('Martwy', { notes: 'pauza na dole' })]]);
  it('domyślnie wiersze w kolejności 1. tygodnia, litery z każdego tygodnia', () => {
    const [s] = planGrid(p, () => false);
    expect(s.orderVaries).toBe(true);
    expect(s.rows.map((r) => r.name)).toEqual(['Przysiad', 'Martwy']);
    expect(s.rows[0].labels).toEqual(['A', 'B', 'A']);
    expect(s.rows[0].label).toBe('A/B');
    expect(s.rows[1].label).toBe('B/A');
  });
  it('tydzień odniesienia ustala kolejność wierszy i główną literę', () => {
    const [s] = planGrid(p, () => false, false, { refWeek: 1 });
    expect(s.rows.map((r) => r.name)).toEqual(['Martwy', 'Przysiad']);
    expect(s.rows[0].label).toBe('A/B');
  });
  it('notatki z tygodnia, w którym są', () => {
    const [s] = planGrid(p, () => false);
    const m = s.rows.find((r) => r.name === 'Martwy')!;
    expect(m.notes).toBe('pauza na dole');
    expect(m.weekNotes).toEqual([undefined, 'pauza na dole', 'pauza na dole']);
    expect(s.rows.find((r) => r.name === 'Przysiad')!.notes).toBe('tempo 3-1-1');
    const [s2] = planGrid(plan([[ex('X', { notes: 'a' })], [ex('X', { notes: 'b' })]]), () => false);
    expect(s2.rows[0].notes).toBe('T1: a · T2: b');
  });
  it('ta sama kolejność — bez flagi', () => {
    const [s] = planGrid(plan([[ex('A1'), ex('B1')], [ex('A1'), ex('B1')]]), () => false);
    expect(s.orderVaries).toBe(false);
    expect(s.rows.map((r) => r.label)).toEqual(['A', 'B']);
  });
});
