import { describe, expect, it } from 'vitest';
import { setCells } from './planGrid';
import { cleanLoad, detectColumns, sheetToPlan } from './sheetImport';
import { normalizeLayout } from './sheetLayouts';
import { resolveLoad } from './strength';

const toPlan = (rows: string[][]) => {
  const c = detectColumns(rows);
  return sheetToPlan(rows, c.map, c.headerRow, { clientId: 'c', startDate: '2026-11-16', today: '2026-11-16' }).plan;
};
const ex = (p: ReturnType<typeof toPlan>, w: number, name: string) => p.weeks[w].workouts[0].exercises.find((e) => e.name === name)!;

describe('zakres ciężaru', () => {
  it('import: „6–8 kg”, „6-8”, „8–10 kg/rękę”, „15→17,5”, „masa ciała”', () => {
    expect(cleanLoad('6–8 kg')).toBe('6–8');
    expect(cleanLoad('6-8')).toBe('6–8');
    expect(cleanLoad('8–10 kg/rękę')).toBe('8–10');
    expect(cleanLoad('15→17,5 kg')).toBe('15–17.5');
    expect(cleanLoad('masa ciała')).toBe('');
    expect(cleanLoad('100 kg')).toBe('100');
    expect(cleanLoad('75%')).toBe('75%');
    expect(cleanLoad('ciężko')).toBeNull();
  });
  it('odtwarzacz zaczyna od dolnej wartości, zakres w podpowiedzi', () => {
    expect(resolveLoad('6–8', null, '8', '7', null)).toEqual({ load: 6, why: 'zakres 6–8 kg' });
    expect(resolveLoad('17.5–20', null, '8', '7', null).load).toBe(17.5);
  });
});

describe('układ „bloki” (TYDZIEŃ · DZIEŃ w jednym arkuszu)', () => {
  const head = ['Ćwiczenie', 'Serie', 'Powt.', '% 1RM', 'RPE cel', 'kg orient.', 'Przerwa', 'Seria 1', '', '', 'Notatki'];
  const sub = ['', '', '', '', '', '', '', 'KG', 'REP', 'RPE', ''];
  const sheets = [
    { name: 'Parametry', rows: [['Klucz', '1RM']] },
    { name: 'Treningi', rows: [['Tydzień', 'Dzień', 'Data', 'Trening'], ['1', '1', '', 'Rwanie'], ['1', '2', '', 'Zarzut i podrzut'], ['2', '1', '', 'Rwanie (deload)'], ['2', '2', '', 'Zarzut i podrzut (deload)']] },
    {
      name: 'Serie',
      rows: [
        ['TYDZIEŃ 1 · DZIEŃ 1 · RWANIE  (budowa)', '', '', '', '', '', '', 'REALIZACJA'],
        head,
        sub,
        ['Snatch — singiel ciężki', '3', '1', '0.88', '8', '50', '2:30', '', '', '', 'Wszystkie single na tym samym ciężarze.'],
        ['Back Squat', '4', '4', '0.82', '7.5', '140', '3:00', '', '', '', ''],
        [],
        ['TYDZIEŃ 1 · DZIEŃ 2 · ZARZUT I PODRZUT  (budowa)'],
        head,
        sub,
        ['Clean & Jerk (1+1)', '3', '1+1', '88%', '8', '75,0', '2:30', '', '', '', 'Na tym samym ciężarze. W REP wpisz 2. Stop: 2 spalone.'],
        ['E1  Good morning (sztanga)', '3', '8', '', '7', '', '—', '', '', '', 'Lekko.'],
        ['E2  Wiosłowanie hantlem jednorącz', '3', '8', '', '7.5', '', '2:00', '', '', '', '8/str.'],
        ['TYDZIEŃ 2 · DZIEŃ 1 · RWANIE  (deload)'],
        head,
        ['Snatch — singiel ciężki', '3', '1', '0.8', '7', '47.5', '2:30'],
        ['TYDZIEŃ 2 · DZIEŃ 2 · TEST: RWANIE + PODRZUT (jak zawody)  (TEST)'],
        head,
        ['Snatch — TEST 1RM', '1', '1', '100%', 'max', '57,5', '2:30'],
      ],
    },
  ];
  const l = normalizeLayout(sheets)!;
  const p = toPlan(l.rows);
  it('tygodnie, jednostki z arkusza „Treningi”, deload w nazwie tygodnia', () => {
    expect(l.info).toMatch(/bloki/);
    expect(p.weeks.map((w) => w.name)).toEqual(['Tydzień 1', 'Tydzień 2 (deload)']);
    expect(p.weeks[0].workouts.map((k) => k.name)).toEqual(['Rwanie', 'Zarzut i podrzut']);
    expect(p.weeks[1].workouts.map((k) => k.name)).toEqual(['Rwanie', 'Zarzut i podrzut']);
  });
  it('kg orientacyjne jako ciężar, % 1RM w uwagach, przerwa, kompleks', () => {
    const s = ex(p, 0, 'Snatch — singiel ciężki');
    expect(s.groups.map((g) => [g.reps, g.load, g.rpe])).toEqual([['1', '50', '8'], ['1', '50', '8'], ['1', '50', '8']]);
    expect(s.notes).toBe('88% 1RM. Wszystkie single na tym samym ciężarze');
    expect(s.rest).toBe('2:30');
    const cj = p.weeks[0].workouts[1].exercises[0];
    expect(cj.groups[0]).toMatchObject({ reps: '1+1', load: '75' });
    expect(cj.notes).toBe('88% 1RM. Na tym samym ciężarze. Stop: 2 spalone');
  });
  it('superseria E1/E2, „8/str.” z uwag → na stronę; „max” → uwaga', () => {
    const [gm, row] = p.weeks[0].workouts[1].exercises.slice(1);
    expect(gm.name).toBe('Good morning (sztanga)');
    expect(row.linked).toBe(true);
    expect(row.perSide).toBe(true);
    expect(row.notes ?? '').toBe('');
    const t = p.weeks[1].workouts[1].exercises[0];
    expect(t.groups[0].rpe).toBe('');
    expect(t.notes).toMatch(/RPE: maks dnia/);
  });
});

describe('układ „tygodnie obok siebie” (arkusz = jednostka)', () => {
  const rows = [
    ['Kasia · poniedziałek: góra · plan na 3 tygodnie'],
    ['Rozgrzewka: jak zawsze'],
    [],
    ['', '', '', '', 'Tydzień 1', '', '', '', 'Tydzień 2', '', '', '', 'Tydzień 3 '],
    ['Blok', 'Ćwiczenie', 'Technika / uwagi', 'Seria', 'Zalecenie', 'Ciężar', 'Powt.', 'RPE', 'Zalecenie', 'Ciężar', 'Powt.', 'RPE', 'Zalecenie', 'Ciężar', 'Powt.', 'RPE'],
    ['1. Podciąganie', 'Negatywy', 'Opuszczanie 4–5 s', '1', '3×3 (4–5 s)\nmasa ciała\nRPE 8', '', '3', '8', '3×4 (5 s)\nmasa ciała\nRPE 8', '', '', '', '3×8, pauza 2 s na górze\nmasa ciała\nRPE 8'],
    ['', '', '', '2'],
    ['2. Nogi (superseria)', 'A1. Przysiad bułgarski z hantlami', 'Wałek przy rackach', '1', '3×6–8/nogę\n2×6 kg\nRPE 7', '6', '8', '7', '3×8/nogę\n2×6–8 kg\nRPE 7'],
    ['', 'A2. Wspięcia na palce jednonóż z hantlem', 'tempo 2-1-2; przerwa 60 s po rundzie', '1', '3×8–10/nogę\n8 kg\nRPE 7–8', '', '', '', '3×10/nogę\n10 kg\nRPE 7–8'],
    ['3. Superseria', 'B1. Wyciskanie hantli na ławce skośnej 30°', '', '1', '4×6–8\n8–10 kg/rękę\nRPE 7→8', '', '', '', '4×8\n10 kg/rękę\nRPE 7→8'],
    ['7. Core', 'Wood chopper', '', '1', '3×8/str.\npiłka 3–4 kg\nRPE 6–7', '', '', '', '3×8/str.\npiłka 4–5 kg\nRPE 6–7'],
    [],
    ['RPE', 'Skala RPE: ile powtórzeń zostało w zapasie'],
    ['10', 'Maksimum'],
  ];
  const l = normalizeLayout([{ name: 'Poniedziałek – góra', rows }])!;
  const p = toPlan(l.rows);
  it('tygodnie jeden po drugim, jednostka = nazwa arkusza, dzień z nazwy', () => {
    expect(l.info).toMatch(/tygodnie obok siebie/);
    expect(p.weeks.map((w) => w.name)).toEqual(['Tydzień 1', 'Tydzień 2', 'Tydzień 3']);
    expect(p.weeks[0].workouts[0]).toMatchObject({ name: 'Poniedziałek – góra', day: 1 });
    expect(l.warnings.join(' ')).toMatch(/Tydzień 3: wypełnione tylko 1 z 5/);
  });
  it('zalecenie „3×6–8/nogę ⏎ 2×6–8 kg ⏎ RPE 7” → serie, na stronę, zakres na hantel', () => {
    const a1 = ex(p, 1, 'Przysiad bułgarski z hantlami');
    expect(a1.groups.map((g) => [g.reps, g.load, g.rpe])).toEqual([['8', '6–8', '7'], ['8', '6–8', '7'], ['8', '6–8', '7']]);
    expect(a1.perSide).toBe(true);
    expect(a1.loadPer).toBe('one');
    const a2 = ex(p, 0, 'Wspięcia na palce jednonóż z hantlem');
    expect(a2.linked).toBe(true);
    expect(a2.rest).toBe('60');
  });
  it('„RPE 7→8” dzieli serie na pół; „piłka 3–4 kg” → zakres + uwaga; masa ciała bez ciężaru', () => {
    const b1 = ex(p, 0, 'Wyciskanie hantli na ławce skośnej 30°');
    expect(b1.groups.map((g) => [g.load, g.rpe])).toEqual([['8–10', '7'], ['8–10', '7'], ['8–10', '8'], ['8–10', '8']]);
    const ch = ex(p, 0, 'Wood chopper');
    expect(ch.groups[0].load).toBe('3–4');
    expect(ch.notes).toBe('piłka');
    const neg = ex(p, 0, 'Negatywy');
    expect(neg.groups.map((g) => [g.reps, g.load])).toEqual([['3', ''], ['3', ''], ['3', '']]);
    expect(neg.notes).toBe('Opuszczanie 4–5 s');
    expect(ex(p, 2, 'Negatywy').notes).toBe('Opuszczanie 4–5 s. Pauza 2 s na górze');
  });
  it('tabela planu pokazuje zakres „6–8 kg”', () => {
    expect(setCells(ex(p, 1, 'Przysiad bułgarski z hantlami'))[0]).toMatchObject({ load: '6–8 kg' });
  });
});

describe('zwykła tabela — bez zmian', () => {
  it('płaska tabela z nagłówkami nie jest przerabiana', () => {
    expect(normalizeLayout([{ name: 'Plan', rows: [['Tydzień', 'Dzień', 'Ćwiczenie', 'Serie'], ['1', 'pon', 'Przysiad', '3']] }])).toBeNull();
  });
});
