import { describe, expect, it } from 'vitest';
import { fmtClock, fmtDur, fmtKm, paceText, parseDur, parseKm, planRunTotals, racePace, recoverySec, RUN_TEMPLATES, runTotals, targetText, zoneOf } from './running';
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
  it('cel: tętno, tempo startowe, zakres tempa', () => {
    expect(targetText('140–150')).toBe('tętno 140–150 ud./min');
    expect(targetText('<145')).toBe('tętno poniżej 145 ud./min');
    expect(targetText('5:20-5:40')).toBe('5:20–5:40/km');
    expect(targetText('10K', { t5k: '25:00' })).toBe('tempo 10 km · ~5:13/km');
    expect(targetText('HM')).toBe('tempo półmaratonu');
    expect(racePace(5, { t5k: '25:00' })).toBeCloseTo(5, 5);
  });
  it('przerwa: czas odliczany, dystans bez odliczania', () => {
    expect(recoverySec('2:00 trucht')).toBe(120);
    expect(recoverySec('90 s')).toBe(90);
    expect(recoverySec('90')).toBe(90);
    expect(recoverySec('1 min marsz')).toBe(60);
    expect(recoverySec('200 m trucht')).toBeNull();
    expect(recoverySec('')).toBe(0);
    expect(recoverySec('zbieg truchtem')).toBe(0);
  });
  it('suma planowanego biegu: odcinki, przerwy, brakujące z tempa', () => {
    const groups = [
      { type: 'Rozgrzewka' as const, sets: '1', reps: '15', load: '', rpe: '', pace: '6:00' },
      { type: 'Robocze' as const, sets: '6', reps: '', load: '800 m', rpe: '', pace: '4:00', rest: '200 m trucht' },
      { type: 'Schłodzenie' as const, sets: '1', reps: '10', load: '2', rpe: '' },
    ];
    const t = planRunTotals(groups);
    expect(t.km).toBeCloseTo(2.5 + 4.8 + 1 + 2, 5);
    expect(t.min).toBeCloseTo(15 + 19.2 + 10, 5);
    expect(t.approx).toBe(true);
  });
  it('czas i przerwy w zapisie biegaczy (5\'30, 45.30, 1h 05, 1 min 30 s)', () => {
  const d = (x: string) => { const v = parseDur(x); return v == null ? null : Math.round(v * 60); };
  expect([d('45'), d('3:05'), d("5'30"), d('45.30'), d('3,05'), d('2,5'), d('1h'), d('1h 05'), d('1 min 30 s'), d('90 s'), d('1:20:00'), d('45-50')]).toEqual([2700, 185, 330, 2730, 185, 150, 3600, 3900, 90, 90, 4800, null]);
  expect([recoverySec('2:00 trucht'), recoverySec("1'30 marsz"), recoverySec('1 min 30 s'), recoverySec('90 s'), recoverySec('8'), recoverySec('2'), recoverySec('200 m trucht'), recoverySec('zbieg truchtem'), recoverySec('1 min marsz')]).toEqual([120, 90, 90, 90, 8, 120, null, 0, 60]);
  expect([targetText('5.30'), targetText("5'30"), targetText('5:20-5:40 /km')]).toEqual(['5:30/km', '5:30/km', '5:20–5:40/km']);
  });
});

describe('strefy z progu (LTHR), kilometraż tygodniowy, skok km', async () => {
  const { ZONES, zoneHr, zoneHrRange, zoneSourceText, runVolume, kmSpike, plannedRunKm } = await import('./running');
  const { clientAlerts } = await import('./alerts');
  it('LTHR 172: ciągłe zakresy Friela zmapowane na Z1–Z5', () => {
    const p = { lthr: 172, hrMax: 195 };
    expect(ZONES.map((z) => zoneHrRange(zoneHr(z, p)!))).toEqual(['poniżej 146', '146–154', '155–162', '163–176', 'od 177']);
    expect(zoneHr(ZONES[1], p)).toMatchObject({ src: 'lthr', base: 172 });
  });
  it('próg ma pierwszeństwo przed tętnem maks.; źródło w opisie celu', () => {
    expect(targetText('Z2', { hrMax: 190, lthr: 172 })).toBe('Z2 rozbieganie (OWB1) · 146–154 ud./min (z progu 172)');
    expect(targetText('Z1', { lthr: 172 })).toBe('Z1 trucht / regeneracja · poniżej 146 ud./min (z progu 172)');
    expect(targetText('BC3', { lthr: 172, t5k: '25:00' })).toBe('Z4 próg (BC3) · 163–176 ud./min (z progu 172) · ~5:09–5:30/km');
    // bez progu — jak dotąd z tętna maks.
    expect(targetText('Z2', { hrMax: 190 })).toBe('Z2 rozbieganie (OWB1) · 114–133 ud./min');
    // nierealny próg — pomijany
    expect(targetText('Z2', { hrMax: 190, lthr: 60 })).toBe('Z2 rozbieganie (OWB1) · 114–133 ud./min');
    expect(zoneSourceText({ lthr: 172 })).toBe('z progu 172');
    expect(zoneSourceText({ hrMax: 190 })).toBe('z tętna maks. 190');
    expect(zoneSourceText({})).toBe('');
  });

  const TODAY = '2026-10-22'; // czwartek; tydzień od 19.10
  let n = 0;
  const run = (date: string, km: number, name = 'Bieg') => ({ id: `r${++n}`, clientId: 'c1', date, charge: 'brak' as const, exercises: [{ name, cardio: true, setsLog: [{ reps: km * 6, dist: km, unit: 'min' as const }] }] });
  it('plan vs wykonanie w tygodniach (dni z planu, km z tempa celu, bez roweru)', () => {
    const plan = {
      id: 'p1',
      clientId: 'c1',
      name: 'Plan',
      active: true,
      startDate: '2026-10-12',
      weeks: [
        { id: 'w1', name: 'T1', workouts: [{ id: 'k1', name: 'A', day: 2, exercises: [{ id: 'e1', name: 'Rozbieganie', cardio: true, groups: [{ type: 'Robocze' as const, sets: '1', reps: '40', load: '', rpe: '', pace: '5:00' }] }] }] },
        {
          id: 'w2',
          name: 'T2',
          workouts: [
            { id: 'k2', name: 'B', day: 1, exercises: [{ id: 'e2', name: 'Interwały', cardio: true, groups: [{ type: 'Robocze' as const, sets: '6', reps: '', load: '800 m', rpe: '' }] }] },
            { id: 'k3', name: 'C', day: 3, exercises: [{ id: 'e3', name: 'Rower', cardio: true, groups: [{ type: 'Robocze' as const, sets: '1', reps: '', load: '20', rpe: '' }] }] },
          ],
        },
      ],
    };
    expect(plannedRunKm(plan.weeks[1].workouts[1].exercises)).toBe(0);
    const v = runVolume([plan], [run('2026-10-14', 7), run('2026-10-20', 5), run('2026-10-21', 3, 'Wioślarz')], undefined, 3, TODAY);
    expect(v).toEqual([
      { week: '2026-10-05', planned: 0, done: 0 },
      { week: '2026-10-12', planned: 8, done: 7 },
      { week: '2026-10-19', planned: 4.8, done: 5 },
    ]);
  });
  it('skok km: > 15% żółty, > 30% czerwony, tylko od 10 km', () => {
    expect(kmSpike([run('2026-10-13', 10), run('2026-10-20', 11)], TODAY)).toBeNull();
    expect(kmSpike([run('2026-10-13', 10), run('2026-10-20', 12)], TODAY)).toMatchObject({ level: 'yellow', from: 10, to: 12 });
    expect(kmSpike([run('2026-10-13', 8), run('2026-10-20', 16)], TODAY)).toBeNull();
    // bieżący tydzień jeszcze niski — liczy się ostatni pełny vs wcześniejszy
    expect(kmSpike([run('2026-10-06', 24), run('2026-10-13', 32), run('2026-10-20', 4)], TODAY)).toMatchObject({ level: 'red', from: 24, to: 32 });
    const c = { id: 'c1', name: 'T', status: 'aktywny' as const, payments: [], measurements: [], tests: [], injuryLog: [], checkins: [] };
    expect(clientAlerts(c, [run('2026-10-06', 24), run('2026-10-13', 32)], TODAY)).toContainEqual({ level: 'red', text: 'Kilometraż +33% (24 → 32 km)' });
  });
});
