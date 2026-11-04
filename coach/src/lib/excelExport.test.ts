import { describe, expect, it } from 'vitest';
import { createSeed } from '../data/seed';
import { planExRows, planWorkbook, sessionExRows, sessionWorkbook, sessionsWorkbook, splitTempo, xlsxName } from './excelExport';
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

describe('układ tabeli: ćwiczenie w wierszu, seria w kolumnie, na końcu RPE / tempo / uwagi', () => {
  it('plan: nagłówek „Ćwiczenie | Seria 1…N | RPE | Tempo | Uwagi” i ćwiczenia jedno pod drugim', () => {
    const rows = planWorkbook(plan)[0].rows.map((r) => r.map((c) => (c != null && typeof c === 'object' ? c.v : c)));
    const hi = rows.findIndex((r) => r[0] === 'Ćwiczenie');
    const head = rows[hi];
    expect(head[1]).toBe('Seria 1');
    expect(head.slice(-3)).toEqual(['RPE', 'Tempo', 'Uwagi']);
    const k = plan.weeks[0].workouts.find((w) => w.exercises.some((e) => e.name.trim()))!;
    const first = k.exercises.find((e) => e.name.trim())!;
    expect(String(rows[hi + 1][0])).toContain(first.name);
  });
  it('seria jako „powt. × ciężar”, tempo wyciągnięte z uwag', () => {
    const r = planExRows({ id: 'w', name: 'A', exercises: [{ id: 'e', name: 'Przysiad', notes: 'tempo 3-1-X-0, kolana na zewnątrz', groups: [{ type: 'Rozgrzewka', sets: '1', reps: '5', load: '40', rpe: '' }, { type: 'Robocze', sets: '3', reps: '8', load: '62.5', rpe: '8' }] }] } as never)[0];
    expect(r.sets).toEqual(['R 5 × 40 kg', '8 × 62,5 kg', '8 × 62,5 kg', '8 × 62,5 kg']);
    expect(r.rpe).toBe('8');
    expect(r.tempo).toBe('3-1-X-0');
    expect(r.notes).toBe('kolana na zewnątrz');
    expect(splitTempo('bez tempa').tempo).toBe('');
  });
  it('trening: jeden wiersz na ćwiczenie, serie w kolumnach', () => {
    const rows = sessionWorkbook(sess, { name: 'Jan' }, true)[0].rows.map((r) => r.map((c) => (c != null && typeof c === 'object' ? c.v : c)));
    expect(rows[0][1]).toBe(sess.workoutName || 'Trening');
    const hi = rows.findIndex((r) => r[0] === 'Ćwiczenie');
    const n = sess.exercises.filter((e) => e.name.trim()).length;
    expect(rows.slice(hi + 1).filter((r) => r.length && r[0]).length).toBe(n);
    const sx = sessionExRows({ ...sess, exercises: [{ name: 'Wiosłowanie', setsLog: [{ reps: 10, load: 30, rpe: 7 }, { reps: 8, load: 32.5, rpe: 8 }] }] });
    expect(sx[0].sets).toEqual(['10 × 30 kg', '8 × 32,5 kg']);
    expect(sx[0].rpe).toBe('7 / 8');
  });
  it('wszystkie treningi: lista i tabela każdego treningu', () => {
    const ss = db.sessions.filter((s) => s.clientId === sess.clientId);
    const [list, sets] = sessionsWorkbook(ss, () => true);
    expect(list.rows.length).toBe(ss.length + 1);
    expect(sets.rows.filter((r) => r[0] != null && typeof r[0] === 'object' && r[0].v === 'Ćwiczenie').length).toBe(ss.filter((s) => s.exercises.some((e) => e.name.trim())).length);
  });
});
