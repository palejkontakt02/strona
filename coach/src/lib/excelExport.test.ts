import { describe, expect, it } from 'vitest';
import { createSeed } from '../data/seed';
import { planWorkbook, sessionWorkbook, sessionsWorkbook, xlsxName } from './excelExport';
import { detectColumns, parseTable, planToCsv, sheetToPlan } from './sheetImport';
import { readXlsx } from './xlsxRead';
import { sheetName, xlsx } from './xlsxWrite';

const db = createSeed();
const plan = db.plans.find((p) => p.weeks.length > 1 && p.weeks.some((w) => w.workouts.length))!;
const sess = db.sessions.find((s) => s.exercises.some((e) => e.setsLog?.length)) ?? db.sessions.find((s) => s.exercises.length)!;

describe('xlsx — zapis i odczyt', () => {
  it('plik czyta się z powrotem (polskie znaki, liczby, puste komórki)', async () => {
    const bytes = xlsx([{ name: 'Test', rows: [['Ćwiczenie', 'Ciężar'], ['Przysiad ze sztangą', 62.5], ['Wykroki „L/P”', null, '8/str.']], header: true }]);
    const rows = await readXlsx(bytes);
    expect(rows[0].slice(0, 2)).toEqual(['Ćwiczenie', 'Ciężar']);
    expect(rows[1].slice(0, 2)).toEqual(['Przysiad ze sztangą', '62.5']);
    expect(rows[2][0]).toBe('Wykroki „L/P”');
    expect(rows[2][2]).toBe('8/str.');
  });
  it('nazwy arkuszy: bez zakazanych znaków, maks. 31, bez powtórzeń', () => {
    expect(sheetName('A/B: siła [1]')).toBe('A B siła 1');
    expect(sheetName('x'.repeat(40)).length).toBe(31);
    expect(sheetName('Plan', ['plan'])).toBe('Plan 2');
  });
  it('nazwa pliku bez polskich znaków', () => {
    expect(xlsxName('plan', 'S&C – siła i moc')).toBe('plan-s-c-sila-i-moc.xlsx');
    expect(xlsxName('trening', 'Julia Wiśniewska', '2026-10-27')).toBe('trening-julia-wisniewska-2026-10-27.xlsx');
  });
});

describe('plan do Excela', () => {
  it('arkusz „Plan” wczytuje się z powrotem przez import (te same ćwiczenia)', async () => {
    const rows = await readXlsx(xlsx(planWorkbook(plan)));
    const c = detectColumns(rows);
    const back = sheetToPlan(rows, c.map, c.headerRow, { clientId: plan.clientId, startDate: plan.startDate ?? '2026-11-02', today: '2026-11-04' }).plan;
    // ten sam wynik co dotychczasowy eksport CSV → import
    const csvRows = parseTable(planToCsv(plan));
    const cc = detectColumns(csvRows);
    const viaCsv = sheetToPlan(csvRows, cc.map, cc.headerRow, { clientId: plan.clientId, startDate: plan.startDate ?? '2026-11-02', today: '2026-11-04' }).plan;
    const names = (p: typeof plan) => p.weeks.flatMap((w) => w.workouts.flatMap((k) => k.exercises.map((e) => `${e.name}|${e.groups.map((g) => `${g.sets}x${g.reps}@${g.load}`).join(',')}`)));
    expect(back.weeks.length).toBe(plan.weeks.length);
    expect(names(back)).toEqual(names(viaCsv));
  });
  it('arkusz „Tygodnie”: jednostka, nagłówek tygodni i ćwiczenia', () => {
    const grid = planWorkbook(plan, { name: 'Jan Kowalski' })[1].rows;
    const flat = grid.map((r) => r.map((c) => (c != null && typeof c === 'object' ? c.v : c)));
    expect(flat[0][0]).toBe(plan.name);
    expect(flat.some((r) => r[0] === 'Ćwiczenie' && r.length === 1 + plan.weeks.filter((w) => w.workouts.some((k) => k.name === plan.weeks[0].workouts[0].name)).length)).toBe(true);
  });
});

describe('treningi do Excela', () => {
  it('jeden trening: dane i serie', () => {
    const rows = sessionWorkbook(sess, { name: 'Jan' }, true)[0].rows.map((r) => r.map((c) => (c != null && typeof c === 'object' ? c.v : c)));
    expect(rows[0][1]).toBe(sess.workoutName || 'Trening');
    const head = rows.findIndex((r) => r[0] === 'Ćwiczenie');
    const setCount = sess.exercises.filter((e) => e.name.trim()).reduce((a, e) => a + Math.max(1, e.setsLog?.length ?? 0), 0);
    expect(rows.length - head - 1).toBe(setCount);
  });
  it('wszystkie treningi: wiersz na trening i na serię', () => {
    const ss = db.sessions.filter((s) => s.clientId === sess.clientId);
    const [list, sets] = sessionsWorkbook(ss, () => true);
    expect(list.rows.length).toBe(ss.length + 1);
    expect(sets.rows.length).toBeGreaterThan(ss.length);
  });
});
