import { describe, expect, it } from 'vitest';
import type { PlanExercise } from '../domain';
import { workoutMinutes } from './estimate';

const ex = (name: string, sets: string, reps: string, rest = '2:00'): PlanExercise => ({ id: name, name, rest, groups: [{ type: 'Robocze', sets, reps, load: '', rpe: '', rest }] }) as PlanExercise;

describe('szacowany czas jednostki', () => {
  it('z ostatniego zapisu tej jednostki, zaokrąglony do 5 min', () => {
    const k = { id: 'w1', exercises: [ex('Przysiad', '3', '5')] };
    expect(workoutMinutes(k, [{ workoutId: 'w1', duration: 52, date: '2026-11-01' }, { workoutId: 'w1', duration: 70, date: '2026-10-01' }])).toBe(50);
  });
  it('bez historii: serie, przerwy i zmiana ćwiczenia', () => {
    // 3 × (40 s) + 2 × 120 s + 60 s = 420 s = 7 min → 5; dwa ćwiczenia = 14 min → 15
    const k = { id: 'w2', exercises: [ex('Przysiad', '3', '5'), ex('Wiosłowanie', '3', '8')] };
    expect(workoutMinutes(k, [])).toBe(15);
  });
  it('serie na czas liczą czas z planu', () => {
    const k = { id: 'w3', exercises: [ex('Deska', '2', '60 s', '60')] };
    // 2 × 60 + 60 + 60 = 240 s → 5 min
    expect(workoutMinutes(k, [])).toBe(5);
  });
  it('pusta jednostka: brak szacunku', () => {
    expect(workoutMinutes({ id: 'w4', exercises: [] }, [])).toBeNull();
  });
});
