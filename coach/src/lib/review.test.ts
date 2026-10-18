import { describe, expect, it } from 'vitest';
import type { Db } from '../data/db';
import { isSolo, undoSession } from '../data/ops';
import { needsReview, sessionVideos } from '../data/videos';
import { upcomingVisits } from '../athlete/History';
import { clientAlerts } from './alerts';
import { doneInPass } from './plan';
import type { Client, Plan, TrainingSession } from '../domain';

const sess = (p: Partial<TrainingSession>): TrainingSession => ({ id: 's', clientId: 'c1', date: '2026-10-15', charge: 'brak', exercises: [], ...p });

describe('nagrania w treningu', () => {
  it('liczy nagrania i status przeglądu', () => {
    const s = sess({ exercises: [{ name: 'Przysiad', setsLog: [{ load: 60, reps: 5, warmup: true }, { load: 100, reps: 5, video: 'idb:a' }, { load: 105, reps: 5, video: 'idb:b' }] }] });
    const v = sessionVideos(s);
    expect(v.map((x) => x.label)).toEqual(['seria 1 · 5 × 100 kg', 'seria 2 · 5 × 105 kg']);
    expect(needsReview(s)).toBe(true);
    expect(needsReview({ ...s, reviewedAt: '2026-10-15T10:00:00Z' })).toBe(false);
    expect(needsReview(sess({}))).toBe(false);
  });
});

describe('samodzielnie / z trenerem', () => {
  it('flaga solo, a stare zapisy: bez rozliczenia i wizyty', () => {
    const db = { appointments: [{ id: 'a', clientId: 'c1', date: '2026-10-15', time: '9:00', status: 'done', sessionId: 's2' }] } as unknown as Db;
    expect(isSolo(db, sess({ solo: true, charge: 'pakiet' }))).toBe(true);
    expect(isSolo(db, sess({ id: 's1' }))).toBe(true);
    expect(isSolo(db, sess({ id: 's2' }))).toBe(false);
    expect(isSolo(db, sess({ id: 's3', charge: 'pakiet' }))).toBe(false);
  });
});

describe('undoSession', () => {
  const plan: Plan = { id: 'p', clientId: 'c1', name: 'Plan', active: true, weeks: [{ id: 'w', name: 'T1', workouts: [{ id: 'A', name: 'A – dół', exercises: [{ id: 'e', name: 'Przysiad', groups: [] }] }] }] };
  const base = { clients: [], plans: [plan], appointments: [], library: [], locations: [] };
  it('dwa różne treningi o tej samej nazwie — oba wracają', () => {
    const extra: Plan = { id: 'x', clientId: 'c1', name: 'Dodatkowe', active: false, extra: true, weeks: [{ id: 'xw', name: 'D', workouts: [{ id: 'k', name: 'Trening', exercises: [{ id: 'e1', name: 'Pompki', groups: [] }] }] }] };
    const s = sess({ id: 'q', workoutName: 'Trening', exercises: [{ name: 'Plank', setsLog: [{ reps: 30 }] }] });
    const ch = undoSession({ ...base, plans: [plan, extra], sessions: [s] } as unknown as Db, 'q');
    const put = ch.find((c) => c.op === 'put' && c.col === 'plans') as { item: Plan } | undefined;
    expect(put?.item.weeks[0].workouts.map((w) => w.name)).toEqual(['Trening', 'Trening (15 paź)']);
  });
  it('powtórka jednostki z planu nie trafia do dodatkowych', () => {
    const s = sess({ id: 'r', workoutName: 'A – dół', exercises: [{ name: 'Przysiad', setsLog: [{ reps: 5, load: 100 }] }] });
    const ch = undoSession({ ...base, sessions: [s] } as unknown as Db, 'r');
    expect(ch.some((c) => c.col === 'plans')).toBe(false);
  });
});

describe('doneInPass', () => {
  it('następny nie jest oznaczony jako zrobiony', () => {
    const plan: Plan = { id: 'p', clientId: 'c1', name: 'P', active: true, weeks: [{ id: 'w', name: 'T', workouts: ['A', 'B', 'C'].map((id) => ({ id, name: id, exercises: [{ id: id + 'e', name: 'x', groups: [] }] })) }] };
    const ss = [sess({ id: '1', planId: 'p', workoutId: 'A', date: '2026-10-01' }), sess({ id: '2', planId: 'p', workoutId: 'B', date: '2026-10-03' }), sess({ id: '3', planId: 'p', workoutId: 'C', date: '2026-09-20' })];
    expect([...doneInPass(plan, ss)].sort()).toEqual(['A', 'B']);
  });
});

describe('wizyty i alerty', () => {
  it('dzisiejsza wizyta po czasie trwania nie jest „najbliższa”', () => {
    const today = new Date().toISOString().slice(0, 10);
    const appts = [
      { id: 'a', clientId: 'c1', date: today, time: '00:00', duration: 1, status: 'planned' as const },
      { id: 'b', clientId: 'c1', date: '2999-01-01', time: '10:00', status: 'planned' as const },
    ];
    expect(upcomingVisits(appts, 'c1', new Date(`${today}T23:00:00`)).map((a) => a.id)).toEqual(['b']);
  });
  it('słaby check-in bez treningu daje alert', () => {
    const c = { injuryLog: [], tests: [], checkins: [{ date: '2026-10-15', sleep: 1, energy: 1, muscle: 1, stress: 1, mood: 1 }] } as unknown as Client;
    expect(clientAlerts(c, [], '2026-10-15').some((a) => a.level === 'red' && a.text.includes('Samopoczucie 5/25'))).toBe(true);
  });
});

describe('ćwiczenia na stronę', () => {
  it('rozpoznaje po nazwie i liczy tonaż ×2', async () => {
    const { perSideByName } = await import('./run');
    const { tonnage } = await import('./load');
    expect(perSideByName('Wiosłowanie hantlem jednorącz')).toBe(true);
    expect(perSideByName('Bułgarskie przysiady')).toBe(true);
    expect(perSideByName('Przysiad ze sztangą')).toBe(false);
    const s = sess({ exercises: [{ name: 'Wykroki', perSide: true, setsLog: [{ reps: 8, load: 20 }] }] });
    expect(tonnage(s)).toBe(320);
  });
});

describe('progresja tygodnia i maks z testu', () => {
  it('nazwa kolejnego tygodnia i progresja serii', async () => {
    const { nextWeekName, progressGroup, cloneWeek } = await import('../data/ops');
    expect(nextWeekName([{ name: 'Tydzień 1' }, { name: 'Tydzień 2' }], 'Tydzień 1')).toBe('Tydzień 3');
    expect(nextWeekName([{ name: 'Baza' }], 'Baza')).toBe('Baza (kopia)');
    const g = { type: 'Robocze' as const, sets: '1', reps: '5', load: '100', rpe: '7' };
    expect(progressGroup(g, 'load2').load).toBe('102,5');
    expect(progressGroup({ ...g, load: '75%' }, 'load5').load).toBe('80%');
    expect(progressGroup(g, 'rep').reps).toBe('6');
    expect(progressGroup(g, 'deload')).toMatchObject({ load: '90', rpe: '5' });
    const w = cloneWeek({ id: 'w', name: 'T1', workouts: [{ id: 'k', name: 'A', exercises: [{ id: 'e', name: 'Przysiad', groups: [g, g, g] }] }] }, 'T2', 'deload');
    expect(w.workouts[0].exercises[0].groups.length).toBe(2);
  });
  it('1RM z testu', async () => {
    const { testedMax } = await import('./strength');
    const tests = [{ name: '1RM przysiad', date: '2026-10-01', value: 132 }, { name: '1RM przysiad', date: '2026-10-10', value: 140 }, { name: 'CMJ', date: '2026-10-10', value: 42 }];
    expect(testedMax(tests, 'Przysiad ze sztangą')?.value).toBe(140);
    expect(testedMax(tests, 'Wyciskanie leżąc')).toBeNull();
    const { buildRunExercise } = await import('./run');
    const r = buildRunExercise({ id: 'e', name: 'Przysiad ze sztangą', groups: [{ type: 'Robocze', sets: '1', reps: '4', load: '80%', rpe: '' }] }, [], undefined, tests as never);
    expect(r.sets[0].load).toBe('112.5');
  });
});

describe('serie na czas i lewa/prawa', () => {
  it('jednostka i strony trafiają do zapisu', async () => {
    const { buildRunExercise, runToExercises } = await import('./run');
    const ex = buildRunExercise({ id: 'e', name: 'Deska bokiem', perSide: true, notes: 'tempo umiarkowane', groups: [{ type: 'Robocze', sets: '2', reps: '30 s', load: '', rpe: '' }] }, []);
    expect(ex.sets[0]).toMatchObject({ reps: '30', unit: 's' });
    expect(ex.notes).toBe('tempo umiarkowane');
    ex.sets[0] = { ...ex.sets[0], reps: '30/20', done: true };
    ex.sets[1] = { ...ex.sets[1], reps: '25', done: true };
    const out = runToExercises({ planId: '', workoutId: '', name: 'x', planName: '', weekName: '', date: '2026-10-18', startedAt: 0, idx: 0, ex: [ex] } as never);
    expect(out[0].setsLog[0]).toMatchObject({ reps: 30, repsR: 20, unit: 's' });
    expect(out[0].setsLog[1]).toMatchObject({ reps: 25, unit: 's' });
    expect(out[0].setsLog[1].repsR).toBeUndefined();
    expect(out[0].reps).toBe('30/20 s');
  });
});

describe('poprawki z weryfikacji', () => {
  it('1RM z testu tylko dla tego samego ćwiczenia; tekst serii na stronę', async () => {
    const { testedMax } = await import('./strength');
    const tests = [{ name: '1RM przysiad', date: '2026-10-10', value: 140 }];
    expect(testedMax(tests, 'Przysiad ze sztangą')?.value).toBe(140);
    expect(testedMax(tests, 'Przysiad bułgarski')).toBeNull();
    expect(testedMax(tests, 'Przysiad przedni')).toBeNull();
    const { setText } = await import('../athlete/History');
    expect(setText({ reps: 30, unit: 's' }, true)).toBe('30 s/str.');
    expect(setText({ reps: 30, repsR: 20, unit: 's' }, true)).toBe('30/20 s (L/P)');
    expect(setText({ reps: 8, load: 20 }, true)).toBe('8/str. × 20 kg');
  });
});

describe('cardio', () => {
  it('plan cardio → odcinki z czasem i dystansem; zapis z tętnem', async () => {
    const { buildRunExercise, runToExercises, cardioByName } = await import('./run');
    const { setText } = await import('../athlete/History');
    const { tonnage } = await import('./load');
    expect(cardioByName('Bieżnia')).toBe(true);
    expect(cardioByName('Wiosłowanie sztangą')).toBe(false);
    const ex = buildRunExercise({ id: 'e', name: 'Rower stacjonarny', groups: [{ type: 'Robocze', sets: '2', reps: '10 min', load: '5', rpe: '6' }] }, []);
    expect(ex.cardio).toBe(true);
    expect(ex.sets[0]).toMatchObject({ reps: '10', unit: 'min', dist: '5', load: '' });
    expect(buildRunExercise({ id: 'f', name: 'Bieżnia', groups: [{ type: 'Robocze', sets: '1', reps: '20', load: '3,5', rpe: '' }] }, []).sets[0].dist).toBe('3,5');
    ex.sets[0] = { ...ex.sets[0], done: true, hr: '142', rpe: '6' };
    const out = runToExercises({ planId: '', workoutId: '', name: 'x', planName: '', weekName: '', date: '2026-10-18', startedAt: 0, idx: 0, ex: [ex] } as never);
    expect(out[0].cardio).toBe(true);
    expect(out[0].setsLog[0]).toMatchObject({ reps: 10, unit: 'min', dist: 5, hr: 142, rpe: 6 });
    expect(setText(out[0].setsLog[0])).toBe('10 min · 5 km · 142 ud./min');
    expect(tonnage({ id: 's', clientId: 'c', date: '2026-10-18', charge: 'brak', exercises: out } as never)).toBe(0);
  });
});
