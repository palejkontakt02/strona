import { describe, expect, it } from 'vitest';
import type { Plan, SetGroup, TrainingSession } from '../domain';
import { applySuggestions, suggestLoads } from './loadSuggest';
import { stepLoad, scaleLoad } from './strength';

const g = (reps: string, load: string, rpe = '8', type: SetGroup['type'] = 'Robocze', sets = '1'): SetGroup => ({ type, sets, reps, load, rpe });
const SQ = 'Przysiad ze sztangą';
const DB = 'Wyciskanie hantli na ławce';
const sq = (load = '100', sets = '3', rpe = '8') => ({ id: 'e1', name: SQ, groups: [g('6–8', load, rpe, 'Robocze', sets)] });
const db = (load = '12') => ({ id: 'e2', name: DB, groups: [g('8–10', load, '8', 'Robocze', '3')] });
const ses = (date: string, wid: string | undefined, name: string, sets: [number, number, number?][], extra: Partial<TrainingSession> = {}): TrainingSession => ({
  id: `s-${date}-${name}`, clientId: 'c', date, charge: 'pakiet' as TrainingSession['charge'], planId: wid ? 'p' : 'old', workoutId: wid,
  exercises: [{ name, setsLog: sets.map(([load, reps, rpe]) => ({ load, reps, rpe, done: true })) }], ...extra,
});
const TODAY = '2026-10-26';

describe('loadSuggest r5', () => {
  it('tydzień docelowy per ćwiczenie: najbliższe wystąpienie od następnego treningu', () => {
    // T1: A (przysiad) | T2: B (hantle) | T3: A (przysiad)
    const p: Plan = { id: 'p', clientId: 'c', name: 'P', active: true, weeks: [
      { id: 'w1', name: 'Tydzień 1', workouts: [{ id: 'k1', name: 'A', exercises: [sq()] }] },
      { id: 'w2', name: 'Tydzień 2', workouts: [{ id: 'k2', name: 'B', exercises: [db()] }] },
      { id: 'w3', name: 'Tydzień 3', workouts: [{ id: 'k3', name: 'A', exercises: [sq()] }] },
    ] };
    const r = suggestLoads(p, [ses('2026-10-19', 'k1', SQ, [[100, 8, 7], [100, 8, 7], [100, 8, 7]]), ses('2026-10-12', undefined, DB, [[12, 10, 7], [12, 10, 7], [12, 10, 7]])], TODAY)!;
    expect(r.weekIndex).toBe(1);
    const bySq = r.items.find((x) => x.exercise === SQ)!;
    const byDb = r.items.find((x) => x.exercise === DB)!;
    expect(bySq.weekIndex).toBe(2);
    expect(byDb.weekIndex).toBe(1);
    // hantle: realny krok 2 kg (12 → 14), opis zgodny
    expect(byDb).toMatchObject({ kind: 'add', last: 12, next: 14, tag: 'dodaj +2 kg' });
    expect(byDb.why).toMatch(/\(\+2 kg\)/);
    expect(bySq).toMatchObject({ next: 102.5, tag: 'dodaj +2,5 kg' });
    const out = applySuggestions(p, r.weekIndex, r.items);
    expect(out.weeks[2].workouts[0].exercises[0].groups[0].load).toBe('102.5');
    expect(out.weeks[0].workouts[0].exercises[0].groups[0].load).toBe('100');
    expect(out.weeks[1].workouts[0].exercises[0].groups[0].load).toBe('14');
  });

  const p3 = (w2: ReturnType<typeof sq>, name2 = 'Tydzień 2'): Plan => ({ id: 'p', clientId: 'c', name: 'P', active: true, weeks: [
    { id: 'w1', name: 'Tydzień 1', workouts: [{ id: 'k1', name: 'A', exercises: [sq()] }] },
    { id: 'w2', name: name2, workouts: [{ id: 'k2', name: 'A', exercises: [w2] }] },
  ] });
  const good = [ses('2026-10-19', 'k1', SQ, [[100, 8, 7], [100, 8, 7], [100, 8, 7]])];

  it('deload (nazwa, mniej serii, niższe RPE) — utrzymaj, nie dodaj', () => {
    for (const p of [p3(sq(), 'Deload'), p3(sq('90', '2')), p3(sq('100', '3', '6'))]) {
      const it = suggestLoads(p, good, TODAY)!.items[0];
      expect(it).toMatchObject({ kind: 'hold', reason: 'deload', tag: 'utrzymaj (deload)', already: true });
    }
    expect(suggestLoads(p3(sq('90', '2')), good, TODAY)!.items[0].next).toBe(90);
  });

  it('ból ≥ 5 w ostatnich 2 treningach — nie dodaj, uzasadnienie „ból”', () => {
    const it = suggestLoads(p3(sq()), [{ ...good[0], pain: 6 }], TODAY)!.items[0];
    expect(it).toMatchObject({ kind: 'hold', reason: 'pain', tag: 'utrzymaj (ból)', next: 100 });
    expect(it.why).toMatch(/Ból 6/);
    const later = ses('2026-10-21', undefined, 'Wiosłowanie', [[50, 10, 7]], { stoppedForPain: { level: 7 } });
    expect(suggestLoads(p3(sq()), [...good, later], TODAY)!.items.find((x) => x.exercise === SQ)!.kind).toBe('hold');
    expect(suggestLoads(p3(sq()), [{ ...good[0], pain: 3 }], TODAY)!.items[0].kind).toBe('add');
  });

  it('nowy blok bez sesji — historia po nazwie z innych planów', () => {
    const r = suggestLoads(p3(sq()), [ses('2026-10-19', undefined, SQ, [[100, 8, 7], [100, 8, 7], [100, 8, 7]])], TODAY)!;
    expect(r.weekIndex).toBe(0);
    expect(r.items[0]).toMatchObject({ kind: 'add', weekIndex: 0, next: 102.5 });
  });

  it('realne kroki', () => {
    expect(stepLoad(100, SQ)).toBe(102.5);
    expect(stepLoad(8, 'Wiosłowanie hantlem')).toBe(9);
    expect(stepLoad(10, 'Wiosłowanie hantlem', undefined, -1)).toBe(9);
    expect(stepLoad(24, 'Wyciskanie hantli', 'sum')).toBe(28);
    expect(stepLoad(12, 'Unoszenie talerza')).toBe(13);
    expect(scaleLoad(40, 0.025, 'Hip thrust')).toBe(42.5);
    expect(scaleLoad(12, 0.025, 'Wyciskanie hantli')).toBe(14);
    expect(scaleLoad(200, 0.05, SQ)).toBe(210);
    expect(scaleLoad(15, 0.05, 'Unoszenie talerza')).toBe(16);
  });
});
