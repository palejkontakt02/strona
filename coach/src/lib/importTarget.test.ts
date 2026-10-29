import { describe, expect, it } from 'vitest';
import { fillCardioRows, importTarget, importTargetText, mapLaps, type DraftSeg } from './importTarget';

const seg = (reps: string, dist: string, extra: Partial<DraftSeg> = {}): DraftSeg => ({ reps, dist, ...extra });
const imported = { name: 'Bieg', cardio: true, series: [seg('5:00', '1', { hr: '150' }), seg('4:50', '1', { hr: '160' })] };

describe('import z zegarka do formularza treningu', () => {
  it('odcinki z planu (wartości planu) są zastępowane, nie dopisuje się drugi „Bieg”', () => {
    const plan = { name: 'Interwały', cardio: true, series: [seg('15', '3', { planned: true, warmup: true }), seg('4', '0,8', { planned: true }), seg('4', '0,8', { planned: true }), seg('10', '2', { planned: true, label: 'Schłodzenie' })] };
    const out = fillCardioRows([plan], imported);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Interwały');
    expect(out[0].series).toEqual(imported.series);
    expect(importTargetText([plan], 'Bieg', 2)).toMatch(/Zastąpi odcinki z planu: „Interwały” \(4 odcinki, 6,6 km\)/);
  });
  it('ta sama liczba okrążeń co odcinków planu — wypełnia kolejno, zostają etykiety i cele', () => {
    const plan = { name: 'Bieg', cardio: true, series: [seg('15', '3', { planned: true, warmup: true }), seg('4', '0,8', { planned: true, tPace: 'Z5' })] };
    const out = fillCardioRows([plan], imported);
    expect(out[0].series![0]).toMatchObject({ reps: '5:00', hr: '150', warmup: true });
    expect(out[0].series![1]).toMatchObject({ reps: '4:50', tPace: 'Z5' });
    expect(importTarget([plan], 'Bieg', 2).oneToOne).toBe(true);
  });
  it('kilka ćwiczeń cardio z planu — pierwsze dostaje odcinki, pozostałe znikają; siłowe zostają', () => {
    const rows = [
      { name: 'Rozbieganie', cardio: true, series: [seg('15', '3', { planned: true })] },
      { name: 'Przysiad', series: [{ reps: '5' }] },
      { name: 'Schłodzenie', cardio: true, series: [seg('10', '2', { planned: true })] },
    ];
    const out = fillCardioRows(rows, imported);
    expect(out.map((r) => r.name)).toEqual(['Rozbieganie', 'Przysiad']);
  });
  it('wpisane wykonanie (bez flagi planu) zostaje — import dopisuje nowe ćwiczenie', () => {
    const done = { name: 'Bieg', cardio: true, series: [seg('30', '6')] };
    expect(fillCardioRows([done], imported).map((r) => r.name)).toEqual(['Bieg', 'Bieg']);
    expect(importTargetText([done], 'Bieg', 2)).toBe('Doda ćwiczenie „Bieg” (2 odcinki).');
  });
  it('pusty wiersz cardio jest wypełniany; rower z rozgrzewki nie jest zastępowany biegiem', () => {
    expect(fillCardioRows([{ name: 'Bieg', cardio: true, series: [seg('', '')] }], imported)).toHaveLength(1);
    const bike = { name: 'Rower stacjonarny', cardio: true, series: [seg('10', '', { planned: true })] };
    expect(fillCardioRows([bike], imported).map((r) => r.name)).toEqual(['Rower stacjonarny', 'Bieg']);
  });
  it('interwały: rozgrzewka, 6 × odcinek z truchtem, schłodzenie — okrążenia dostają etykiety planu', () => {
    const plan = [seg('15', '', { planned: true, warmup: true, tPace: 'Z2' }), ...Array.from({ length: 6 }, () => seg('', '0,8', { planned: true, tPace: 'Z5' })), seg('10', '', { planned: true, label: 'Schłodzenie' })];
    const laps = Array.from({ length: 13 }, (_, i) => seg(String(i), '1'));
    const m = mapLaps(plan, laps)!;
    expect(m.segs.map((x) => (x.warmup ? 'R' : x.label === 'Przerwa' ? 'P' : x.label === 'Schłodzenie' ? 'S' : x.tPace))).toEqual(['R', 'Z5', 'P', 'Z5', 'P', 'Z5', 'P', 'Z5', 'P', 'Z5', 'P', 'Z5', 'S']);
    expect(m.text).toBe('rozgrzewka, 6 odcinków z przerwami (trucht), schłodzenie');
    expect(importTargetText([{ name: 'Interwały', cardio: true, series: plan }], 'Bieg', 13)).toMatch(/kolejnymi okrążeniami \(13 odcinków\): rozgrzewka, 6 odcinków z przerwami/);
    expect(mapLaps(plan, laps.slice(0, 10))).toBeNull();
  });
});
