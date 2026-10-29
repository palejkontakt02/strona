import { describe, expect, it } from 'vitest';
import type { Plan } from '../domain';
import { RUN_TEMPLATES } from './running';
import { detectColumns, headerField, normRest, parseTable, planToCsv, sheetToPlan, splitSide } from './sheetImport';

const imp = (text: string) => {
  const rows = parseTable(text);
  const c = detectColumns(rows);
  return sheetToPlan(rows, c.map, c.headerRow, { clientId: 'c', startDate: '2026-11-02', today: '2026-10-29' });
};

describe('nagłówki ciężaru', () => {
  it.each(['Obciążenie (kg)', 'Ciężar [kg]', 'Load (kg)', 'Weight lbs', 'Ciężar', 'kg'])('%s → load', (h) => expect(headerField(h)).toBe('load'));
  it('dystans i cel', () => {
    expect(headerField('Dystans')).toBe('dist');
    expect(headerField('Cel')).toBe('target');
    expect(headerField('Strefa')).toBe('target');
    expect(headerField('Tempo')).toBe('notes');
  });
});

describe('na stronę i przerwy', () => {
  it('splitSide', () => {
    expect(splitSide('8/str.')).toEqual(['8', true]);
    expect(splitSide('20 s/str.')).toEqual(['20 s', true]);
    expect(splitSide('10 na stronę')).toEqual(['10', true]);
    expect(splitSide('8–10')).toEqual(['8–10', false]);
  });
  it('import „8/str.” → perSide, bez dopisku w powtórzeniach', () => {
    const p = imp('Ćwiczenie;Serie;Powt.;Ciężar\nWykroki;3;8/str.;12\nDeska bokiem;2;20 s/str.;').plan;
    const [a, b] = p.weeks[0].workouts[0].exercises;
    expect([a.perSide, a.groups[0].reps, a.groups.length]).toEqual([true, '8', 3]);
    expect([b.perSide, b.groups[0].reps]).toEqual([true, '20 s']);
  });
  it('normRest', () => {
    expect(normRest("2'")).toBe('2:00');
    expect(normRest('90s')).toBe('1:30');
    expect(normRest('90 s')).toBe('1:30');
    expect(normRest("1'30''")).toBe('1:30');
    expect(normRest('2 min trucht')).toBe('2:00 trucht');
    expect(normRest('3:00')).toBe('3:00');
    expect(normRest('zbieg truchtem')).toBe('zbieg truchtem');
  });
  it('import przerwy w m:ss', () => {
    const p = imp("Ćwiczenie;Serie;Powt.;Przerwa\nPrzysiad;3;5;2'\nWiosłowanie;3;10;90s").plan;
    expect(p.weeks[0].workouts[0].exercises.map((e) => e.rest)).toEqual(['2:00', '1:30']);
  });
});

const tpl = (id: string) => RUN_TEMPLATES.find((t) => t.id === id)!.make();

describe('CSV round-trip', () => {
  const runPlan: Plan = {
    id: 'p', clientId: 'c', name: 'Bieg', startDate: '2026-11-02', active: true,
    weeks: [{ id: 'w1', name: 'Tydzień 1', workouts: [
      { id: 'k1', name: 'Interwały', day: 2, exercises: [tpl('int')] },
      { id: 'k2', name: 'Długi', day: 6, exercises: [{ ...tpl('long'), groups: [{ type: 'Robocze', sets: '1', reps: '78:45', load: '16', rpe: '4', pace: 'Z2' }] }] },
      { id: 'k3', name: 'Rozbieganie', day: 4, exercises: [{ ...tpl('easy'), groups: [{ type: 'Robocze', sets: '1', reps: '40', load: '8,5', rpe: '3', pace: '5:45/km' }] }] },
    ] }],
  };
  it('plan biegowy: cel i dystans w osobnych kolumnach, czas h:mm:ss, interwały wracają', () => {
    const csv = planToCsv(runPlan);
    expect(csv.split('\r\n')[0]).toBe('﻿Tydzień;Dzień;Trening;Ćwiczenie;Serie;Powt.;Ciężar;RPE;Przerwa;Uwagi;Typ serii;Dystans;Cel');
    expect(csv).toContain('Tydzień 1;wt.;Interwały;Interwały 6 × 800 m;6;;;8;2:00 trucht;;;800 m;Z5');
    expect(csv).toContain('Tydzień 1;wt.;Interwały;Interwały 6 × 800 m;1;15;;;;;Rozgrzewka;;Z2');
    expect(csv).toContain(';1:18:45;;4;;Równe tempo, picie co 20–30 min.;;16 km;Z2');
    expect(csv).toContain(';8,5 km;5:45/km');
    const back = imp(csv).plan;
    const ks = back.weeks[0].workouts;
    const iv = ks[0].exercises[0];
    expect(iv.name).toBe('Interwały 6 × 800 m');
    expect(iv.cardio).toBe(true);
    expect(iv.groups.map((g) => [g.type, g.sets, g.reps, g.load, g.pace, g.rest ?? '', g.rpe])).toEqual([
      ['Rozgrzewka', '1', '15', '', 'Z2', '', ''],
      ['Robocze', '6', '', '800 m', 'Z5', '2:00 trucht', '8'],
      ['Schłodzenie', '1', '10', '', 'Z1', '', ''],
    ]);
    expect(ks[1].exercises[0].groups[0]).toMatchObject({ reps: '78:45', load: '16', pace: 'Z2' });
    expect(ks[2].exercises[0].groups[0]).toMatchObject({ reps: '40', load: '8.5', pace: '5:45/km' });
    expect(ks.map((k) => k.day)).toEqual([2, 6, 4]);
    // drugi obieg — ten sam CSV
    expect(planToCsv({ ...back, name: 'Bieg' }).replace(/8\.5/g, '8,5')).toBe(csv);
  });
  it('plan siłowy: bez kolumn biegu, na stronę i typy serii wracają', () => {
    const p: Plan = { id: 'p', clientId: 'c', name: 'Siła', startDate: '2026-11-02', active: true, weeks: [{ id: 'w', name: 'Tydzień 1', workouts: [{ id: 'k', name: 'Trening A', day: 1, exercises: [
      { id: 'a', name: 'Przysiad', rest: '3:00', groups: [{ type: 'Top set', sets: '1', reps: '3', load: '140', rpe: '8.5' }, { type: 'Back-off', sets: '2', reps: '5', load: '-10%', rpe: '7' }] },
      { id: 'b', name: 'Wykroki', perSide: true, rest: '1:30', groups: [{ type: 'Robocze', sets: '3', reps: '8', load: '12', rpe: '' }] },
    ] }] }] };
    const csv = planToCsv(p);
    expect(csv.split('\r\n')[0]).toBe('﻿Tydzień;Dzień;Trening;Ćwiczenie;Serie;Powt.;Ciężar;RPE;Przerwa;Uwagi;Typ serii');
    expect(csv).toContain('Wykroki;3;8/str.;12;;1:30');
    const k = imp(csv).plan.weeks[0].workouts[0];
    expect(k.exercises[0].groups.map((g) => [g.type, g.reps, g.load, g.rpe])).toEqual([['Top set', '3', '140', '8.5'], ['Back-off', '5', '-10%', '7'], ['Back-off', '5', '-10%', '7']]);
    expect(k.exercises[1]).toMatchObject({ perSide: true, rest: '1:30' });
    expect(k.exercises[1].groups.map((g) => g.reps)).toEqual(['8', '8', '8']);
  });
});
