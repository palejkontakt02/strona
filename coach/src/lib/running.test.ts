import { describe, expect, it } from 'vitest';
import { fmtClock, fmtDur, fmtKm, paceText, parseDur, parseKm, RUN_TEMPLATES, runTotals, targetText, zoneOf } from './running';
import { buildRunExercise, cardioByName, runToExercises, sessionToRun } from './run';

describe('bieganie', () => {
  it('czas: minuty, m:ss, h:mm:ss, sekundy', () => {
    expect(parseDur('45')).toBe(45);
    expect(parseDur('3:05')).toBeCloseTo(3.0833, 3);
    expect(parseDur('1:20:00')).toBe(80);
    expect(parseDur('90 s')).toBe(1.5);
    expect(parseDur('10 min')).toBe(10);
    expect(parseDur('abc')).toBeNull();
    expect(fmtClock(3.0833)).toBe('3:05');
    expect(fmtClock(80)).toBe('1:20:00');
    expect(fmtDur(40)).toBe('40 min');
    expect(fmtDur(0.5)).toBe('0:30');
  });
  it('dystans i tempo', () => {
    expect(parseKm('800 m')).toBe(0.8);
    expect(parseKm('5,5')).toBe(5.5);
    expect(fmtKm(0.8)).toBe('800 m');
    expect(fmtKm(10.25)).toBe('10,25 km');
    expect(paceText(27, 5)).toBe('5:24/km');
    expect(paceText(3.0833, 0.8)).toBe('3:51/km');
    expect(paceText(10, 0)).toBe('');
  });
  it('strefy: Z, OWB, BC; zakres tętna i tempa z profilu', () => {
    expect(zoneOf('Z2')?.z).toBe('Z2');
    expect(zoneOf('OWB1')?.z).toBe('Z2');
    expect(zoneOf('bc3')?.z).toBe('Z4');
    expect(zoneOf('5:30')).toBeNull();
    expect(targetText('Z2', { hrMax: 190 })).toBe('Z2 rozbieganie (OWB1) · 114–133 ud./min');
    expect(targetText('Z4', { t5k: '25:00' })).toBe('Z4 próg (BC3) · ~5:09–5:30/km');
    expect(targetText('5:30')).toBe('5:30/km');
  });
  it('nazwy biegowe → cardio', () => {
    for (const n of ['Rozbieganie', 'Interwały 6 × 800 m', 'Długi bieg', 'Fartlek', 'BNP', 'OWB1 40 min', 'Przebieżki']) expect(cardioByName(n)).toBe(true);
    expect(cardioByName('Przysiad')).toBe(false);
  });
  it('szablon interwałów → odcinki z celem, zapis z tempem, poprawki z m:ss', () => {
    const tpl = RUN_TEMPLATES.find((t) => t.id === 'int')!.make();
    const ex = buildRunExercise(tpl, []);
    expect(ex.cardio).toBe(true);
    expect(ex.sets).toHaveLength(8);
    expect(ex.sets[0]).toMatchObject({ warmup: true, reps: '15', pace: 'Z2' });
    expect(ex.sets[1]).toMatchObject({ warmup: false, dist: '0,8', pace: 'Z5' });
    expect(ex.sets[7]).toMatchObject({ label: 'Schłodzenie', reps: '10', pace: 'Z1' });
    expect(ex.sets[1].gdesc).toBe('6 × 800 m · Z5');
    const done = { ...ex, sets: ex.sets.map((x, i) => ({ ...x, done: true, reps: i > 0 && i < 7 ? '3:05' : x.reps })) };
    const [out] = runToExercises({ planId: '', workoutId: '', name: 'x', planName: '', weekName: '', date: '2026-10-18', startedAt: 0, idx: 0, ex: [done] } as never);
    expect(out.setsLog[1]).toMatchObject({ reps: 3.08, dist: 0.8, unit: 'min' });
    expect(out.setsLog[0].warmup).toBe(true);
    expect(out.setsLog[7].label).toBe('Schłodzenie');
    const s = { id: 's', clientId: 'c', date: '2026-10-18', charge: 'brak' as const, exercises: [out] };
    const t = runTotals(s)!;
    expect(t.km).toBeCloseTo(4.8, 5);
    expect(t.pace).toBe('3:51/km');
    expect(sessionToRun(s).ex[0].sets[1].reps).toBe('3:05');
  });
});
