import { describe, expect, it } from 'vitest';
import type { Plan } from '../domain';
import { detectColumns, headerField, parseDay, parseInline, parseTable, planToCsv, sheetToPlan } from './sheetImport';

const OPTS = { clientId: 'c', startDate: '2026-11-02', today: '2026-10-26' };
const imp = (text: string) => {
  const rows = parseTable(text);
  const g = detectColumns(rows);
  return sheetToPlan(rows, g.map, g.headerRow, OPTS);
};
const ex = (p: Plan, w = 0, k = 0, e = 0) => p.weeks[w].workouts[k].exercises[e];

describe('parseTable', () => {
  it('wklejony zakres (TAB) i CSV ze średnikiem i cudzysłowami', () => {
    expect(parseTable('a\tb\n1\t2\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseTable('﻿a;b\r\n"x;y";"a ""b"""\r\n')).toEqual([['a', 'b'], ['x;y', 'a "b"']]);
    expect(parseTable('a,b\n1,"2,5"')).toEqual([['a', 'b'], ['1', '2,5']]);
  });
});

describe('nagłówki', () => {
  it('PL i EN, z polskimi znakami i bez', () => {
    expect(headerField('Ćwiczenie')).toBe('exercise');
    expect(headerField('cwiczenie')).toBe('exercise');
    expect(headerField('Powt.')).toBe('reps');
    expect(headerField('Ciężar (kg)')).toBe('load');
    expect(headerField('Exercise')).toBe('exercise');
    expect(headerField('Sets')).toBe('sets');
    expect(headerField('Tydzień')).toBe('week');
    expect(headerField('Odpoczynek')).toBe('rest');
    expect(headerField('Coś innego')).toBeNull();
  });
  it('dowolna kolejność kolumn, nagłówek nie w pierwszym wierszu', () => {
    const rows = parseTable('Plan Michała\n\nRPE\tĆwiczenie\tSerie\tPowt.\tWeek\n8\tPrzysiad\t3\t5\t1');
    const g = detectColumns(rows);
    expect(g.headerRow).toBe(2);
    expect(g.map).toEqual(['rpe', 'exercise', 'sets', 'reps', 'week']);
  });
});

describe('parseInline', () => {
  it('„Przysiad 4x6 @RPE8 100kg”', () => {
    expect(parseInline('Przysiad 4x6 @RPE8 100kg')).toEqual({ name: 'Przysiad', sets: '4', reps: '6', rpe: '8', load: '100' });
  });
  it('zakres powtórzeń, ciężar ze spacją, RPE po @, przecinek dziesiętny', () => {
    expect(parseInline('Wyciskanie leżąc 3×8-10 @7,5 82,5 kg')).toEqual({ name: 'Wyciskanie leżąc', sets: '3', reps: '8–10', rpe: '7.5', load: '82.5' });
    expect(parseInline('Martwy ciąg rumuński 5x5 120')).toMatchObject({ name: 'Martwy ciąg rumuński', sets: '5', reps: '5', load: '120' });
    expect(parseInline('Wykroki 3x10/str. RPE 7')).toMatchObject({ name: 'Wykroki', reps: '10/str.', rpe: '7' });
    expect(parseInline('Deska 3x45s')).toMatchObject({ name: 'Deska', sets: '3', reps: '45 s' });
    expect(parseInline('Przysiad 75%')).toMatchObject({ name: 'Przysiad', load: '75%' });
  });
});

describe('parseDay', () => {
  it('nazwy dni, numery, daty', () => {
    expect(parseDay('Poniedziałek')).toEqual({ day: 1 });
    expect(parseDay('śr.')).toEqual({ day: 3 });
    expect(parseDay('Fri')).toEqual({ day: 5 });
    expect(parseDay('niedz.')).toEqual({ day: 7 });
    expect(parseDay('09.11.2026')).toEqual({ date: '2026-11-09' });
    expect(parseDay('2026-11-10')).toEqual({ date: '2026-11-10' });
    expect(parseDay('46335')).toEqual({ date: '2026-11-09' });
  });
});

describe('sheetToPlan', () => {
  it('kolumny z nagłówkiem — tygodnie, dni, treningi, serie rozpisane osobno', () => {
    const { plan, stats } = imp(['Tydzień\tDzień\tTrening\tĆwiczenie\tSerie\tPowt.\tCiężar\tRPE\tPrzerwa\tUwagi', '1\tpon\tA\tPrzysiad\t3\t5\t100 kg\t8\t3:00\tTempo 3-1-X-0', '1\tpon\tA\tWiosłowanie\t3\t8\t60\t7\t2:00\t', '1\tczw\tB\tMartwy ciąg\t3\t5\t120\t8\t3:00\t', '2\tpon\tA\tPrzysiad\t3\t5\t102,5\t8\t3:00\t'].join('\n'));
    expect(stats).toMatchObject({ weeks: 2, workouts: 3, exercises: 4 });
    expect(plan.weeks.map((w) => w.name)).toEqual(['Tydzień 1', 'Tydzień 2']);
    expect(plan.weeks[0].workouts.map((k) => [k.name, k.day])).toEqual([['Trening A', 1], ['Trening B', 4]]);
    const sq = ex(plan);
    expect(sq.groups).toHaveLength(3);
    expect(sq.groups[0]).toMatchObject({ type: 'Robocze', sets: '1', reps: '5', load: '100', rpe: '8' });
    expect(sq).toMatchObject({ rest: '3:00', notes: 'Tempo 3-1-X-0' });
    expect(ex(plan, 1).groups[0].load).toBe('102.5');
  });

  it('scalone komórki tygodni i treningów (puste pod spodem) oraz puste wiersze', () => {
    const { plan } = imp(['Tydzień\tTrening\tĆwiczenie\tSerie\tPowt.', 'Tydzień 1\tA\tPrzysiad\t3\t5', '\t\tWyciskanie\t3\t8', '', '\t\t\t\t', '\tB\tMartwy ciąg\t2\t5', 'Tydzień 2\tA\tPrzysiad\t3\t4', '\tB\tMartwy ciąg\t2\t4'].join('\n'));
    expect(plan.weeks).toHaveLength(2);
    expect(plan.weeks[0].workouts.map((k) => k.exercises.map((e) => e.name))).toEqual([['Przysiad', 'Wyciskanie'], ['Martwy ciąg']]);
    expect(plan.weeks[1].workouts.map((k) => k.name)).toEqual(['Trening A', 'Trening B']);
    // brak kolumny dnia — domyślnie pon. i czw.
    expect(plan.weeks[0].workouts.map((k) => k.day)).toEqual([1, 4]);
  });

  it('jedna kolumna w zapisie „Przysiad 4x6 @RPE8 100kg” z wierszami-sekcjami', () => {
    const { plan } = imp(['Tydzień 1', 'Trening A', 'Przysiad 4x6 @RPE8 100kg', 'Wyciskanie 3x8 @7 70kg', 'Trening B', 'Martwy ciąg 3x5 @8 130kg', 'Tydzień 2', 'Trening A', 'Przysiad 4x6 @RPE8 102,5kg'].join('\n'));
    expect(plan.weeks.map((w) => w.workouts.map((k) => k.name))).toEqual([['Trening A', 'Trening B'], ['Trening A']]);
    expect(ex(plan).groups).toHaveLength(4);
    expect(ex(plan).groups[0]).toMatchObject({ reps: '6', load: '100', rpe: '8' });
    expect(ex(plan, 1).groups[0].load).toBe('102.5');
  });

  it('wiersz bez nazwy ćwiczenia = kolejna seria poprzedniego (rozpisane serie)', () => {
    const { plan } = imp(['Ćwiczenie\tPowt.\tCiężar\tTyp', 'Przysiad\t5\t60\trozgrzewka', '\t5\t100\ttop', '\t5\t90\tback-off', '\t5\t90\tback-off'].join('\n'));
    expect(ex(plan).groups.map((g) => [g.type, g.load])).toEqual([['Rozgrzewka', '60'], ['Top set', '100'], ['Back-off', '90'], ['Back-off', '90']]);
  });

  it('nagłówki angielskie, kolumna „4x6” w seriach, daty w kolumnie dnia → start planu', () => {
    const { plan } = imp(['Week,Date,Exercise,Sets,Load', '1,09.11.2026,Back squat,4x6,100', '1,12.11.2026,Bench press,3x8,80'].join('\n'));
    expect(plan.startDate).toBe('2026-11-09');
    expect(plan.weeks[0].workouts.map((k) => k.date)).toEqual(['2026-11-09', '2026-11-12']);
    expect(ex(plan).groups).toHaveLength(4);
    expect(ex(plan).groups[0].reps).toBe('6');
  });

  it('superserie A1/A2 → połączone ćwiczenia; nierozpoznany ciężar do uwag', () => {
    const { plan, warnings } = imp(['Ćwiczenie\tSerie\tPowt.\tCiężar', 'A1 Podciąganie\t3\t6\tmasa ciała', 'A2 Pompki\t3\t12\t', 'B Przysiad\t3\t5\t100'].join('\n'));
    const k = plan.weeks[0].workouts[0];
    expect(k.exercises.map((e) => [e.name, !!e.linked])).toEqual([['Podciąganie', false], ['Pompki', true], ['Przysiad', false]]);
    expect(k.exercises[0].notes).toBe('ciężar: masa ciała');
    expect(k.exercises[0].groups[0].load).toBe('');
    expect(warnings.some((w) => /nierozpoznany/.test(w))).toBe(true);
  });

  it('dzień jako tekst bez kolumny treningu — trening na każdy dzień', () => {
    const { plan } = imp(['Dzień;Ćwiczenie;Serie;Powt.', 'Poniedziałek;Przysiad;3;5', ';Wiosłowanie;3;8', 'Środa;Martwy ciąg;3;5', 'Piątek;Wyciskanie;3;5'].join('\n'));
    expect(plan.weeks[0].workouts.map((k) => [k.name, k.day, k.exercises.length])).toEqual([['Trening A', 1, 2], ['Trening B', 3, 1], ['Trening C', 5, 1]]);
  });
});

describe('planToCsv', () => {
  it('BOM, średnik, przecinek dziesiętny — i wczytuje się z powrotem', () => {
    const p: Plan = {
      id: 'p',
      clientId: 'c',
      name: 'Siła',
      startDate: '2026-11-02',
      active: true,
      weeks: [
        {
          id: 'w1',
          name: 'Tydzień 1',
          workouts: [
            {
              id: 'k1',
              name: 'Trening A',
              day: 1,
              exercises: [
                { id: 'e1', name: 'Przysiad', rest: '3:00', notes: 'tempo; wolno', groups: [{ type: 'Rozgrzewka', sets: '1', reps: '5', load: '60', rpe: '' }, ...[1, 2, 3].map(() => ({ type: 'Robocze' as const, sets: '1', reps: '5', load: '102.5', rpe: '7.5' }))] },
                { id: 'e2', name: 'Podciąganie', groups: [{ type: 'Robocze', sets: '1', reps: '6', load: '', rpe: '8' }] },
                { id: 'e3', name: 'Pompki', linked: true, groups: [{ type: 'Robocze', sets: '1', reps: '12', load: '', rpe: '' }] },
              ],
            },
          ],
        },
      ],
    };
    const csv = planToCsv(p);
    expect(csv.startsWith('﻿Tydzień;Dzień;Trening;Ćwiczenie;Serie;Powt.;Ciężar;RPE;Przerwa;Uwagi;Typ serii\r\n')).toBe(true);
    expect(csv).toContain('Tydzień 1;pon.;Trening A;Przysiad;3;5;102,5;7,5;3:00;;');
    expect(csv).toContain('"tempo; wolno"');
    const back = imp(csv).plan;
    const k = back.weeks[0].workouts[0];
    expect(k.day).toBe(1);
    expect(k.exercises.map((e) => [e.name, !!e.linked])).toEqual([['Przysiad', false], ['Podciąganie', false], ['Pompki', true]]);
    expect(k.exercises[0].groups.map((g) => `${g.type}:${g.reps}x${g.load}@${g.rpe}`)).toEqual(['Rozgrzewka:5x60@', 'Robocze:5x102.5@7.5', 'Robocze:5x102.5@7.5', 'Robocze:5x102.5@7.5']);
    expect(k.exercises[0].notes).toBe('tempo; wolno');
  });
});
