import { describe, expect, it } from 'vitest';
import { cloneWeek, extraState, saveSession, sessionToWorkout } from '../data/ops';
import { runToExercises, buildRunExercise } from './run';
import { parseKm, runTotals } from './running';
import type { Db } from '../data/db';
import type { PlanWorkout, TrainingSession } from '../domain';

const empty = (): Db => ({ clients: [], plans: [], sessions: [], appointments: [], library: [], locations: [], trainer_notes: [] });

describe('poprawki z testów trenerów', () => {
  it('dystans: „400 m”, „0.400”, „400” → 0,4 km', () => {
    expect([parseKm('400 m'), parseKm('0.400'), parseKm('400'), parseKm('21,1'), parseKm('5')]).toEqual([0.4, 0.4, 0.4, 21.1, 5]);
  });
  it('progresja tygodnia: bieg zwiększa objętość, nie „kg”; rozgrzewka i schłodzenie bez zmian', () => {
    const w = { id: 'w', name: 'T1', workouts: [{ id: 'k', name: 'Bieg', exercises: [{ id: 'e', name: 'Interwały', cardio: true, groups: [
      { type: 'Rozgrzewka' as const, sets: '1', reps: '15', load: '', rpe: '' },
      { type: 'Robocze' as const, sets: '6', reps: '', load: '800 m', rpe: '8', rest: '2:00 trucht' },
      { type: 'Robocze' as const, sets: '1', reps: '40', load: '10', rpe: '' },
      { type: 'Schłodzenie' as const, sets: '1', reps: '10', load: '', rpe: '' },
    ] }] }] };
    const up = cloneWeek(w, 'T2', 'load5').workouts[0].exercises[0].groups;
    expect(up.map((g) => [g.reps, g.load])).toEqual([['15', ''], ['', '900 m'], ['44', '11'], ['10', '']]);
    const de = cloneWeek(w, 'T2', 'deload').workouts[0].exercises[0].groups;
    expect(de.map((g) => g.sets)).toEqual(['1', '5', '1', '1']);
    expect(de[3].type).toBe('Schłodzenie');
    expect(cloneWeek(w, 'T2', 'rep').workouts[0].exercises[0].groups[1].sets).toBe('7');
  });
  it('zadany na sobotę, zrobiony w środę po zadaniu → wykonany', () => {
    const k: PlanWorkout = { id: 'k', name: 'x', date: '2026-10-24', assignedAt: '2026-10-19', exercises: [] };
    const s = { id: 's', clientId: 'c', date: '2026-10-21', planId: 'x1', workoutId: 'k', charge: 'brak', exercises: [] } as TrainingSession;
    expect(extraState(k, 'x1', [s], '2026-10-25').state).toBe('done');
    expect(extraState({ ...k, assignedAt: undefined }, 'x1', [s], '2026-10-25').state).toBe('overdue');
  });
  it('trening samodzielny nie oznacza zaplanowanej wizyty jako odbytej', () => {
    const db = empty();
    db.appointments.push({ id: 'a', clientId: 'c', date: '2026-10-18', time: '18:00', status: 'planned' });
    const s = { id: 's', clientId: 'c', date: '2026-10-18', charge: 'brak', solo: true, exercises: [] } as TrainingSession;
    expect(saveSession(db, { session: s, isNew: true }).changes.some((c) => c.col === 'appointments')).toBe(false);
    expect(saveSession(db, { session: { ...s, solo: false }, isNew: true }).changes.some((c) => c.col === 'appointments')).toBe(true);
  });
  it('powtórka zapisu: seria na czas, L/P, schłodzenie i trucht zostają', () => {
    const s = { id: 's', clientId: 'c', date: '2026-10-18', charge: 'brak', exercises: [
      { name: 'Deska', setsLog: [{ reps: 60, unit: 's' as const }] },
      { name: 'Wykrok', perSide: true, setsLog: [{ reps: 10, repsR: 8, load: 12 }] },
      { name: 'Bieg', cardio: true, setsLog: [{ reps: 3.08, dist: 0.8, rpe: 8 }, { reps: 3, label: 'Przerwa' }, { reps: 10, label: 'Schłodzenie' }] },
    ] } as TrainingSession;
    const w = sessionToWorkout(s);
    expect(w.exercises[0].groups[0].reps).toBe('60 s');
    expect(w.exercises[1].groups[0].reps).toBe('10/8');
    expect(w.exercises[2].groups.map((g) => [g.type, g.reps, g.load, g.rpe])).toEqual([['Robocze', '3:05', '0,8', ''], ['Przerwa', '3', '', ''], ['Schłodzenie', '10', '', '']]);
  });
  it('kilometraż biegowy bez roweru; „400 m” w zapisie to 0,4 km', () => {
    const ex = buildRunExercise({ id: 'e', name: 'Interwały', cardio: true, groups: [{ type: 'Robocze', sets: '1', reps: '', load: '', rpe: '' }] }, []);
    ex.sets[0] = { ...ex.sets[0], done: true, reps: '1:32', dist: '400 m' };
    const [log] = runToExercises({ planId: '', workoutId: '', name: 'x', planName: '', weekName: '', date: '2026-10-18', startedAt: 0, idx: 0, ex: [ex] } as never);
    const s = { id: 's', clientId: 'c', date: '2026-10-18', charge: 'brak', exercises: [log, { name: 'Rower stacjonarny', cardio: true, setsLog: [{ reps: 60, dist: 30 }] }] } as TrainingSession;
    expect(runTotals(s, true)!.km).toBeCloseTo(0.4, 5);
    expect(runTotals(s)!.km).toBeCloseTo(30.4, 5);
  });
});
