import { describe, expect, it } from 'vitest';
import type { Appointment, Client, Plan, SetGroup, TrainingSession } from '../domain';
import { clientAlerts } from './alerts';
import { defaultCharge, isOverdue, packageMessage, packageStatus, singleSessionPayment } from './billing';
import { clashes, weeklyDates } from './calendar';
import { addDays, daysBetween, weekStart } from './dates';
import { acwrZone, loadStats, sessionLoad, streak, tonnage, weekly } from './load';
import { num, parseRest, parseTempo, repsN, restSeconds } from './parse';
import { exerciseSummary, mergeGroups, nextWorkout, setCountLabel } from './plan';
import { bestE1, e1rmRPE, e1Series, exerciseE1, loadFor, records, resolveLoad, round25 } from './strength';
import { computeLsi } from './tests';
import { readiness, readinessNorm, wellnessTotal } from './wellness';

const TODAY = '2026-10-13'; // wtorek

let seq = 0;
function sess(p: Partial<TrainingSession> & { date: string }): TrainingSession {
  return { id: `s${++seq}`, clientId: 'c1', charge: 'brak', exercises: [], ...p };
}
function client(p: Partial<Client> = {}): Client {
  return {
    id: 'c1',
    name: 'Test',
    status: 'aktywny',
    payments: [],
    measurements: [],
    tests: [],
    injuryLog: [],
    checkins: [],
    ...p,
  };
}
const g = (p: Partial<SetGroup>): SetGroup => ({ type: 'Robocze', reps: '5', load: '100', rpe: '8', ...p });

describe('dates', () => {
  it('addDays crosses months and years', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30'); // zmiana czasu
  });
  it('weekStart is Monday', () => {
    expect(weekStart('2026-10-13')).toBe('2026-10-12');
    expect(weekStart('2026-10-18')).toBe('2026-10-12'); // niedziela
    expect(weekStart('2026-10-12')).toBe('2026-10-12');
  });
  it('daysBetween', () => expect(daysBetween('2026-10-01', TODAY)).toBe(12));
});

describe('parse', () => {
  it('num accepts comma', () => {
    expect(num('72,5')).toBe(72.5);
    expect(num('')).toBeNull();
    expect(num(undefined)).toBeNull();
  });
  it('repsN takes first number', () => {
    expect(repsN('8-10')).toBe(8);
    expect(repsN('45 s')).toBe(45);
    expect(repsN('AMRAP')).toBeNull();
  });
  it('parseRest', () => {
    expect(parseRest('2:00')).toBe(120);
    expect(parseRest('1:30')).toBe(90);
    expect(parseRest('90')).toBe(90);
    expect(parseRest('3')).toBe(180);
    expect(parseRest('2 min')).toBe(120);
    expect(parseRest('1,5')).toBe(90);
    expect(parseRest('')).toBe(0);
    expect(restSeconds('')).toBe(120);
  });
  it('parseTempo', () => {
    expect(parseTempo('tempo 3-1-X-0, kontrola')).toEqual([3, 1, 1, 0]);
    expect(parseTempo('3 - 0 - 1 - 2')).toEqual([3, 0, 1, 2]);
    expect(parseTempo('bez tempa')).toBeNull();
  });
});

describe('strength', () => {
  it('round25', () => {
    expect(round25(101.2)).toBe(100);
    expect(round25(101.3)).toBe(102.5);
  });
  it('e1RM Epley with RIR', () => {
    // 100 kg × 5 @ RPE 8 → RIR 2 → 100 × (1 + 7/30)
    expect(e1rmRPE(100, 5, 8)).toBeCloseTo(123.333, 3);
    // bez RPE → RIR 0
    expect(e1rmRPE('100', '5', '')).toBeCloseTo(116.667, 3);
    // 1 powt. @10 → kg
    expect(e1rmRPE(140, 1, 10)).toBe(140);
    // powt + RIR > 15 → null
    expect(e1rmRPE(50, 12, 6)).toBeNull();
    expect(e1rmRPE(0, 5, 8)).toBeNull();
  });
  it('loadFor inverts e1RM and rounds to 2.5', () => {
    expect(loadFor(123.333, 5, 8)).toBe(100);
    // brak RPE → RIR 2
    expect(loadFor(123.333, 5, '')).toBe(100);
    // 3 @ 9 → RIR 1 → 123.33 / (1 + 4/30) = 108.8 → 110
    expect(loadFor(123.333, 3, 9)).toBe(110);
    expect(loadFor(150, 1, 10)).toBe(150);
  });
  it('exerciseE1 uses best working set, skipping warmups and undone', () => {
    expect(
      exerciseE1({
        name: 'Przysiad',
        setsLog: [
          { load: 140, reps: 3, rpe: 10, warmup: true },
          { load: 100, reps: 5, rpe: 8 },
          { load: 110, reps: 3, rpe: 9 },
          { load: 200, reps: 3, rpe: 9, done: false },
        ],
      }),
    ).toBeCloseTo(110 * (1 + 4 / 30), 6);
    expect(exerciseE1({ name: 'X', sets: '3', reps: '5', load: '100', rpe: '8' })).toBeCloseTo(123.333, 3);
  });
  it('resolveLoad covers kg, %, relative and RPE-based', () => {
    expect(resolveLoad('100', null, 5, 8, null)).toEqual({ load: 100, why: '' });
    expect(resolveLoad('75%', 160, 5, 8, null)).toEqual({ load: 120, why: '75% szac. 1RM' });
    expect(resolveLoad('75%', null, 5, 8, null).load).toBeNull();
    expect(resolveLoad('-10%', null, 5, 8, 100)).toEqual({ load: 90, why: '-10% od poprzedniej serii' });
    expect(resolveLoad('+4%', null, 5, 8, 100)).toEqual({ load: 105, why: '+4% od poprzedniej serii' });
    expect(resolveLoad('-10%', null, 5, 8, null).load).toBeNull();
    expect(resolveLoad('', 123.333, 5, '', null)).toEqual({ load: 100, why: 'dobrane z historii do RPE 8' });
    expect(resolveLoad('', null, 5, 8, null)).toEqual({ load: null, why: '' });
  });
  it('records need > previous max + 0.05 and come newest first', () => {
    const ss = [
      sess({ date: '2026-09-01', exercises: [{ name: 'Przysiad', load: '100', reps: '5', rpe: '8' }] }),
      sess({ date: '2026-09-08', exercises: [{ name: 'Przysiad', load: '100', reps: '5', rpe: '8' }] }),
      sess({ date: '2026-09-15', exercises: [{ name: 'Przysiad', load: '105', reps: '5', rpe: '8' }] }),
      sess({ date: '2026-09-22', exercises: [{ name: 'Przysiad', load: '110', reps: '5', rpe: '8' }] }),
    ];
    const r = records(ss);
    expect(r.map((x) => x.date)).toEqual(['2026-09-22', '2026-09-15']);
    expect(r[1].gain).toBeCloseTo(5 * (1 + 7 / 30), 6);
    expect(e1Series(ss, 'Przysiad')).toHaveLength(4);
    expect(bestE1(ss, 'Przysiad')).toBeCloseTo(110 * (1 + 7 / 30), 6);
  });
});

describe('load monitoring', () => {
  it('session load and tonnage', () => {
    expect(sessionLoad(sess({ date: TODAY, srpe: 7, duration: 60 }))).toBe(420);
    expect(sessionLoad(sess({ date: TODAY, srpe: 7 }))).toBeNull();
    expect(
      tonnage(
        sess({
          date: TODAY,
          exercises: [
            { name: 'A', sets: '3', reps: '5', load: '100' },
            { name: 'B', setsLog: [{ load: 60, reps: 10, warmup: true }, { load: 80, reps: 8 }, { load: 80, reps: 6 }] },
          ],
        }),
      ),
    ).toBe(1500 + 640 + 480);
  });
  it('ACWR needs 21 days of history', () => {
    const short = [sess({ date: addDays(TODAY, -3), srpe: 5, duration: 60 })];
    expect(loadStats(short, TODAY).acwr).toBeNull();
  });
  it('ACWR, monotony, strain', () => {
    // 3 wcześniejsze tygodnie po 2 treningi × 300 AU; w ostatnich 7 dniach 300 + 600 AU
    const ss: TrainingSession[] = [];
    for (let w = 1; w <= 3; w++) {
      ss.push(sess({ date: addDays(TODAY, -7 * w), srpe: 5, duration: 60 }));
      ss.push(sess({ date: addDays(TODAY, -7 * w - 2), srpe: 5, duration: 60 }));
    }
    ss.push(sess({ date: addDays(TODAY, -5), srpe: 5, duration: 60 }));
    ss.push(sess({ date: TODAY, srpe: 10, duration: 60 }));
    const st = loadStats(ss, TODAY);
    expect(st.acute).toBe(900);
    // dane z 24 dni → średnia z 24/7 tygodnia, nie z 4
    expect(st.chronic).toBeCloseTo((900 + 600 * 3) / (24 / 7), 6);
    expect(st.acwr).toBeCloseTo(900 / ((900 + 600 * 3) / (24 / 7)), 6);
    const mean = 900 / 7;
    const sd = Math.sqrt(((600 - mean) ** 2 + (300 - mean) ** 2 + 5 * mean ** 2) / 7);
    expect(st.monotony).toBeCloseTo(mean / sd, 6);
    expect(st.strain).toBeCloseTo(900 * (mean / sd), 6);
  });
  it('acwrZone boundaries', () => {
    expect(acwrZone(0.79).level).toBe('yellow');
    expect(acwrZone(0.8).level).toBe('green');
    expect(acwrZone(1.3).level).toBe('green');
    expect(acwrZone(1.31).level).toBe('yellow');
    expect(acwrZone(1.5).level).toBe('yellow');
    expect(acwrZone(1.51).level).toBe('red');
    expect(acwrZone(null).level).toBeNull();
  });
  it('weekly buckets Monday–Sunday', () => {
    const ss = [sess({ date: '2026-10-12', srpe: 5, duration: 60 }), sess({ date: '2026-10-11', srpe: 5, duration: 60 })];
    expect(weekly(ss, sessionLoad, 2, TODAY)).toEqual([
      { x: '2026-10-05', y: 300 },
      { x: '2026-10-12', y: 300 },
    ]);
  });
  it('streak counts from previous week when current is empty', () => {
    const ss = [sess({ date: '2026-10-06' }), sess({ date: '2026-10-08' }), sess({ date: '2026-09-29' }), sess({ date: '2026-09-15' })];
    expect(streak(ss, TODAY)).toEqual({ weeks: 2, sessions: 3 });
    expect(streak([...ss, sess({ date: TODAY })], TODAY)).toEqual({ weeks: 3, sessions: 4 });
  });
});

describe('wellness', () => {
  const full = { sleep: 4, energy: 3, muscle: 4, stress: 3, mood: 5 };
  it('total and readiness need all five', () => {
    expect(wellnessTotal(full)).toBe(19);
    expect(readiness(full)).toBe(3.8);
    expect(wellnessTotal({ sleep: 4 })).toBeNull();
  });
  it('readiness norm: 28 days before today, check-in wins over session on the same day', () => {
    const checkins = [
      { date: addDays(TODAY, -1), ...full }, // 3.8
      { date: addDays(TODAY, -29), sleep: 1, energy: 1, muscle: 1, stress: 1, mood: 1 }, // poza oknem
      { date: TODAY, sleep: 1, energy: 1, muscle: 1, stress: 1, mood: 1 }, // dziś się nie liczy
    ];
    const ss = [
      sess({ date: addDays(TODAY, -1), wellness: { sleep: 1, energy: 1, muscle: 1, stress: 1, mood: 1 } }), // duplikat dnia
      sess({ date: addDays(TODAY, -3), wellness: { sleep: 3, energy: 3, muscle: 3, stress: 3, mood: 3 } }), // 3
    ];
    expect(readinessNorm(checkins, ss, TODAY)).toBeCloseTo(3.4, 6);
  });
});

describe('billing', () => {
  const pk = (sessions: number, date: string) =>
    ({ id: date, type: 'pakiet', amount: 1000, date, status: 'paid', sessions }) as const;
  it('package status', () => {
    const c = client({ payments: [pk(10, '2026-08-01'), pk(8, '2026-09-01')] });
    const ss = Array.from({ length: 17 }, (_, i) => sess({ date: addDays('2026-08-01', i), charge: 'pakiet' }));
    expect(packageStatus(c, ss)).toEqual({ total: 18, used: 17, left: 1, size: 8 });
    expect(packageStatus(client(), ss)).toBeNull();
  });
  it('overdue only when unpaid and past due', () => {
    const base = { id: 'p', type: 'pojedyncza', amount: 100, date: '2026-10-01' } as const;
    expect(isOverdue({ ...base, status: 'due', dueDate: '2026-10-12' }, TODAY)).toBe(true);
    expect(isOverdue({ ...base, status: 'due', dueDate: TODAY }, TODAY)).toBe(false);
    expect(isOverdue({ ...base, status: 'paid', dueDate: '2026-10-01' }, TODAY)).toBe(false);
    expect(isOverdue({ ...base, status: 'due' }, TODAY)).toBe(false);
  });
  it('default charge fallback chain', () => {
    expect(defaultCharge(client({ billing: 'abonament' }), [])).toBe('abonament');
    expect(defaultCharge(client({ payments: [pk(5, '2026-10-01')] }), [])).toBe('pakiet');
    const used = Array.from({ length: 5 }, () => sess({ date: TODAY, charge: 'pakiet' }));
    expect(defaultCharge(client({ payments: [pk(5, '2026-10-01')], subRate: 400 }), used)).toBe('abonament');
    expect(defaultCharge(client({ singleRate: 180 }), [])).toBe('pojedyncza');
    expect(defaultCharge(client({ payments: [pk(5, '2026-10-01')] }), used)).toBe('pakiet');
    expect(defaultCharge(client(), [])).toBe('brak');
  });
  it('single session payment', () => {
    expect(singleSessionPayment('x', TODAY, 180, true, 'Sesja')).toMatchObject({ status: 'paid', paidDate: TODAY, dueDate: '2026-10-20' });
    const due = singleSessionPayment('x', TODAY, 180, false, 'Sesja');
    expect(due.status).toBe('due');
    expect(due.paidDate).toBeUndefined();
  });
  it('package message', () => {
    expect(packageMessage(1)).toBe('Zapisano. To był ostatni trening z pakietu.');
    expect(packageMessage(2)).toBe('Zapisano. Został 1 trening w pakiecie.');
    expect(packageMessage(6)).toBe('Zapisano. Zostało 5 treningów w pakiecie.');
    expect(packageMessage(4)).toBe('Zapisano. Zostały 3 treningi w pakiecie.');
    expect(packageMessage(0)).toBe('Zapisano. 1 trening ponad pakiet — czas na nowy pakiet.');
    expect(packageMessage(-4)).toBe('Zapisano. 5 treningów ponad pakiet — czas na nowy pakiet.');
  });
});

describe('LSI', () => {
  it('weaker / stronger', () => expect(computeLsi(150, 180)).toBe(83.3));
  it('involved limb', () => {
    expect(computeLsi(180, 150, { involved: 'L' })).toBe(120);
    expect(computeLsi(180, 150, { involved: 'P' })).toBe(83.3);
  });
  it('lower is better (time)', () => expect(computeLsi(2.2, 2.0, { lowerIsBetter: true })).toBe(90.9));
  it('invalid input', () => expect(computeLsi(0, 100)).toBeNull());
});

describe('plan', () => {
  it('mergeGroups joins identical consecutive rows, not ranges', () => {
    const merged = mergeGroups([g({ type: 'Rozgrzewka', load: '60' }), g({}), g({}), g({}), g({ type: 'Back-off', load: '-10%' }), g({ sets: '2-3' }), g({})]);
    expect(merged.map((x) => `${x.type}:${x.sets}`)).toEqual(['Rozgrzewka:1', 'Robocze:3', 'Back-off:1', 'Robocze:2-3', 'Robocze:1']);
  });
  it('setCountLabel Polish plurals', () => {
    expect(setCountLabel([g({})])).toBe('1 seria');
    expect(setCountLabel([g({ type: 'Rozgrzewka' }), g({}), g({}), g({})])).toBe('3 serie + 1 rozgrz.');
    expect(setCountLabel(Array.from({ length: 5 }, () => g({})))).toBe('5 serii');
  });
  it('exerciseSummary ignores warmups and % loads', () => {
    expect(exerciseSummary([g({ type: 'Rozgrzewka' }), g({ type: 'Top set', reps: '3', load: '120', rpe: '9' }), g({ type: 'Back-off', sets: '3' })])).toEqual({ sets: '4', reps: '3', rpe: '9', load: '120' });
    expect(exerciseSummary([g({ load: '80%' })]).load).toBe('');
  });
  it('nextWorkout uses stable workout ids', () => {
    const plan: Plan = {
      id: 'p1',
      clientId: 'c1',
      name: 'Plan',
      active: true,
      weeks: [
        { id: 'w1', name: 'T1', workouts: [{ id: 'a', name: 'A', exercises: [] }, { id: 'b', name: 'B', exercises: [] }] },
        { id: 'w2', name: 'T2', workouts: [{ id: 'c', name: 'C', exercises: [] }] },
      ],
    };
    expect(nextWorkout(plan, [])?.workout.id).toBe('a');
    const done = [sess({ date: TODAY, planId: 'p1', workoutId: 'a' }), sess({ date: TODAY, planId: 'other', workoutId: 'b' })];
    expect(nextWorkout(plan, done)).toMatchObject({ index: 1, total: 3 });
    const all = ['a', 'b', 'c'].map((w) => sess({ date: TODAY, planId: 'p1', workoutId: w }));
    // po ostatniej jednostce plan zaczyna się od nowa
    expect(nextWorkout(plan, all)?.workout.id).toBe('a');
    // liczy się ostatnio wykonana jednostka, nie pierwsza niewykonana
    const outOfOrder = [sess({ date: '2026-10-01', planId: 'p1', workoutId: 'a' }), sess({ date: '2026-10-08', planId: 'p1', workoutId: 'b' }), sess({ date: '2026-09-20', planId: 'p1', workoutId: 'c' })];
    expect(nextWorkout(plan, outOfOrder)?.workout.id).toBe('c');
    expect(nextWorkout(null, [])).toBeNull();
  });
});

describe('calendar', () => {
  const ap = (p: Partial<Appointment>): Appointment => ({ id: 'x', clientId: 'c1', date: TODAY, time: '10:00', status: 'planned', ...p });
  it('detects overlapping half-open intervals, ignores cancelled', () => {
    const all = [ap({ id: '1', time: '09:00' }), ap({ id: '2', time: '10:30', duration: 30 }), ap({ id: '3', time: '11:00' }), ap({ id: '4', time: '10:15', status: 'cancel' }), ap({ id: '5', time: '10:00', date: '2026-10-14' })];
    expect(clashes(ap({ id: 'new', time: '10:00' }), all).map((a) => a.id)).toEqual(['2']);
    expect(clashes(ap({ id: 'new', time: '09:30', duration: 90 }), all).map((a) => a.id)).toEqual(['1', '2']);
  });
  it('weekly series is clamped to 24 weeks', () => {
    expect(weeklyDates(TODAY, 4)).toEqual(['2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03']);
    expect(weeklyDates(TODAY, 40)).toHaveLength(24);
  });
});

describe('alerts', () => {
  it('collects all signal types', () => {
    const c = client({
      injuryLog: [
        { id: 'i1', name: 'Skręcenie kostki', date: '2026-09-01', status: 'w rehabilitacji' },
        { id: 'i2', name: 'Stary uraz', date: '2025-01-01', status: 'wyleczony' },
      ],
      tests: [
        { id: 't1', date: '2026-08-01', name: 'Single hop (cm)', lsi: 70 },
        { id: 't2', date: '2026-10-01', name: 'Single hop (cm)', lsi: 85 },
        { id: 't3', date: '2026-10-01', name: 'Triple hop (cm)', lsi: 95 },
      ],
    });
    const w = (v: number) => ({ sleep: v, energy: v, muscle: v, stress: v, mood: v });
    const ss = [
      sess({ date: addDays(TODAY, -1), wellness: w(3), pain: 6 }), // 15
      sess({ date: addDays(TODAY, -3), wellness: w(5) }), // 25
      sess({ date: addDays(TODAY, -5), wellness: w(5) }),
    ];
    const texts = clientAlerts(c, ss, TODAY);
    expect(texts).toEqual([
      { level: 'yellow', text: expect.stringMatching(/^Wellness spadł do 15\/25 \(.+, średnio 25\)$/) },
      { level: 'red', text: expect.stringMatching(/^Ból 6\/10 na treningu/) },
      { level: 'yellow', text: 'Aktywne urazy: Skręcenie kostki' },
      { level: 'yellow', text: 'Single hop (cm): LSI 85% (cel ≥90%)' },
    ]);
  });
  it('no alerts for a healthy client', () => expect(clientAlerts(client(), [], TODAY)).toEqual([]));
});

describe('moving and removing within blocks', () => {
  const L = (spec: string) => spec.split(' ').map((t) => ({ n: t.replace('*', ''), linked: t.endsWith('*') || undefined }));
  const show = (l: { n: string; linked?: boolean }[]) => l.map((e) => e.n + (e.linked ? '*' : '')).join(' ');
  it('reorders inside a block without changing its boundaries', async () => {
    const { moveInBlocks } = await import('./plan');
    // A | B C* D* | E   (C, D w bloku z B)
    expect(show(moveInBlocks(L('A B C* D* E'), 2, -1))).toBe('A C B* D* E');
  });
  it('leaving a block makes the exercise standalone and keeps the block together', async () => {
    const { moveInBlocks } = await import('./plan');
    expect(show(moveInBlocks(L('A B C* D* E'), 1, -1))).toBe('B A C D* E');
    expect(show(moveInBlocks(L('A B C* D* E'), 3, 1))).toBe('A B C* E D');
  });
  it('moving into the middle of a block joins it', async () => {
    const { moveInBlocks } = await import('./plan');
    expect(show(moveInBlocks(L('A B C* D* E'), 4, -1))).toBe('A B C* E* D*');
  });
  it('removing a block head keeps the rest together', async () => {
    const { removeFromBlocks } = await import('./plan');
    expect(show(removeFromBlocks(L('A B C* D* E'), 1))).toBe('A C D* E');
    expect(show(removeFromBlocks(L('A B C* E'), 2))).toBe('A B E');
  });
});

describe('num — liczby z formularza', () => {
  it('handles thousands separators and decimal comma', () => {
    expect(num('1 500')).toBe(1500);
    expect(num('1 500,50')).toBe(1500.5);
    expect(num('1.500,00')).toBe(1500);
    expect(num('72,5')).toBe(72.5);
    expect(num('45 s')).toBe(45);
    expect(num('-10%')).toBe(-10);
    expect(num('abc')).toBeNull();
    expect(num('')).toBeNull();
  });
  it('numIn rejects out-of-range values', async () => {
    const { numIn } = await import('./parse');
    expect(numIn('-60', 1, 600)).toBeNull();
    expect(numIn('15', 0, 10)).toBeNull();
    expect(numIn('8,5', 0, 10)).toBe(8.5);
  });
});
