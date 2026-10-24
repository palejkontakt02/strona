import { describe, expect, it } from 'vitest';
import type { TrainingSession } from '../domain';
import { buildRunExercise, completeSet } from './run';
import {
  barbellByName,
  checkRecord,
  currentMax,
  e1rmHistory,
  exerciseRecords,
  newRecord,
  percentToKg,
  platesFor,
  platesText,
  roundLoad,
  sessionRecords,
} from './strength';
import { cleanPainMap, painLabel, painSummary, removePain, setPainLevel, togglePain } from './painMap';

const sess = (date: string, sets: { load: number; reps: number; rpe?: number; warmup?: boolean }[], name = 'Przysiad ze sztangą'): TrainingSession => ({
  id: date,
  clientId: 'c',
  date,
  charge: 'brak',
  exercises: [{ name, sets: String(sets.length), reps: '', load: '', setsLog: sets }],
});

const hist = [
  sess('2026-09-01', [{ load: 60, reps: 5, warmup: true }, { load: 100, reps: 5 }, { load: 100, reps: 5 }]),
  sess('2026-09-08', [{ load: 110, reps: 3 }, { load: 90, reps: 8 }]),
  sess('2026-09-15', [{ load: 120, reps: 1 }]),
];

describe('rekordy', () => {
  it('exerciseRecords: 1RM / 3RM / 5RM i najlepsze e1RM z datami', () => {
    const r = exerciseRecords(hist, 'Przysiad ze sztangą');
    expect(r.rm[1]).toMatchObject({ load: 120, reps: 1, date: '2026-09-15' });
    expect(r.rm[3]).toMatchObject({ load: 110, reps: 3, date: '2026-09-08' });
    expect(r.rm[5]).toMatchObject({ load: 100, reps: 5, date: '2026-09-01' }); // pierwsza data przy remisie
    // 90 × 8 → 114; 110 × 3 → 121; 120 × 1 → 120; 100 × 5 → 116,7
    expect(r.e1).toMatchObject({ load: 110, reps: 3, e1: 121 });
    expect(exerciseRecords(hist, 'Wyciskanie leżąc').e1).toBeNull();
  });
  it('e1rmHistory: punkt na dzień, od najstarszego', () => {
    expect(e1rmHistory(hist, 'Przysiad ze sztangą')).toEqual([
      { date: '2026-09-01', e1: 116.7, load: 100, reps: 5 },
      { date: '2026-09-08', e1: 121, load: 110, reps: 3 },
      { date: '2026-09-15', e1: 120, load: 120, reps: 1 },
    ]);
  });
  it('newRecord: 5RM i e1RM, tekst', () => {
    const r = exerciseRecords(hist, 'Przysiad ze sztangą');
    const hit = newRecord(r, { load: 105, reps: 5 });
    expect(hit).toMatchObject({ kind: 5, e1Record: true });
    expect(hit?.text).toBe('Nowy rekord: 5 × 105 kg (szac. max 123 kg)');
    expect(newRecord(r, { load: 100, reps: 5 })).toBeNull();
    // 112,5 × 2: bije 1RM? nie (120); 3RM wymaga 3 powt.; e1 = 120 → nie
    expect(newRecord(r, { load: 112.5, reps: 2 })).toBeNull();
    // 95 × 10 → e1 126,7 > 121 — tylko szacowane maks. (i 5RM bo 95 < 100 → nie)
    expect(newRecord(r, { load: 95, reps: 10 })).toMatchObject({ kind: 'e1' });
  });
  it('pierwszy trening ćwiczenia nie jest rekordem; wcześniejsze serie dnia się liczą', () => {
    expect(checkRecord([], 'Przysiad ze sztangą', [{ load: 80, reps: 5 }], { load: 90, reps: 5 })).toBeNull();
    expect(checkRecord(hist, 'Przysiad ze sztangą', [], { load: 105, reps: 5 })?.kind).toBe(5);
    expect(checkRecord(hist, 'Przysiad ze sztangą', [{ load: 105, reps: 5 }], { load: 105, reps: 5 })).toBeNull();
  });
  it('sessionRecords: najlepszy rekord per ćwiczenie, bez rozgrzewek', () => {
    const out = sessionRecords(hist, [
      { name: 'Przysiad ze sztangą', sets: [{ load: 130, reps: 1, warmup: true }, { load: 105, reps: 5 }, { load: 107.5, reps: 5 }] },
      { name: 'Nowe ćwiczenie', sets: [{ load: 50, reps: 5 }] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].hit.load).toBe(107.5);
  });
});

describe('% maksa i zaokrąglenie', () => {
  it('percentToKg wg sprzętu', () => {
    expect(percentToKg(75, 140, 'Przysiad ze sztangą')).toBe(105);
    expect(percentToKg(72, 140, 'Przysiad ze sztangą')).toBe(100); // 100,8 → 100
    expect(percentToKg(70, 30, 'Wyciskanie hantli')).toBe(22); // 21 → co 2 kg
    expect(percentToKg(70, 12, 'Wznosy hantli bokiem')).toBe(8); // 8,4 → co 1 kg
    expect(percentToKg(70, 60, 'Wyciskanie hantli', 'sum')).toBe(44); // 21 na hantel → 22 × 2
    expect(percentToKg(0, 100, 'x')).toBe(0);
    expect(roundLoad(0.3, 'hantle')).toBe(1);
  });
  it('currentMax: najnowszy test, inaczej e1RM', () => {
    const tests = [{ name: '1RM przysiad', date: '2026-10-01', value: 132 }, { name: '1RM przysiad', date: '2026-10-12', value: 140 }];
    expect(currentMax(hist, tests, 'Przysiad ze sztangą')).toMatchObject({ value: 140, source: 'test', label: 'z testu 140 kg (12.10)' });
    expect(currentMax(hist, [], 'Przysiad ze sztangą')?.source).toBe('e1');
    expect(currentMax([], [], 'Przysiad ze sztangą')).toBeNull();
  });
  it('plan „75% 1RM” → kg z najnowszego testu, nawet gdy trening był później', () => {
    const later = [...hist, sess('2026-10-20', [{ load: 100, reps: 5 }])];
    const tests = [{ name: '1RM przysiad', date: '2026-10-12', value: 140 }];
    const r = buildRunExercise({ id: 'e', name: 'Przysiad ze sztangą', groups: [{ type: 'Robocze', sets: '2', reps: '5', load: '75% 1RM', rpe: '' }] }, later, undefined, tests as never);
    expect(r.sets.map((s) => s.load)).toEqual(['105', '105']);
    expect(r.sets[0].sug).toBe('75% z testu 140 kg (12.10)');
  });
  it('hantle: % i autoregulacja zaokrąglone do 2 kg', () => {
    const h = [sess('2026-09-01', [{ load: 30, reps: 8 }], 'Wyciskanie hantli')];
    const r = buildRunExercise({ id: 'e', name: 'Wyciskanie hantli', groups: [{ type: 'Robocze', sets: '1', reps: '8', load: '70%', rpe: '' }, { type: 'Robocze', sets: '1', reps: '8', load: '', rpe: '8' }] }, h);
    expect(Number(r.sets[0].load) % 2).toBe(0);
    const sets = r.sets.map((s) => ({ ...s }));
    sets[0].rpe = '7';
    sets[0].load = '26';
    const res = completeSet({ ...r, sets }, 0);
    expect(Number(res.sets[1].load) % 2).toBe(0);
  });
});

describe('talerze', () => {
  it('na stronę dla gryfu 20 i 15 kg', () => {
    expect(platesFor(95)).toEqual({ perSide: [25, 10, 2.5], achieved: 95, diff: 0 });
    expect(platesText(platesFor(95).perSide)).toBe('25 + 10 + 2,5 na stronę');
    expect(platesFor(60, 15).perSide).toEqual([20, 2.5]);
    expect(platesFor(22.5).perSide).toEqual([1.25]);
    expect(platesFor(20)).toEqual({ perSide: [], achieved: 20, diff: 0 });
    expect(platesText([])).toBe('sam gryf');
  });
  it('wartości niemożliwe', () => {
    expect(platesFor(101)).toMatchObject({ achieved: 100, diff: 1 });
    expect(platesFor(10).diff).toBe(-10);
  });
  it('rozpoznaje sztangę', () => {
    expect(barbellByName('Przysiad ze sztangą')).toBe(true);
    expect(barbellByName('Martwy ciąg')).toBe(true);
    expect(barbellByName('Wyciskanie hantli')).toBe(false);
    expect(barbellByName('Przysiad bułgarski')).toBe(false);
    expect(barbellByName('Plank boczny')).toBe(false);
  });
});

describe('mapa bólu', () => {
  it('dodaje, zmienia, usuwa i opisuje punkty', () => {
    let s = togglePain([], 'kolano', 'P');
    expect(s).toEqual([{ area: 'kolano', side: 'P', level: 5 }]);
    s = setPainLevel(s, 'kolano', 'P', 12);
    expect(s[0].level).toBe(10);
    s = setPainLevel(s, 'odcinek lędźwiowy', undefined, 3);
    expect(s[1]).toEqual({ area: 'odcinek lędźwiowy', level: 3 });
    expect(painSummary(s)).toBe('Kolano P 10, Odcinek lędźwiowy 3');
    expect(painLabel({ area: 'bark', side: 'L' })).toBe('Bark L');
    expect(togglePain(s, 'kolano', 'P')).toHaveLength(1);
    expect(removePain(s, 'kolano', 'L')).toHaveLength(2);
    expect(cleanPainMap([...s, { area: 'stopa', side: 'L', level: 0 }])).toHaveLength(2);
  });
});

describe('obwód: następna seria', () => {
  it('A1 → A2 w tej samej rundzie, po rundzie znowu A1', async () => {
    const { adHocExercise, appendExercise, emptyRun, nextBlockSet } = await import('./run');
    let run = appendExercise(emptyRun('x', '2026-10-24'), adHocExercise('A', 3, '10', '20'));
    run = appendExercise(run, { ...adHocExercise('B', 3, '10', '20'), linked: true });
    expect(nextBlockSet(run, [0, 1])).toMatchObject({ k: 0, i: 0, round: 0, rounds: 3 });
    run.ex[0].sets[0].done = true;
    expect(nextBlockSet(run, [0, 1])).toMatchObject({ k: 1, i: 0, round: 0 });
    run.ex[1].sets[0].done = true;
    expect(nextBlockSet(run, [0, 1])).toMatchObject({ k: 0, i: 1, round: 1 });
  });
});
