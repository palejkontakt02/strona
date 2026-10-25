import { describe, expect, it } from 'vitest';
import type { DayLog } from '../domain';
import { hasFood, hasMacroTargets, kcalFromMacros, lastDays, macroStatus, weeklyAverages } from './nutrition';

describe('nutrition', () => {
  it('status vs target', () => {
    expect(macroStatus('protein', 100, 150)).toBe('low'); // 67%
    expect(macroStatus('protein', 125, 150)).toBe('ok'); // 83%
    expect(macroStatus('protein', 300, 150)).toBe('ok'); // białko powyżej celu nie jest ostrzeżeniem
    expect(macroStatus('kcal', 2700, 2000)).toBe('high');
    expect(macroStatus('kcal', 2300, 2000)).toBe('ok');
    expect(macroStatus('carbs', 100, undefined)).toBe('none');
    expect(macroStatus('fat', undefined, 70)).toBe('none');
  });
  it('flags', () => {
    expect(hasFood({ date: '2026-10-10', steps: 5000 })).toBe(false);
    expect(hasFood({ date: '2026-10-10', shot: 'idb:x' })).toBe(true);
    expect(hasFood({ date: '2026-10-10', fat: 0 })).toBe(true);
    expect(hasMacroTargets({ steps: 8000 })).toBe(false);
    expect(hasMacroTargets({ carbs: 250 })).toBe(true);
    expect(kcalFromMacros({ protein: 100, fat: 50, carbs: 200 })).toBe(1650);
    expect(kcalFromMacros({})).toBeNull();
  });
  it('last days and weekly averages', () => {
    const log: DayLog[] = [
      { date: '2026-10-18', kcal: 2000, protein: 150 },
      { date: '2026-10-17', kcal: 2400 },
      { date: '2026-10-12', kcal: 1600, protein: 100, steps: 3000 },
      { date: '2026-10-10', kcal: 3000, fat: 90 },
      { date: '2026-10-05', kcal: 9999 }, // ostatni z 14 dni
      { date: '2026-10-04', kcal: 1 }, // poza 14 dniami
    ];
    const d = lastDays(log, '2026-10-18', 14);
    expect(d).toHaveLength(14);
    expect(d[0].date).toBe('2026-10-18');
    expect(d[13].date).toBe('2026-10-05');
    const [w1, w2] = weeklyAverages(log, '2026-10-18', 2);
    expect(w1).toMatchObject({ from: '2026-10-12', to: '2026-10-18', days: 3 });
    expect(w1.avg.kcal).toBe(2000);
    expect(w1.avg.protein).toBe(125);
    expect(w1.avg.fat).toBeUndefined();
    expect(w2).toMatchObject({ from: '2026-10-05', to: '2026-10-11', days: 2 });
    expect(w2.avg.kcal).toBeCloseTo((3000 + 9999) / 2);
    expect(w2.avg.fat).toBe(90);
  });
});
