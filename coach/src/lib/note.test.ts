import { describe, expect, it } from 'vitest';
import { parseSetLine, parseWorkoutNote } from './note';

const NOTE = `13.10.2026
Clean & Jerk (z podłogi)
2+1x60kg
2+1x70kg
2+1x70kg RPE 8
2+1x70kg RPE

Jerk ze stojaków(z ramion)

2x60kg
2x65kg
2x65kg

Front Squat
4x100
4x105
4x110
8x90

Clean Pull
3x80kg
3x85kg
3x85kg

Wiosłowanie sztangą
8x70kg
8x70kg
8x75kg`;

describe('parseSetLine', () => {
  it('reads reps × load with optional kg and RPE', () => {
    expect(parseSetLine('4x100')).toEqual({ count: 1, repsText: '4', reps: 4, load: 100, rpe: undefined });
    expect(parseSetLine('2+1x70kg RPE 8')).toMatchObject({ repsText: '2+1', reps: 3, load: 70, rpe: 8 });
    expect(parseSetLine('8 x 72,5 kg @7,5')).toMatchObject({ reps: 8, load: 72.5, rpe: 7.5 });
    expect(parseSetLine('3x5x100')).toMatchObject({ count: 3, reps: 5, load: 100 });
    expect(parseSetLine('2+1x70kg RPE')).toMatchObject({ load: 70, rpe: undefined });
  });
  it('rejects exercise names', () => {
    expect(parseSetLine('Front Squat')).toBeNull();
    expect(parseSetLine('Clean & Jerk (z podłogi)')).toBeNull();
  });
});

describe('parseWorkoutNote', () => {
  it('reads the trainer note exactly', () => {
    const r = parseWorkoutNote(NOTE);
    expect(r.date).toBe('2026-10-13');
    expect(r.skipped).toEqual([]);
    expect(r.exercises.map((e) => [e.name, e.setsLog!.length])).toEqual([
      ['Clean & Jerk (z podłogi)', 4],
      ['Jerk ze stojaków(z ramion)', 3],
      ['Front Squat', 4],
      ['Clean Pull', 3],
      ['Wiosłowanie sztangą', 3],
    ]);
    expect(r.exercises[0]).toMatchObject({ sets: '4', reps: '2+1', load: '60' });
    expect(r.exercises[0].notes).toContain('Kompleks 2+1');
    expect(r.exercises[0].setsLog![2]).toEqual({ load: 70, reps: 3, rpe: 8 });
    expect(r.exercises[2].setsLog!.map((s) => `${s.reps}x${s.load}`)).toEqual(['4x100', '4x105', '4x110', '8x90']);
  });
});
