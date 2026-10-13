import { describe, expect, it } from 'vitest';
import type { PlanExercise, SetGroup, TrainingSession } from '../domain';
import { buildRunExercise, completeSet, runToExercises, type Run } from './run';

const g = (p: Partial<SetGroup>): SetGroup => ({ type: 'Robocze', sets: '1', reps: '5', load: '', rpe: '8', ...p });
const ex = (groups: SetGroup[], notes = ''): PlanExercise => ({ id: 'e', name: 'Przysiad', rest: '2:00', notes, groups });
// historia: 100 kg × 5 @8 → e1RM 123,3
const hist: TrainingSession[] = [{ id: 's', clientId: 'c', date: '2026-10-01', charge: 'brak', exercises: [{ name: 'Przysiad', sets: '3', reps: '5', load: '100', rpe: '8' }] }];

describe('buildRunExercise', () => {
  it('resolves top set from RPE history and back-offs relative to it', () => {
    const r = buildRunExercise(ex([g({ type: 'Rozgrzewka', load: '50%', rpe: '' }), g({ type: 'Top set', rpe: '8' }), g({ type: 'Back-off', load: '-10%', rpe: '7' }), g({ type: 'Back-off', load: '-10%', rpe: '7' })]), hist);
    expect(r.sets.map((s) => s.load)).toEqual(['62.5', '100', '90', '90']);
    expect(r.sets.map((s) => s.warmup)).toEqual([true, false, false, false]);
    expect(r.sets[1].sug).toBe('dobrane z historii do RPE 8');
    expect(r.sets[2].first).toBe(true);
    expect(r.sets[3].first).toBe(false);
    expect(r.sets[2].gdesc).toBe('Back-off 2 × 5 @7');
  });
  it('drop sets cascade set by set', () => {
    const r = buildRunExercise(ex([g({ load: '100' }), g({ type: 'Drop set', load: '-10%' }), g({ type: 'Drop set', load: '-10%' })]), []);
    expect(r.sets.map((s) => s.load)).toEqual(['100', '90', '80']);
  });
  it('extracts tempo from notes', () => {
    const r = buildRunExercise(ex([g({})], 'Tempo 3-1-X-0, pauza'), []);
    expect(r.tempo).toEqual([3, 1, 1, 0]);
    expect(r.tempoStr).toBe('3-1-X-0');
    expect(r.notes).toBe('pauza');
  });
});

describe('completeSet autoregulation', () => {
  it('same relative block follows actual load', () => {
    const r = buildRunExercise(ex([g({ type: 'Top set', load: '100' }), g({ type: 'Back-off', load: '-10%', rpe: '7' }), g({ type: 'Back-off', load: '-10%', rpe: '7' })]), []);
    let sets = r.sets;
    sets[1] = { ...sets[1], load: '92.5' }; // zawodnik wpisał inny ciężar, ale nie oznaczył edycji
    let res = completeSet({ ...r, sets }, 0);
    expect(res.sets[0].rpe).toBe('8');
    expect(res.sets[1].load).toBe('90');
    expect(res.sets[1].sug).toBe('-10% od poprzedniej serii (100 kg)');
    expect(res.rest).toBe(120);
    sets = res.sets;
    sets[1] = { ...sets[1], load: '95' };
    res = completeSet({ ...r, sets }, 1);
    expect(res.sets[2].load).toBe('95');
  });
  it('empty spec picks load from this set e1RM toward target RPE', () => {
    const r = buildRunExercise(ex([g({ load: '100', rpe: '8' }), g({ load: '', rpe: '8' })]), []);
    const sets = r.sets.map((s) => ({ ...s }));
    sets[0].rpe = '6'; // było lżej niż cel
    const res = completeSet({ ...r, sets }, 0);
    // e1RM = 100 × (1 + 9/30) = 130 → 5 @8 = 130 / (1 + 7/30) = 105.4 → 105
    expect(res.sets[1].load).toBe('105');
    expect(res.sets[1].sug).toBe('+5% vs poprzednia seria (RPE niżej / cel 8)');
  });
  it('manual edits and fixed loads are left alone; undo just unticks', () => {
    const r = buildRunExercise(ex([g({ load: '100' }), g({ load: '' }), g({ load: '110' })]), []);
    const sets = r.sets.map((s) => ({ ...s }));
    sets[1].edited = true;
    sets[1].load = '80';
    let res = completeSet({ ...r, sets }, 0);
    expect(res.sets[1].load).toBe('80');
    res = completeSet({ ...r, sets: res.sets }, 1);
    expect(res.sets[2].load).toBe('110');
    const undo = completeSet({ ...r, sets: res.sets }, 1);
    expect(undo.sets[1].done).toBe(false);
    expect(undo.rest).toBeNull();
  });
  it('warmup completion gives no rest and no autoregulation', () => {
    const r = buildRunExercise(ex([g({ type: 'Rozgrzewka', load: '60', rpe: '' }), g({ load: '' })]), []);
    const res = completeSet(r, 0);
    expect(res.rest).toBeNull();
    expect(res.sets[1].load).toBe('');
  });
});

describe('runToExercises', () => {
  it('keeps only done sets and summarises working sets', () => {
    const e = buildRunExercise(ex([g({ type: 'Rozgrzewka', load: '60', rpe: '' }), g({ load: '100' }), g({ load: '100' })]), []);
    e.sets[0].done = true;
    e.sets[1].done = true;
    e.sets[1].rpe = '8';
    const run: Run = { planId: 'p', workoutId: 'w', name: 'A', planName: '', weekName: '', date: '2026-10-13', startedAt: 0, idx: 0, ex: [e, { ...e, name: 'Nic', sets: e.sets.map((s) => ({ ...s, done: false })) }] };
    const out = runToExercises(run);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: 'Przysiad', sets: '1', reps: '5', load: '100', rpe: '8' });
    expect(out[0].setsLog).toEqual([
      { load: 60, reps: 5, rpe: undefined, warmup: true, label: 'Rozgrzewka' },
      { load: 100, reps: 5, rpe: 8, warmup: undefined, label: 'Robocze' },
    ]);
  });
});
