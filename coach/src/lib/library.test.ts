import { describe, expect, it } from 'vitest';
import type { Plan, TrainingSession } from '../domain';
import { atlasToAdd, exerciseKey, renameCounts, renameIn } from './library';
import { ATLAS } from '../data/atlas';

describe('biblioteka: atlas i zmiana nazwy', () => {
  it('słownik PL ↔ EN', () => {
    expect(exerciseKey('Przysiad ze sztangą')).toBe(exerciseKey('Back Squat'));
    expect(exerciseKey('przysiad bulgarski')).toBe(exerciseKey('Bulgarian Split Squat'));
    expect(exerciseKey('Hip thrust')).toBe(exerciseKey('Barbell Hip Thrust'));
    expect(exerciseKey('Farmers Carry')).toBe(exerciseKey('Farmer’s Carry'));
    expect(exerciseKey('Coś innego')).toBe('cos innego');
  });
  it('atlas pomija duplikaty (także po polsku)', () => {
    const add = atlasToAdd(['Przysiad ze sztangą', 'Przysiad bułgarski', 'hip thrust', 'Deadlift']).map(([n]) => n);
    expect(add).not.toContain('Back Squat');
    expect(add).not.toContain('Bulgarian Split Squat');
    expect(add).not.toContain('Barbell Hip Thrust');
    expect(add).not.toContain('Deadlift');
    expect(add).toContain('Front Squat');
    expect(add.length).toBe(ATLAS.length - 4);
    expect(atlasToAdd(ATLAS.map(([n]) => n))).toEqual([]);
  });
  it('zmiana nazwy w planach i historii', () => {
    const plan = { id: 'p', clientId: 'c', name: 'P', weeks: [{ id: 'w', name: 'T1', workouts: [{ id: 'k', name: 'A', exercises: [{ id: 'e', name: 'przysiad', groups: [] }, { id: 'f', name: 'Wiosło', groups: [] }] }] }] } as unknown as Plan;
    const other = { ...plan, id: 'p2', weeks: [] } as Plan;
    const s = { id: 's', clientId: 'c', date: '2026-11-01', charge: 'brak', exercises: [{ name: 'Przysiad', sets: '3' }] } as unknown as TrainingSession;
    expect(renameCounts([plan, other], [s], 'Przysiad')).toEqual({ plans: 1, sessions: 1 });
    const r = renameIn([plan, other], [s], 'Przysiad', 'Przysiad ze sztangą');
    expect(r.plans).toHaveLength(1);
    expect(r.plans[0].weeks[0].workouts[0].exercises.map((e) => e.name)).toEqual(['Przysiad ze sztangą', 'Wiosło']);
    expect(r.sessions[0].exercises[0]).toMatchObject({ name: 'Przysiad ze sztangą', sets: '3' });
  });
});
