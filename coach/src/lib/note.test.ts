import { describe, expect, it } from 'vitest';
import { matchNoteWorkout, parseSetLine, parseWorkoutNote } from './note';

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
    expect(r.exercises[0].setsLog![2]).toEqual({ load: 70, reps: 3, rpe: 8, complex: '2+1' });
    expect(r.exercises[2].setsLog!.map((s) => `${s.reps}x${s.load}`)).toEqual(['4x100', '4x105', '4x110', '8x90']);
  });
});

describe('parseWorkoutNote — formaty zaawansowane', () => {
  it('„3x5 @8” to 3 serie po 5 powtórzeń, nie 5 kg', () => {
    expect(parseSetLine('3x5 @8')).toMatchObject({ count: 3, reps: 5, load: undefined, rpe: 8 });
  });
  it('nazwa i serie w jednej linii oraz czas', () => {
    const r = parseWorkoutNote('Podciąganie 4x6\nPrzysiad 5x3x100\nDeska\n3x45s');
    expect(r.skipped).toEqual([]);
    expect(r.exercises.map((e) => [e.name, e.setsLog!.length, e.reps])).toEqual([
      ['Podciąganie', 4, '6'],
      ['Przysiad', 5, '3'],
      ['Deska', 3, '45 s'],
    ]);
  });
  it('kompleks oznaczony w seriach (nie liczy się do e1RM)', () => {
    const r = parseWorkoutNote('Clean & Jerk\n2+1x60kg');
    expect(r.exercises[0].setsLog![0]).toMatchObject({ reps: 3, load: 60, complex: '2+1' });
  });
});

describe('serie na czas i na stronę', () => {
  it('3x30s i 3x6/str', () => {
    const r = parseWorkoutNote('Deska bokiem\n3x30s\nBird dog\n3x6/str');
    expect(r.exercises.map((e) => e.name)).toEqual(['Deska bokiem', 'Bird dog']);
    expect(r.exercises[0].setsLog![0]).toMatchObject({ reps: 30, unit: 's' });
    expect(r.exercises[1].perSide).toBe(true);
    expect(r.exercises[1].setsLog!.length).toBe(3);
    expect(r.exercises[1].setsLog![0].reps).toBe(6);
  });
});

describe('typowe zapisy trenera (runda 5)', () => {
  const one = (t: string) => parseWorkoutNote(t);
  const sets = (t: string) => one(t).exercises[0].setsLog!;
  it('„Przysiad 140x5x3” — kg × powtórzenia × serie', () => {
    const r = one('Przysiad 140x5x3');
    expect(r.exercises[0].name).toBe('Przysiad');
    expect(sets('Przysiad 140x5x3')).toEqual([{ load: 140, reps: 5 }, { load: 140, reps: 5 }, { load: 140, reps: 5 }]);
    // klasyczny zapis serie × powt × kg bez zmian
    expect(sets('Przysiad 5x3x100')).toHaveLength(5);
  });
  it('„Wyciskanie leżąc 102,5 kg 3x5 @8” — kg nie trafia do nazwy', () => {
    const r = one('Wyciskanie leżąc 102,5 kg 3x5 @8');
    expect(r.exercises[0].name).toBe('Wyciskanie leżąc');
    expect(r.exercises[0].setsLog).toEqual(Array(3).fill({ load: 102.5, reps: 5, rpe: 8 }));
    expect(r.skipped).toEqual([]);
  });
  it('„180x3, 190x2” — dwie serie w jednej linii (kg × powt.)', () => {
    expect(sets('Martwy ciąg\n180x3, 190x2')).toEqual([{ load: 180, reps: 3 }, { load: 190, reps: 2 }]);
    expect(sets('Martwy ciąg\n100x5,110x3')).toEqual([{ load: 100, reps: 5 }, { load: 110, reps: 3 }]);
  });
  it('„Step down / 3x10” i „Step down” + „3x10” — 3 serie po 10, bez kg', () => {
    for (const t of ['Step down / 3x10', 'Step down\n3x10']) {
      const r = one(t);
      expect(r.exercises[0].name).toBe('Step down');
      expect(r.exercises[0].setsLog).toEqual(Array(3).fill({ reps: 10 }));
    }
  });
  it('niejednoznaczne „3x10” w ćwiczeniu zapisanym w kg zostaje powtórzenia × kg', () => {
    expect(sets('Wznosy\n8x12kg\n3x10').map((s) => `${s.reps}x${s.load}`)).toEqual(['8x12', '3x10']);
  });
  it('„3x10 8kg” i „8kg 3x10”', () => {
    expect(sets('Wykroki\n3x10 8kg')).toEqual(Array(3).fill({ load: 8, reps: 10 }));
    expect(sets('Wykroki\n8kg 3x10')).toEqual(Array(3).fill({ load: 8, reps: 10 }));
    expect(sets('Wykroki 8 kg 3x10')).toHaveLength(3);
  });
  it('L/P: „Hop jednonóż 5/3” i „3x5/4”', () => {
    const r = one('Hop jednonóż 5/3\nPrzysiad bułgarski\n3x5/4');
    expect(r.exercises.map((e) => e.name)).toEqual(['Hop jednonóż', 'Przysiad bułgarski']);
    expect(r.exercises[0].setsLog).toEqual([{ reps: 5, repsR: 3 }]);
    expect(r.exercises[0].perSide).toBe(true);
    expect(r.exercises[1].setsLog).toEqual(Array(3).fill({ reps: 5, repsR: 4 }));
    expect(r.exercises[1].reps).toBe('5/4');
  });
  it('„Plank 3x45s” — na czas', () => {
    const r = one('Plank 3x45s');
    expect(r.exercises[0]).toMatchObject({ name: 'Plank', reps: '45 s' });
    expect(r.exercises[0].setsLog).toEqual(Array(3).fill({ reps: 45, unit: 's' }));
  });
  it('kontrola sensowności i pominięte linie', () => {
    const r = one('Przysiad\n18x5x100\nTrening A\nbla bla');
    expect(r.warnings.join(' ')).toMatch(/18 serii/);
    expect(r.skipped).toEqual(['Trening A', 'bla bla']);
  });
  it('dopasowanie jednostki planu: po nazwie albo ćwiczeniach', () => {
    const ws = [
      { id: 'a', name: 'A – dół ciała', exercises: [{ name: 'Przysiad' }, { name: 'Martwy ciąg' }, { name: 'Wykroki' }] },
      { id: 'b', name: 'B – góra', exercises: [{ name: 'Wyciskanie leżąc' }, { name: 'Wiosłowanie' }] },
    ];
    expect(matchNoteWorkout(one('A – dół ciała\nPrzysiad 3x5 100kg'), ws)).toMatchObject({ id: 'a', by: 'name' });
    expect(matchNoteWorkout(one('Wyciskanie leżąc 3x5 80kg\nWiosłowanie 3x8 60kg'), ws)).toMatchObject({ id: 'b', by: 'exercises' });
    expect(matchNoteWorkout(one('Plank 3x45s'), ws)).toBeNull();
  });
});
