import { describe, expect, it } from 'vitest';
import { createSeed } from '../data/seed';
import { mergePlan } from './planMerge';
import { doneText, fitowaWorkbook, isRunPlan, readTemplate, templateWorkbook } from './planTemplate';
import { detectColumns, sheetToPlan } from './sheetImport';
import { normalizeLayout } from './sheetLayouts';
import { readXlsxSheets } from './xlsxRead';
import { xlsx } from './xlsxWrite';
import type { TrainingSession } from '../domain';

const db = createSeed();
const back = async (sheets: ReturnType<typeof templateWorkbook>, start = '2026-11-16') => {
  const read = await readXlsxSheets(xlsx(sheets));
  const l = normalizeLayout(read)!;
  const c = detectColumns(l.rows);
  return { l, plan: sheetToPlan(l.rows, c.map, c.headerRow, { clientId: 'c', startDate: l.start ?? start, today: '2026-11-16' }).plan };
};

describe('szablon planu — plan → arkusz → plan', () => {
  const strength = db.plans.filter((p) => p.weeks.some((w) => w.workouts.some((k) => k.exercises.some((e) => e.name.trim() && !e.cardio))));
  it.each(strength.map((p) => [p.name, p] as const))('%s: bez różnic po wczytaniu', async (_n, plan) => {
    const { l, plan: out } = await back(templateWorkbook(plan, { name: 'Jan' }));
    expect(l.info).toMatch(/Szablon Fitowej/);
    expect(l.name).toBe(plan.name);
    const { diff } = mergePlan(plan, out);
    expect(diff.lines).toEqual([]);
  });
});

describe('szablon — pisany ręcznie', () => {
  const head = ['Ozn.', 'Ćwiczenie', 'Typ', 'Przerwa', 'Uwagi', 'Serie', 'Powt.', '% 1RM', 'Kg', 'RPE', 'Uwagi tyg.', 'Serie', 'Powt.', '% 1RM', 'Kg', 'RPE', 'Uwagi tyg.'];
  const sheet = (name: string, day: string, body: string[][]) => ({
    name,
    rows: [['Plan treningowy — ' + name], ['Plan', 'Blok 2'], ['Podopieczny', 'Dominik'], ['Start', '23.11.2026'], ['Dzień tygodnia', day], ['Trening', name], [], ['', '', '', '', '', 'Tydzień 1', '', '', '', '', '', 'Tydzień 2 (deload)'], head, ...body],
  });
  const r = readTemplate([
    sheet('Pon – rwanie', 'pon', [
      ['A', 'Snatch', 'Top set', '2:30', 'Stop: 2 spalone', '1', '1', '88', '50', '8', '', '1', '1', '80', '45', '7'],
      ['', '', 'Back-off', '', '', '3', '2', '80', '', '7', '', '2', '2', '75', '', '6', 'lżej'],
      ['B1', 'Good morning', '', '0.0625', '', '3', '8', '', '40–50', '7', '', '2', '8', '', '40', '6'],
      ['B2', 'Wiosłowanie hantlem', '', '1:30', '', '3', '8/str.', '', '22/rękę', '7.5', '', '', '', '', '', ''],
      [],
    ]),
    sheet('Czw – podrzut', 'czw', [['C', 'Clean & Jerk', '', '2:30', '', '3', '1+1', '0.88', '75', '8', 'W REP 2', '3', '1+1', '', '', '7']]),
    { name: 'Instrukcja', rows: [['Jak wypełniać'], ['…']] },
  ])!;
  const c = detectColumns(r.rows);
  const plan = sheetToPlan(r.rows, c.map, c.headerRow, { clientId: 'c', startDate: r.start!, today: '2026-11-16' }).plan;
  it('pola nagłówka: nazwa planu i start', () => {
    expect(r.name).toBe('Blok 2');
    expect(r.start).toBe('2026-11-23');
  });
  it('tygodnie i dni, deload w nazwie, zakładka bez tabeli pominięta', () => {
    expect(plan.weeks.map((w) => w.name)).toEqual(['Tydzień 1', 'Tydzień 2 (deload)']);
    expect(plan.weeks[0].workouts.map((k) => [k.name, k.day])).toEqual([['Pon – rwanie', 1], ['Czw – podrzut', 4]]);
  });
  it('wiersz bez nazwy = kolejna grupa serii (top set + back-off), % 1RM i kg', () => {
    const sn = plan.weeks[0].workouts[0].exercises[0];
    expect(sn.groups.map((g) => [g.type, g.reps, g.load, g.rpe])).toEqual([
      ['Top set', '1', '50', '8'],
      ['Back-off', '2', '80%', '7'],
      ['Back-off', '2', '80%', '7'],
      ['Back-off', '2', '80%', '7'],
    ]);
    expect(sn.notes).toBe('88% 1RM. Stop: 2 spalone');
    expect(sn.rest).toBe('2:30');
    expect(plan.weeks[1].workouts[0].exercises[0].notes).toBe('80% 1RM. Stop: 2 spalone · lżej');
  });
  it('superseria B1/B2, na stronę, kg na rękę, zakres; ćwiczenie nieobecne w tygodniu 2', () => {
    const [, gm, row] = plan.weeks[0].workouts[0].exercises;
    expect(gm.groups[0].load).toBe('40–50');
    expect(gm.rest).toBe('1:30');
    expect(row.linked).toBe(true);
    expect(row.perSide).toBe(true);
    expect(row.loadPer).toBe('one');
    expect(plan.weeks[1].workouts[0].exercises.map((e) => e.name)).toEqual(['Snatch', 'Good morning']);
  });
  it('kompleks 1+1, procent z Excela (0,88), puste kg i % w tygodniu 2', () => {
    const cj = plan.weeks[0].workouts[1].exercises[0];
    expect(cj.groups[0]).toMatchObject({ reps: '1+1', load: '75' });
    expect(cj.notes).toBe('88% 1RM. W REP 2');
    expect(plan.weeks[1].workouts[1].exercises[0].groups[0].load).toBe('');
  });
});

describe('pusty szablon', () => {
  it('3 dni × 4 tygodnie, bez ćwiczeń — nie jest rozpoznawany jako plan', async () => {
    const wb = templateWorkbook(null);
    expect(wb.map((s) => s.name)).toEqual(['Dzień 1', 'Dzień 2', 'Dzień 3']);
    const read = await readXlsxSheets(xlsx(wb));
    expect(readTemplate(read)).toBeNull();
  });
});

describe('arkusz Fitowa z wykonaniem (prowadzony automatycznie)', () => {
  const strength = db.plans.filter((p) => p.weeks.some((w) => w.workouts.some((k) => k.exercises.some((e) => e.name.trim() && !e.cardio))));
  it.each(strength.map((p) => [p.name, p] as const))('%s: kolumna „Wykonano” nie psuje wczytania planu', async (_n, plan) => {
    const sessions = db.sessions.filter((s) => s.planId === plan.id);
    const wb = fitowaWorkbook([plan], { name: 'Jan' }, sessions);
    const { plan: out } = await back(wb);
    expect(mergePlan(plan, out).diff.lines).toEqual([]);
  });
  it('wykonanie: serie robocze bez rozgrzewki, kg×powt. @RPE', () => {
    expect(doneText({ name: 'Przysiad', setsLog: [{ load: 40, reps: 6, warmup: true }, { load: 50, reps: 6, rpe: 7 }, { load: 52.5, reps: 6, rpe: 8.5 }, { reps: 25, unit: 's' }] })).toBe('50×6 @7 · 52,5×6 @8,5 · 25 s');
  });
  it('zapisany trening trafia do kolumny „Wykonano” swojego tygodnia', () => {
    const plan = strength[0];
    const k = plan.weeks[0].workouts[0];
    const e0 = k.exercises.find((e) => e.name.trim())!;
    const s = { id: 's1', clientId: plan.clientId, date: '2026-11-09', charge: 'brak', planId: plan.id, workoutId: k.id, exercises: [{ name: e0.name, setsLog: [{ load: 50, reps: 6, rpe: 7 }] }] } as TrainingSession;
    const wb = fitowaWorkbook([plan], { name: 'Jan' }, [s]);
    const flat = wb.flatMap((sh) => sh.rows.flat()).map((x) => (x && typeof x === 'object' && 'v' in x ? String(x.v ?? '') : ''));
    expect(flat.some((v) => v.includes('×') && v.includes('@'))).toBe(true);
    expect(flat.some((v) => v.includes('✓'))).toBe(true);
  });
  it('plan biegowy: osobna zakładka „Bieganie”', () => {
    const run = db.plans.find((p) => isRunPlan(p));
    if (!run) return;
    const wb = fitowaWorkbook([run], { name: 'Jan' }, db.sessions);
    expect(wb.map((x) => x.name)).toEqual(['Bieganie']);
  });
});
