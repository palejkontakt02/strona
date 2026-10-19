import { describe, expect, it } from 'vitest';
import { adHocExercise, buildRunExercise, completeSet, isTimed, runToExercises, timedByName } from './run';
import { fmtSec, secOf } from './parse';
import { setText } from '../athlete/History';

const run = (ex: ReturnType<typeof buildRunExercise>) => ({ planId: '', workoutId: '', name: 'x', planName: '', weekName: '', date: '2026-10-19', startedAt: 0, idx: 0, ex: [ex] }) as never;

describe('ćwiczenia na czas', () => {
  it('czas serii: 45, 45 s, 1:30, 1\'30, 2 min, 1,5 min', () => {
    expect(['45', '45 s', '1:30', "1'30", '2 min', '1,5 min', 'x'].map(secOf)).toEqual([45, 45, 90, 90, 120, 90, null]);
    expect([fmtSec(45), fmtSec(90)]).toEqual(['45 s', '1:30']);
  });
  it('z nazwy i ręcznie', () => {
    expect(['Deska', 'Wall sit', 'Zwis na drążku', 'Plank bokiem'].every(timedByName)).toBe(true);
    expect(timedByName('Przysiad')).toBe(false);
    expect(isTimed({ name: 'Przysiad', timed: true, groups: [] })).toBe(true);
    expect(isTimed({ name: 'Deska', timed: false, groups: [] })).toBe(false);
    expect(isTimed({ name: 'Bieżnia', timed: true, groups: [] })).toBe(false);
  });
  it('plan „na czas” → serie w sekundach, bez doboru ciężaru z RPE; zapis 1:30 = 90 s', () => {
    const ex = buildRunExercise({ id: 'e', name: 'Martwy robak', timed: true, groups: [{ type: 'Robocze', sets: '3', reps: '1:30', load: '', rpe: '7' }] }, []);
    expect(ex.timed).toBe(true);
    expect(ex.sets.map((x) => [x.reps, x.unit, x.load])).toEqual([['90', 's', ''], ['90', 's', ''], ['90', 's', '']]);
    const after = completeSet({ ...ex, sets: ex.sets.map((x, i) => (i === 0 ? { ...x, rpe: '8' } : x)) }, 0);
    expect(after.sets[1].load).toBe('');
    ex.sets[0] = { ...ex.sets[0], done: true, reps: '1:15' };
    const [log] = runToExercises(run(ex));
    expect(log.setsLog[0]).toMatchObject({ reps: 75, unit: 's' });
    expect(log.timed).toBe(true);
    expect(setText(log.setsLog[0])).toBe('1:15');
  });
  it('dodane w trakcie na czas', () => {
    const e = adHocExercise('Deska', 3, '1:00', '', '1:00', true);
    expect(e.timed).toBe(true);
    expect(e.sets[0]).toMatchObject({ reps: '60', unit: 's' });
  });
});
