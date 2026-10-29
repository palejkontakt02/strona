import { describe, expect, it } from 'vitest';
import type { PlanExercise, SetGroup, TrainingSession } from '../domain';
import { cloneWeek, progressCardio, progressGroup, sessionToWorkout } from '../data/ops';

const g = (p: Partial<SetGroup> = {}): SetGroup => ({ type: 'Robocze', sets: '3', reps: '8', load: '100', rpe: '8', ...p });
const ex = (name: string, groups: SetGroup[], p: Partial<PlanExercise> = {}): PlanExercise => ({ id: 'e', name, groups, ...p });

describe('progresja siłowa — realne kroki', () => {
  it('sztanga, hantle, małe ciężary', () => {
    const sq = ex('Przysiad ze sztangą', []);
    expect(progressGroup(g(), 'load2', sq).load).toBe('102,5');
    expect(progressGroup(g({ load: '200' }), 'load5', sq).load).toBe('210');
    const db = ex('Wyciskanie hantli', []);
    expect(progressGroup(g({ load: '12' }), 'load2', db).load).toBe('14');
    expect(progressGroup(g({ load: '8' }), 'load2', db).load).toBe('9');
    expect(progressGroup(g({ load: '24' }), 'deload', db).load).toBe('22');
    const small = ex('Unoszenie talerza', []);
    expect(progressGroup(g({ load: '10' }), 'load2', small).load).toBe('10,5');
    expect(progressGroup(g({ load: '15' }), 'deload', small).load).toBe('13,5');
    // bez wymuszania +2,5 kg: duży ciężar +2,5% = 5 kg
    expect(progressGroup(g({ load: '180' }), 'load2', sq).load).toBe('185');
  });
  it('„+1 powtórzenie” przy „8/str.”', () => {
    expect(progressGroup(g({ reps: '8/str.' }), 'rep', ex('Wykroki', [])).reps).toBe('9/str.');
  });
});

describe('progresja ćwiczeń na czas', () => {
  const plank = (reps: string, sets = '3') => ex('Deska', [g({ reps, load: '', sets })]);
  const pg = (reps: string, mode: Parameters<typeof progressGroup>[1], sets = '3') => progressGroup(g({ reps, load: '', sets }), mode, plank(reps, sets));
  it('+5 s / +10 s / deload −20% i −1 seria', () => {
    expect(pg('45 s', 'rep').reps).toBe('50 s');
    expect(pg('45 s', 'load2').reps).toBe('50 s');
    expect(pg('45 s', 'load5').reps).toBe('55 s');
    expect(pg('1:30', 'rep').reps).toBe('1:35');
    expect(pg('20 s/str.', 'rep').reps).toBe('25 s/str.');
    expect(pg('50 s', 'deload')).toMatchObject({ reps: '40 s', sets: '2' });
  });
  it('cloneWeek przekazuje ćwiczenie (deska na czas)', () => {
    const w = cloneWeek({ id: 'w', name: 'T1', workouts: [{ id: 'k', name: 'A', exercises: [plank('30 s')] }] }, 'T2', 'rep');
    expect(w.workouts[0].exercises[0].groups[0].reps).toBe('35 s');
  });
});

describe('progresja biegu', () => {
  const run = (p: Partial<SetGroup>) => g({ sets: '1', reps: '', load: '', rpe: '', ...p });
  it('dystans co 100 m, czas w pełnych minutach', () => {
    expect(progressCardio(run({ load: '8' }), 'load2').load).toBe('8,4');
    expect(progressCardio(run({ load: '5,5' }), 'load5').load).toBe('6,1');
    expect(progressCardio(run({ reps: '44' }), 'load2').reps).toBe('46');
    expect(progressCardio(run({ reps: '20' }), 'load2').reps).toBe('21');
    expect(progressCardio(run({ reps: '30' }), 'deload').reps).toBe('24');
    expect(progressCardio(run({ load: '10', rpe: '6' }), 'deload')).toMatchObject({ load: '8', rpe: '5' });
  });
  it('interwały: +1 odcinek przy „+1 powtórzenie”, deload −1 odcinek', () => {
    const iv = run({ sets: '6', load: '800 m', rpe: '9', pace: 'Z5' });
    expect(progressCardio(iv, 'rep')).toMatchObject({ sets: '7', load: '800 m' });
    expect(progressCardio(iv, 'deload')).toMatchObject({ sets: '5', load: '800 m', rpe: '8' });
    expect(progressCardio(run({ sets: '5', load: '1' }), 'load2').load).toBe('1,1');
  });
  it('rozgrzewka bez zmian', () => {
    expect(progressCardio(run({ type: 'Rozgrzewka', reps: '15' }), 'load5').reps).toBe('15');
  });
});

describe('sessionToWorkout — kopia / powtórka', () => {
  const s: TrainingSession = {
    id: 's', clientId: 'c', date: '2026-10-20', charge: 'brak', planId: 'p', workoutId: 'k',
    exercises: [{ name: 'Przysiad ze sztangą', setsLog: [
      { load: 60, reps: 5, warmup: true, label: 'Rozgrzewka' },
      { load: 140, reps: 3, rpe: 8.5, label: 'Top set' },
      { load: 125, reps: 5, rpe: 7.5, label: 'Back-off' },
      { load: 125, reps: 5, rpe: 8, label: 'Back-off' },
      { load: 100, reps: 12, rpe: 9.5, label: 'AMRAP' },
    ] }],
  };
  it('typy serii, „-10%” back-offów, RPE z przecinkiem', () => {
    const w = sessionToWorkout(s);
    expect(w.exercises[0].groups.map((x) => [x.type, x.load, x.rpe])).toEqual([
      ['Rozgrzewka', '60', ''], ['Top set', '140', '8,5'], ['Back-off', '-10%', '7,5'], ['Back-off', '-10%', '8'], ['AMRAP', '100', '9,5'],
    ]);
  });
  it('z planem: docelowe RPE i zapis względny z jednostki', () => {
    const plan = { id: 'p', clientId: 'c', name: 'P', active: true, weeks: [{ id: 'w', name: 'T', workouts: [{ id: 'k', name: 'A', exercises: [ex('Przysiad ze sztangą', [
      g({ type: 'Rozgrzewka', sets: '1', reps: '5', load: '50%', rpe: '' }), g({ type: 'Top set', sets: '1', reps: '3', load: '', rpe: '8' }), g({ type: 'Back-off', sets: '2', reps: '5', load: '-12%', rpe: '7' }), g({ type: 'AMRAP', sets: '1', reps: 'AMRAP', load: '100', rpe: '9' }),
    ])] }] }] };
    const w = sessionToWorkout(s, [plan]);
    expect(w.exercises[0].groups.map((x) => [x.type, x.load, x.rpe])).toEqual([
      ['Rozgrzewka', '60', ''], ['Top set', '140', '8'], ['Back-off', '-12%', '7'], ['Back-off', '-12%', '7'], ['AMRAP', '100', '9'],
    ]);
  });
});
