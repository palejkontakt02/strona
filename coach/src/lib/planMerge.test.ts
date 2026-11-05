import { describe, expect, it } from 'vitest';
import { createSeed } from '../data/seed';
import { planWorkbook } from './excelExport';
import { mergePlan } from './planMerge';
import { detectColumns, sheetToPlan } from './sheetImport';
import { readXlsx } from './xlsxRead';
import { xlsx } from './xlsxWrite';

const db = createSeed();
const plan = db.plans.find((p) => p.weeks.length > 1 && p.weeks.some((w) => w.workouts.length))!;
const fromRows = (rows: string[][]) => {
  const c = detectColumns(rows);
  return sheetToPlan(rows, c.map, c.headerRow, { clientId: plan.clientId, startDate: plan.startDate ?? '2026-11-02', today: '2026-11-05' }).plan;
};

describe('wczytanie zmian z arkusza do istniejącego planu', () => {
  it('plik bez zmian → brak różnic, te same id tygodni, jednostek i ćwiczeń', async () => {
    const rows = await readXlsx(xlsx(planWorkbook(plan)));
    const { plan: out, diff } = mergePlan(plan, fromRows(rows));
    expect(diff.lines).toEqual([]);
    expect(out.id).toBe(plan.id);
    const ids = (p: typeof plan) => p.weeks.flatMap((w) => [w.id, ...w.workouts.flatMap((k) => [k.id, ...k.exercises.filter((e) => e.name.trim()).map((e) => e.id)])]);
    expect(ids(out)).toEqual(ids(plan));
  });
  it('zmiana ciężaru, dodane i usunięte ćwiczenie — opisane i zachowane id pozostałych', async () => {
    const rows = await readXlsx(xlsx(planWorkbook(plan)));
    const head = rows[0];
    const ci = head.indexOf('Ćwiczenie');
    const li = head.indexOf('Ciężar');
    const first = rows[1][ci];
    // pierwsze ćwiczenie pierwszej jednostki: nowy ciężar
    rows.forEach((r, i) => i > 0 && r[ci] === first && r[0] === rows[1][0] && r[2] === rows[1][2] && (r[li] = '123'));
    // drugie ćwiczenie: usunięte; na końcu nowe
    const second = rows.slice(1).find((r) => r[0] === rows[1][0] && r[2] === rows[1][2] && r[ci] !== first)![ci];
    const kept = rows.filter((r, i) => i === 0 || !(r[0] === rows[1][0] && r[2] === rows[1][2] && r[ci] === second));
    kept.splice(2, 0, [...rows[1].map((c, j) => (j === ci ? 'Wykroki chodzone' : j === li ? '20' : c))]);
    const { plan: out, diff } = mergePlan(plan, fromRows(kept));
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(diff.changed).toBeGreaterThanOrEqual(1);
    expect(diff.lines[0]).toMatch(/dodane: Wykroki chodzone/);
    expect(diff.lines[0]).toMatch(/usunięte:/);
    expect(diff.lines[0]).toMatch(/123/);
    const k0 = plan.weeks[0].workouts.find((k) => k.name === out.weeks[0].workouts[0].name)!;
    const firstOld = k0.exercises.find((e) => e.name.trim())!;
    expect(out.weeks[0].workouts[0].id).toBe(k0.id);
    expect(out.weeks[0].workouts[0].exercises.find((e) => e.name === firstOld.name)!.id).toBe(firstOld.id);
  });
});
