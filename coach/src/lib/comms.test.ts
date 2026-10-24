import { describe, expect, it } from 'vitest';
import type { Client } from '../domain';
import { adherence, athleteUnread, bump, byDay, chatThread, dayLabel, dayScore, inReportWindow, isoDow, metricHit, photoAt, photoDates, reportDue, reportStats, reportWeek, reportWeights, trainerUnread, weekLabel } from './comms';

const base: Client = { id: 'c1', name: 'Ala Kot', status: 'aktywny', payments: [], measurements: [], tests: [], injuryLog: [], checkins: [] };

describe('weekly report', () => {
  it('week and window', () => {
    expect(isoDow('2026-10-19')).toBe(1);
    expect(isoDow('2026-10-25')).toBe(7);
    expect(reportWeek('2026-10-23')).toBe('2026-10-19'); // pt → bieżący
    expect(reportWeek('2026-10-25')).toBe('2026-10-19'); // nd
    expect(reportWeek('2026-10-26')).toBe('2026-10-19'); // pn → miniony
    expect(reportWeek('2026-10-22')).toBe('2026-10-12'); // czw → poprzedni
    expect(inReportWindow('2026-10-23')).toBe(true);
    expect(inReportWindow('2026-10-26')).toBe(true);
    expect(inReportWindow('2026-10-27')).toBe(false);
  });
  it('due only when expected and not sent', () => {
    expect(reportDue(base, '2026-10-24')).toBe(false); // nie wymagany, brak historii
    const req = { ...base, weeklyReport: true };
    expect(reportDue(req, '2026-10-24')).toBe(true);
    expect(reportDue(req, '2026-10-21')).toBe(false); // środa
    const sent = { ...req, weeklyReports: [{ id: 'r', week: '2026-10-19', at: '2026-10-24T10:00:00Z' }] };
    expect(reportDue(sent, '2026-10-25')).toBe(false);
    expect(reportDue({ ...sent, weeklyReport: undefined }, '2026-10-30')).toBe(true); // ma historię → oczekiwany
    expect(reportDue({ ...sent, weeklyReport: false }, '2026-10-30')).toBe(false);
  });
  it('stats, label and weights', () => {
    const a = { ...base, weeklyReport: true, weeklyReports: [{ id: 'r', week: '2026-10-19', at: 'x', weight: 70 }, { id: 'q', week: '2026-10-12', at: 'x', weight: 71, seenAt: 'y' }] };
    const b = { ...base, id: 'c2', weeklyReport: true };
    const c = { ...base, id: 'c3', weeklyReport: true, status: 'pauza' as const };
    const s = reportStats([a, b, c, base], '2026-10-24');
    expect(s.expected.map((x) => x.id)).toEqual(['c1', 'c2']);
    expect(s.sent.map((x) => x.id)).toEqual(['c1']);
    expect(s.missing.map((x) => x.id)).toEqual(['c2']);
    expect(s.unread).toHaveLength(1);
    expect(reportWeights(a.weeklyReports)).toEqual([{ x: '2026-10-12', y: 71 }, { x: '2026-10-19', y: 70 }]);
    expect(weekLabel('2026-10-19')).toMatch(/^19–25 paź/);
    expect(weekLabel('2026-10-26')).toMatch(/^26 paź – 1 lis/);
  });
});

describe('chat', () => {
  const c = {
    inbox: [
      { id: 'a', at: '2026-10-20T08:00:00.000Z', text: 'hej', read: true },
      { id: 'b', at: '2026-10-22T08:00:00.000Z', text: 'boli kolano', sessionId: 's1' },
      { id: 'h', at: '2026-10-22T09:00:00.000Z', text: 'ukryta', hidden: true },
    ],
    replies: [{ id: 'r', at: '2026-10-21T08:00:00.000Z', text: 'cześć' }, { id: 'r2', at: '2026-10-23T08:00:00.000Z', text: 'odpocznij' }],
  };
  it('thread order, unread', () => {
    expect(chatThread(c).map((m) => m.id)).toEqual(['a', 'r', 'b', 'r2']);
    expect(chatThread(c)[2]).toMatchObject({ from: 'client', sessionId: 's1', read: false });
    expect(trainerUnread(c)).toBe(1);
    expect(athleteUnread(c)).toBe(1); // tylko odpowiedź po ostatniej wiadomości podopiecznego
    expect(athleteUnread(c, '2026-10-23T09:00:00.000Z')).toBe(0);
    expect(athleteUnread({ replies: c.replies })).toBe(2);
  });
  it('days', () => {
    const g = byDay(chatThread(c));
    expect(g).toHaveLength(4);
    expect(dayLabel('2026-10-24', '2026-10-24')).toBe('Dziś');
    expect(dayLabel('2026-10-23', '2026-10-24')).toBe('Wczoraj');
    expect(dayLabel('2026-10-20', '2026-10-24')).toMatch(/20 paź/);
    expect(dayLabel('2025-10-20', '2026-10-24')).toMatch(/2025/);
  });
});

describe('day log', () => {
  const t = { protein: 150, kcal: 2000, steps: 10000 };
  it('hit rules', () => {
    expect(metricHit('protein', 135, 150)).toBe(true);
    expect(metricHit('protein', 120, 150)).toBe(false);
    expect(metricHit('kcal', 2300, 2000)).toBe(false);
    expect(metricHit('kcal', 1850, 2000)).toBe(true);
    expect(metricHit('water', 2, undefined)).toBe(false);
    expect(dayScore({ date: 'x', protein: 150, kcal: 2500 }, t)).toEqual({ hit: 1, total: 3 });
  });
  it('adherence window', () => {
    const log = [
      { date: '2026-10-22', protein: 150, kcal: 2000, steps: 10000 },
      { date: '2026-10-23', protein: 100, steps: 12000 },
    ];
    const a = adherence(log, t, '2026-10-24', 3); // 22, 23, dziś bez wpisu (nie liczy się)
    expect(a.days).toBe(2);
    expect(a.pct).toBeCloseTo(4 / 6);
    expect(a.perMetric.steps).toMatchObject({ avg: 11000, hitDays: 2 });
    expect(a.perMetric.water).toBeUndefined();
    expect(adherence(log, t, '2026-10-24', 7).loggedDays).toBe(2);
    expect(adherence([], undefined, '2026-10-24', 7).pct).toBeNull();
    expect(bump(0.5, -0.25, 15)).toBe(0.25);
    expect(bump(0, -10, 600)).toBe(0);
  });
});

describe('photos', () => {
  const ph = [
    { id: '1', date: '2026-10-01', ref: 'idb:1', pose: 'przód' as const, at: '1' },
    { id: '2', date: '2026-10-20', ref: 'idb:2', pose: 'przód' as const, at: '2' },
    { id: '3', date: '2026-10-20', ref: 'idb:3', pose: 'przód' as const, at: '3', hidden: true },
    { id: '4', date: '2026-10-20', ref: 'idb:4', pose: 'bok' as const, at: '4' },
  ];
  it('dates and pick', () => {
    expect(photoDates(ph, 'przód')).toEqual(['2026-10-20', '2026-10-01']);
    expect(photoAt(ph, 'przód', '2026-10-20')?.id).toBe('2');
    expect(photoAt(ph, 'przód', '2026-10-20', true)?.id).toBe('3');
    expect(photoDates(ph, 'tył')).toEqual([]);
  });
});
