import { describe, expect, it } from 'vitest';
import type { Absence } from '../domain';
import { applyComeback, comebackFor, comebackRule, comebackText, reducedLoad, restoreFull } from './comeback';
import type { Run, RunExercise, RunSet } from './run';

const S = (date: string) => ({ date });
const set = (load: string, extra: Partial<RunSet> = {}): RunSet => ({ load, reps: '8', rpe: '', done: false, warmup: false, sug: '', edited: false, tRpe: '', spec: '', rest: '', ...extra });
const ex = (name: string, sets: RunSet[], extra: Partial<RunExercise> = {}): RunExercise => ({ name, rest: '', tempo: null, tempoStr: '', notes: '', sets, ...extra });
const run = (exs: RunExercise[]): Run => ({ planId: 'p', workoutId: 'w', name: 'T1', planName: '', weekName: '', date: '2026-10-26', startedAt: 0, idx: 0, ex: exs });

describe('comebackFor — czy to pierwszy trening po przerwie', () => {
  it('≥ 14 dni od ostatniego treningu (domyślnie)', () => {
    expect(comebackFor([S('2026-10-08')], '2026-10-26', undefined)).toEqual({ days: 18, pct: 15 });
    expect(comebackFor([S('2026-10-13')], '2026-10-26', undefined)).toBeNull();
  });
  it('próg i obniżka trenera; wyłączone', () => {
    expect(comebackFor([S('2026-10-16')], '2026-10-26', { days: 10, pct: 20 })).toEqual({ days: 10, pct: 20 });
    expect(comebackFor([S('2026-09-01')], '2026-10-26', { days: 14, pct: 15, off: true })).toBeNull();
  });
  it('bez historii i z treningiem już dziś — nie', () => {
    expect(comebackFor([], '2026-10-26', undefined)).toBeNull();
    expect(comebackFor([S('2026-09-01'), S('2026-10-26')], '2026-10-26', undefined)).toBeNull();
  });
  it('zgłoszona nieobecność liczy się jak przerwa', () => {
    const abs: Absence[] = [{ id: 'a', from: '2026-10-10', to: '2026-10-24', reason: 'choroba', at: '' }];
    // trening tuż przed chorobą; pojedynczy trening w trakcie nieobecności nie kasuje przerwy
    expect(comebackFor([S('2026-10-09')], '2026-10-26', undefined, abs)).toEqual({ days: 17, pct: 15 });
    expect(comebackFor([S('2026-10-20')], '2026-10-26', undefined, [{ ...abs[0], from: '2026-10-05', to: '2026-10-24' }])).toEqual({ days: 20, pct: 15 });
    expect(comebackFor([S('2026-10-04')], '2026-10-26', { days: 30, pct: 15 }, [{ ...abs[0], from: '2026-09-20', to: '2026-10-24' }])).toEqual({ days: 35, pct: 15 });
  });
  it('granice reguły', () => {
    expect(comebackRule({ days: 2, pct: 90 })).toEqual({ days: 7, pct: 40 });
    expect(comebackRule(undefined)).toEqual({ days: 14, pct: 15 });
  });
});

describe('obniżenie ciężarów', () => {
  it('zaokrąglenie: sztanga 2,5 kg, hantle 1 kg', () => {
    expect(reducedLoad(100, 15, false)).toBe(85);
    expect(reducedLoad(60, 15, false)).toBe(50);
    expect(reducedLoad(22, 15, true)).toBe(19);
  });
  it('applyComeback i „Użyj pełnych ciężarów”', () => {
    const r = run([
      ex('Przysiad ze sztangą', [set('60'), set('60', { done: true }), set('', {}), set('70', { edited: true })]),
      ex('Wyciskanie hantli', [set('22')]),
      ex('Bieżnia', [set('')], { cardio: true }),
    ]);
    const { run: low, orig } = applyComeback(r, 15);
    expect(low.ex[0].sets.map((s) => s.load)).toEqual(['50', '60', '', '70']);
    expect(low.ex[1].sets[0].load).toBe('19');
    expect(orig).toEqual({ '0-0': '60', '1-0': '22' });
    expect(r.ex[0].sets[0].load).toBe('60'); // wejście bez zmian
    // po zaliczeniu jednej serii przywrócenie dotyczy tylko reszty
    low.ex[1].sets[0].done = true;
    const full = restoreFull(low, orig);
    expect(full.ex[0].sets[0].load).toBe('60');
    expect(full.ex[1].sets[0].load).toBe('19');
  });
  it('komunikat', () => {
    expect(comebackText({ days: 18, pct: 15 })).toBe('Wracamy spokojnie: ciężary −15% po 18 dniach przerwy');
  });
});
