import { describe, expect, it } from 'vitest';
import type { Client, TrainingSession } from '../domain';
import { clientReviewItems, reviewContext, reviewQueue, withReviewed } from './reviewQueue';

const today = '2026-10-26';
const base: Client = { id: 'a', name: 'Anna', status: 'aktywny', payments: [], measurements: [], tests: [], injuryLog: [], checkins: [] };
const sess = (id: string, date: string, extra: Partial<TrainingSession> = {}): TrainingSession => ({ id, clientId: 'a', date, charge: 'brak', exercises: [], ...extra });
const w = (v: number) => ({ sleep: v, energy: v, muscle: v, stress: v, mood: v });
const ex = (name: string, load: number, video?: string) => ({ name, setsLog: [{ reps: 5, load, done: true, ...(video ? { video } : {}) }] }) as unknown as TrainingSession['exercises'][number];

describe('reviewQueue', () => {
  it('raport bez komentarza trenera; z komentarzem albo starszy niż 7 dni — nie', () => {
    const c: Client = {
      ...base,
      weeklyReports: [
        { id: 'r1', week: '2026-10-19', at: '2026-10-25T18:00:00Z', comment: 'Słabo spałam' },
        { id: 'r2', week: '2026-10-12', at: '2026-10-24T18:00:00Z', coachNote: 'Super' },
        { id: 'r3', week: '2026-10-05', at: '2026-10-11T18:00:00Z' },
      ],
    };
    expect(clientReviewItems(c, [], today).map((x) => x.key)).toEqual(['report:r1']);
  });

  it('ból ≥ 5 i spadek samopoczucia', () => {
    const c: Client = { ...base, checkins: [{ date: '2026-10-15', ...w(4) }, { date: '2026-10-18', ...w(4) }, { date: '2026-10-24', ...w(3) }] };
    const s = [sess('s1', '2026-10-23', { pain: 6, painMap: [{ area: 'kolano', side: 'L', level: 6 }] }), sess('s2', '2026-10-22', { pain: 3 })];
    const items = clientReviewItems(c, s, today);
    expect(items.map((x) => x.key).sort()).toEqual(['pain:s1', 'wellness:2026-10-24']);
    expect(items.find((x) => x.kind === 'pain')!.detail).toContain('kolano L');
  });

  it('komentarz do treningu znika po odpowiedzi trenera', () => {
    const c: Client = { ...base, inbox: [{ id: 'n1', at: '2026-10-24T10:00:00Z', text: 'Bolało', ref: { sessionId: 's1', exName: 'Przysiad' } }, { id: 'n2', at: '2026-10-24T11:00:00Z', text: 'zwykła' }] };
    expect(clientReviewItems(c, [], today).map((x) => x.key)).toEqual(['comment:n1']);
    expect(clientReviewItems({ ...c, replies: [{ id: 'r', at: '2026-10-24T12:00:00Z', text: 'ok' }] }, [], today)).toEqual([]);
  });

  it('nagrania, rekordy i żywienie poza celem', () => {
    const s = [
      sess('old', '2026-10-01', { exercises: [ex('Przysiad', 100)] }),
      sess('new', '2026-10-24', { exercises: [ex('Przysiad', 110, 'sb:v1')] }),
      sess('seen', '2026-10-23', { exercises: [ex('Wyciskanie', 50, 'sb:v2')], reviewedAt: '2026-10-23T20:00:00Z' }),
    ];
    const c: Client = { ...base, targets: { kcal: 2000, protein: 100 }, dayLog: [{ date: '2026-10-25', kcal: 3000 }, { date: '2026-10-24', kcal: 2100, protein: 95 }, { date: today, kcal: 500 }] };
    const keys = clientReviewItems(c, s, today).map((x) => x.key).sort();
    expect(keys).toEqual(['food:2026-10-25', 'record:2026-10-24', 'video:new']);
  });

  it('przejrzane elementy znikają; kolejka wg priorytetu', () => {
    const c: Client = { ...base, weeklyReports: [{ id: 'r1', week: '2026-10-19', at: '2026-10-25T18:00:00Z' }] };
    const s = [sess('s1', '2026-10-23', { pain: 7 })];
    expect(reviewQueue([c], s, today).map((x) => x.kind)).toEqual(['pain', 'report']);
    const reviewed = withReviewed(undefined, 'pain:s1');
    expect(reviewQueue([{ ...c, reviewed }], s, today).map((x) => x.kind)).toEqual(['report']);
    expect(reviewQueue([{ ...c, status: 'pauza' }], s, today)).toEqual([]);
    expect(withReviewed(['a', 'b'], 'a')).toEqual(['b', 'a']);
    expect(withReviewed(Array.from({ length: 300 }, (_, i) => `k${i}`), 'x')).toHaveLength(300);
  });

  it('kontekst 8 tygodni', () => {
    const c: Client = {
      ...base,
      measurements: [{ id: 'm', date: '2026-10-21', weight: 70 }],
      weeklyReports: [{ id: 'r', week: '2026-10-12', at: '2026-10-18T10:00:00Z', weight: 71 }],
      checkins: [{ date: '2026-10-20', ...w(4) }, { date: '2026-10-22', ...w(2) }],
    };
    const ctx = reviewContext(c, [sess('s', '2026-10-21', { exercises: [ex('Przysiad', 100)] })], today);
    expect(ctx.volume).toHaveLength(8);
    expect(ctx.volume.at(-2)).toEqual({ x: '2026-10-19', y: 1 });
    expect(ctx.weight).toEqual([
      { x: '2026-10-12', y: 71 },
      { x: '2026-10-19', y: 70 },
    ]);
    expect(ctx.sleep).toEqual([{ x: '2026-10-19', y: 3 }]);
  });
});
