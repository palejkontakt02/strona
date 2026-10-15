import { describe, expect, it } from 'vitest';
import { undoSession } from './ops';
import type { Db } from './db';

const db = {
  clients: [], plans: [], appointments: [{ id: 'a1', clientId: 'c1', date: '2026-10-15', time: '09:00', status: 'done', sessionId: 's1' }],
  sessions: [{ id: 's1', clientId: 'c1', date: '2026-10-15', workoutName: 'Rwanie + siła', exercises: [
    { name: 'Back Squat', setsLog: [{ load: 135, reps: 4 }, { load: 142.5, reps: 4 }] },
    { name: 'Snatch Balance', sets: '3', reps: '3', load: '60' },
  ] }],
  library: [], locations: [],
} as unknown as Db;

describe('undoSession', () => {
  it('trening spoza planu wraca do dodatkowych treningów', () => {
    const ch = undoSession(db, 's1');
    expect(ch.some((c) => c.op === 'del' && c.col === 'sessions')).toBe(true);
    const plan = ch.find((c) => c.op === 'put' && c.col === 'plans') as { item: { extra: boolean; weeks: { workouts: { name: string; exercises: { groups: { reps: string; load: string }[] }[] }[] }[] } };
    expect(plan.item.extra).toBe(true);
    const wo = plan.item.weeks[0].workouts[0];
    expect(wo.name).toBe('Rwanie + siła');
    expect(wo.exercises[0].groups.map((g) => `${g.reps}x${g.load}`)).toEqual(['4x135', '4x142.5']);
    expect(wo.exercises[1].groups[0]).toMatchObject({ sets: '3', reps: '3', load: '60' });
    const ap = ch.find((c) => c.op === 'put' && c.col === 'appointments') as { item: { status: string; sessionId?: string } };
    expect(ap.item.status).toBe('planned');
    expect(ap.item.sessionId).toBeUndefined();
  });
});
