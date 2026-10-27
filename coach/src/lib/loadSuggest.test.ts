import { describe, expect, it } from 'vitest';
import type { Plan, SetGroup, TrainingSession } from '../domain';
import { applySuggestions, repRange, suggestLoads, targetWeekIndex } from './loadSuggest';

const g = (reps: string, load: string, rpe = '8', type: SetGroup['type'] = 'Robocze'): SetGroup => ({ type, sets: '1', reps, load, rpe });
const sq = (load = '100') => ({ id: 'e1', name: 'Przysiad ze sztangą', groups: [g('5', '60', '', 'Rozgrzewka'), g('6–8', load), g('6–8', load), g('6–8', load)] });
const plan = (): Plan => ({
  id: 'p',
  clientId: 'c',
  name: 'Siła',
  startDate: '2026-10-05',
  active: true,
  weeks: [1, 2, 3].map((n) => ({ id: `w${n}`, name: `Tydzień ${n}`, workouts: [{ id: `k${n}`, name: 'Trening A', day: 1, exercises: [sq(), { id: 'e2', name: 'Bieg', cardio: true, groups: [g('20', '3')] }, { id: 'e3', name: 'Deska', timed: true, groups: [g('45 s', '')] }] }] })),
});
const ses = (date: string, wid: string, sets: [number, number, number?][]): TrainingSession => ({
  id: `s-${date}`,
  clientId: 'c',
  date,
  charge: 'pakiet' as TrainingSession['charge'],
  planId: 'p',
  workoutId: wid,
  exercises: [{ name: 'Przysiad ze sztangą', setsLog: [{ load: 60, reps: 5, warmup: true }, ...sets.map(([load, reps, rpe]) => ({ load, reps, rpe, done: true }))] }],
});
const TODAY = '2026-10-26';

describe('loadSuggest', () => {
  it('zakres powtórzeń', () => {
    expect(repRange('6–8')).toEqual([6, 8]);
    expect(repRange('5')).toEqual([5, 5]);
    expect(repRange('8/str.')).toEqual([8, 8]);
    expect(repRange('AMRAP')).toBeNull();
    expect(repRange('45 s')).toBeNull();
  });

  it('tydzień docelowy = następny po ostatnio wykonanym', () => {
    expect(targetWeekIndex(plan(), [])).toBeNull();
    expect(targetWeekIndex(plan(), [ses('2026-10-12', 'k2', [[100, 8, 7]])])).toBe(2);
    expect(targetWeekIndex(plan(), [ses('2026-10-19', 'k3', [[100, 8, 7]])])).toBeNull();
  });

  it('dodaj +2,5 kg: wszystkie serie z górnym zakresem przy RPE ≤ cel', () => {
    const r = suggestLoads(plan(), [ses('2026-10-19', 'k1', [[100, 8, 7], [100, 8, 7.5], [100, 8, 8]])], TODAY)!;
    expect(r.weekIndex).toBe(1);
    expect(r.items).toHaveLength(1); // bieg i deska pominięte
    expect(r.items[0]).toMatchObject({ kind: 'add', last: 100, next: 102.5, planned: 100, applicable: true, already: false });
    expect(r.items[0].why).toMatch(/górnym zakresem/);
  });

  it('utrzymaj: RPE powyżej celu albo nie górna granica', () => {
    expect(suggestLoads(plan(), [ses('2026-10-19', 'k1', [[100, 8, 8], [100, 8, 9], [100, 8, 9]])], TODAY)!.items[0].kind).toBe('hold');
    const r = suggestLoads(plan(), [ses('2026-10-19', 'k1', [[100, 7, 8], [100, 7, 8], [100, 7, 8]])], TODAY)!;
    expect(r.items[0]).toMatchObject({ kind: 'hold', next: 100 });
  });

  it('jeden raz niedobrane — utrzymaj; dwa razy z rzędu — zmniejsz −5%', () => {
    const one = suggestLoads(plan(), [ses('2026-10-19', 'k1', [[100, 6, 9], [100, 5, 10]])], TODAY)!;
    expect(one.items[0].kind).toBe('hold');
    const two = suggestLoads(plan(), [ses('2026-10-19', 'k2', [[100, 6, 9], [100, 5, 10]]), ses('2026-10-12', 'k1', [[100, 5, 9]])], TODAY)!;
    expect(two.items[0]).toMatchObject({ kind: 'cut', next: 95 });
    expect(two.items[0].why).toMatch(/Dwa treningi z rzędu/);
  });

  it('RPE > cel + 1 dwa razy z rzędu — zmniejsz', () => {
    const r = suggestLoads(plan(), [ses('2026-10-19', 'k2', [[100, 8, 9.5]]), ses('2026-10-12', 'k1', [[100, 8, 9.5]])], TODAY)!;
    expect(r.items[0].kind).toBe('cut');
  });

  it('stare treningi (> 6 tyg.) nie liczą się', () => {
    const p = plan();
    expect(suggestLoads(p, [{ ...ses('2026-08-01', 'k1', [[100, 8, 7]]) }], TODAY)!.items).toHaveLength(0);
  });

  it('plan już zakłada wyższy ciężar → already', () => {
    const p = plan();
    p.weeks[1].workouts[0].exercises[0] = sq('105');
    const r = suggestLoads(p, [ses('2026-10-19', 'k1', [[100, 8, 7]])], TODAY)!;
    expect(r.items[0]).toMatchObject({ kind: 'add', planned: 105, already: true });
  });

  it('zastosuj: serie robocze z kg / puste dostają nowy ciężar, back-off o tyle samo, % zostaje', () => {
    const p = plan();
    p.weeks[1].workouts[0].exercises[0].groups = [g('5', '60', '', 'Rozgrzewka'), g('5', '100', '8', 'Top set'), g('5', '90', '7', 'Back-off'), g('5', '-10%', '7', 'Back-off'), g('6–8', '')];
    const out = applySuggestions(p, 1, [{ exercise: 'Przysiad ze sztangą', next: 102.5, planned: 100, last: 100 }]);
    expect(out.weeks[1].workouts[0].exercises[0].groups.map((x) => x.load)).toEqual(['60', '102.5', '92.5', '-10%', '102.5']);
    expect(p.weeks[1].workouts[0].exercises[0].groups[1].load).toBe('100'); // oryginał bez zmian
    expect(out.weeks[0]).toEqual(p.weeks[0]);
  });
});
