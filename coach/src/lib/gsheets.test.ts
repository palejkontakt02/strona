import { describe, expect, it } from 'vitest';
import { createSeed } from '../data/seed';
import { planSheetValues } from './gsheets';
import { mergePlan } from './planMerge';
import { detectColumns, normRest, sheetToPlan } from './sheetImport';

const db = createSeed();

describe('Arkusze Google ↔ plan', () => {
  it('plan → arkusz → (wartości jak w Arkuszach po polsku) → ten sam plan, bez różnic', () => {
    for (const plan of db.plans.filter((p) => p.weeks.some((w) => w.workouts.some((k) => k.exercises.length)))) {
      const values = planSheetValues(plan);
      // Arkusze Google (pl_PL) zwracają liczby z przecinkiem
      const rows = values.map((r) => r.map((c) => (typeof c === 'number' ? String(c).replace('.', ',') : c)));
      const c = detectColumns(rows);
      const back = sheetToPlan(rows, c.map, c.headerRow, { clientId: plan.clientId, startDate: plan.startDate ?? '2026-11-02', today: '2026-11-05' }).plan;
      expect(mergePlan(plan, back).diff.lines, plan.name).toEqual([]);
    }
  });
  it('przerwa wpisana w Arkuszach jako „1:30” (zamieniona na godzinę 1:30:00) to 1 min 30 s', () => {
    expect(normRest('1:30:00')).toBe('1:30');
    expect(normRest('2:00')).toBe('2:00');
  });
});
