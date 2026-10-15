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
