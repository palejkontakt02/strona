import { describe, expect, it } from 'vitest';
import type { TrainingSession } from '../domain';
import { compareWorkouts, fillFromLast, fmtLast, isNoLoad, lastExerciseLog, previousWorkout, resultDelta, signed, srpeFromSets, workIndex, workoutStats } from './lastResult';
import { BEEP_SEC, WAV_RATE, buildRestWav } from './restWav';

const S = (id: string, date: string, ex: TrainingSession['exercises'], extra: Partial<TrainingSession> = {}): TrainingSession => ({ id, clientId: 'c1', date, charge: 'brak', exercises: ex, ...extra });

const hist = [
  S('a', '2026-10-01', [{ name: 'Przysiad', setsLog: [{ load: 40, reps: 10, warmup: true }, { load: 60, reps: 8 }, { load: 62.5, reps: 7 }] }]),
  S('b', '2026-10-08', [{ name: 'Przysiad', setsLog: [{ load: 65, reps: 8 }, { load: 65, reps: 6 }] }]),
  S('c', '2026-10-10', [{ name: 'Pompki', setsLog: [{ reps: 12 }] }]),
];

describe('lastExerciseLog', () => {
  it('bierze najnowsze wykonanie, bez rozgrzewek', () => {
    expect(lastExerciseLog(hist, 'przysiad ').map((x) => x.load)).toEqual([65, 65]);
  });
  it('pomija poprawiany trening i późniejsze daty', () => {
    expect(lastExerciseLog(hist, 'Przysiad', { excludeId: 'b' }).map((x) => x.load)).toEqual([60, 62.5]);
    expect(lastExerciseLog(hist, 'Przysiad', { before: '2026-10-05' }).length).toBe(2);
    expect(lastExerciseLog(hist, 'Przysiad', { before: '2026-09-01' })).toEqual([]);
  });
  it('workIndex liczy tylko serie robocze', () => {
    const sets = [{ warmup: true }, { warmup: false }, { warmup: false }];
    expect(workIndex(sets, 0)).toBeNull();
    expect(workIndex(sets, 1)).toBe(0);
    expect(workIndex(sets, 2)).toBe(1);
  });
});

describe('fmtLast / fillFromLast', () => {
  it('formatuje po polsku', () => {
    expect(fmtLast({ load: 62.5, reps: 8 })).toBe('62,5×8');
    expect(fmtLast({ reps: 12 })).toBe('12 powt.');
    expect(fmtLast({ reps: 30, unit: 's' })).toBe('30 s');
    expect(fmtLast({ load: 20, reps: 8, repsR: 7 })).toBe('20×8/7');
    expect(fmtLast(undefined)).toBeNull();
  });
  it('kopiuje do pól', () => {
    expect(fillFromLast({ load: 62.5, reps: 8 })).toEqual({ reps: '8', load: '62,5' });
    expect(fillFromLast({ reps: 8, repsR: 6 })).toEqual({ reps: '8/6', load: '' });
  });
});

describe('resultDelta', () => {
  it('ciężar, potem powtórzenia', () => {
    expect(resultDelta({ load: 60, reps: 8 }, { load: '62,5', reps: '8' })).toEqual([{ dir: 'up', text: '▲ +2,5 kg' }]);
    expect(resultDelta({ load: 60, reps: 8 }, { load: '60', reps: '7' })).toEqual([{ dir: 'down', text: '▼ −1 powt.' }]);
    expect(resultDelta({ load: 60, reps: 8 }, { load: '60', reps: '8' })).toEqual([{ dir: 'same', text: '= jak ostatnio' }]);
    expect(resultDelta({ load: 60, reps: 8 }, { load: '57,5', reps: '10' }).map((d) => d.text)).toEqual(['▼ −2,5 kg', '▲ +2 powt.']);
  });
  it('czas i strony', () => {
    expect(resultDelta({ reps: 30, unit: 's' }, { load: '', reps: '45', unit: 's' })).toEqual([{ dir: 'up', text: '▲ +15 s' }]);
    expect(resultDelta({ reps: 8 }, { load: '', reps: '9/9' })[0].text).toBe('▲ +1 powt.');
  });
  it('bez poprzedniego wyniku albo pustego pola — nic', () => {
    expect(resultDelta(undefined, { load: '60', reps: '8' })).toEqual([]);
    expect(resultDelta({ load: 60, reps: 8 }, { load: '60', reps: '' })).toEqual([]);
  });
});

describe('isNoLoad', () => {
  const set = (load = '', spec = '', sug = '') => ({ load, spec, sug });
  it('masa ciała / plyometria / na czas', () => {
    expect(isNoLoad({ name: 'Pompki', sets: [set()] })).toBe(true);
    expect(isNoLoad({ name: 'CMJ', sets: [set()] }, { cat: 'Plyometria' })).toBe(true);
    expect(isNoLoad({ name: 'Martwy robak', timed: true, sets: [set()] })).toBe(true);
  });
  it('ciężar w planie albo w historii zostawia kolumnę kg', () => {
    expect(isNoLoad({ name: 'Pompki', sets: [set('10')] })).toBe(false);
    expect(isNoLoad({ name: 'Podciąganie', sets: [set('', '+10 kg')] })).toBe(false);
    expect(isNoLoad({ name: 'Podciąganie', sets: [set()] }, { last: [{ load: 5, reps: 5 }] })).toBe(false);
    expect(isNoLoad({ name: 'Przysiad ze sztangą', sets: [set()] })).toBe(false);
    expect(isNoLoad({ name: 'Bieg', cardio: true, sets: [set()] })).toBe(false);
  });
});

describe('podsumowanie treningu', () => {
  it('statystyki i porównanie z poprzednim wykonaniem', () => {
    const prev = S('p', '2026-10-01', [{ name: 'Przysiad', setsLog: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }] }], { workoutId: 'w1', planId: 'p1' });
    const other = S('o', '2026-10-05', [{ name: 'Wiosło', setsLog: [{ load: 40, reps: 8 }] }], { workoutId: 'w2', planId: 'p1' });
    const cur = S('n', '2026-10-08', [{ name: 'Przysiad', setsLog: [{ load: 40, reps: 5, warmup: true }, { load: 65, reps: 8 }, { load: 65, reps: 8 }, { load: 65, reps: 6 }] }], { workoutId: 'w1', planId: 'p1' });
    expect(workoutStats(cur)).toEqual({ sets: 3, tonnage: 1430, exercises: 1 });
    expect(previousWorkout([prev, other, cur], cur)?.id).toBe('p');
    expect(compareWorkouts(workoutStats(cur), workoutStats(prev))).toEqual({ tonnage: 470, sets: 1 });
    expect(compareWorkouts(workoutStats(cur), undefined)).toBeNull();
    expect(signed(470, 'kg')).toBe('+470 kg');
    expect(signed(-2)).toBe('−2');
  });
  it('trening własny — po nazwie', () => {
    const a = S('a', '2026-10-01', [], { workoutName: 'Trening własny' });
    const b = S('b', '2026-10-03', [], { workoutName: 'trening  własny' });
    expect(previousWorkout([a, b], b)?.id).toBe('a');
  });
  it('wysiłek z RPE serii', () => {
    expect(srpeFromSets(['7', '8', '', '8,5'])).toBe(8);
    expect(srpeFromSets(['', undefined])).toBeNull();
  });
});

describe('buildRestWav', () => {
  it('nagłówek WAV i długość = cisza + sygnał', () => {
    const w = buildRestWav(2);
    const txt = (o: number, n: number) => String.fromCharCode(...w.slice(o, o + n));
    expect(txt(0, 4)).toBe('RIFF');
    expect(txt(8, 4)).toBe('WAVE');
    const n = 2 * WAV_RATE + Math.round(BEEP_SEC * WAV_RATE);
    expect(w.length).toBe(44 + n);
    expect(new DataView(w.buffer).getUint32(40, true)).toBe(n);
    // cisza do końca przerwy, potem dźwięk
    expect(w.slice(44, 44 + 2 * WAV_RATE).every((b) => b === 128)).toBe(true);
    expect(w.slice(44 + 2 * WAV_RATE).some((b) => Math.abs(b - 128) > 50)).toBe(true);
  });
});
