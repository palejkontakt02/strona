import { describe, expect, it } from 'vitest';
import type { Appointment, Client, TrainingSession } from '../domain';
import { food7, habits7, overviewRow, overviewRows, sortRows, wellnessTrend } from './overviewTable';

const today = '2026-10-26'; // poniedziałek
const base: Client = { id: 'a', name: 'Anna', status: 'aktywny', payments: [], measurements: [], tests: [], injuryLog: [], checkins: [] };
const sess = (id: string, clientId: string, date: string, extra: Partial<TrainingSession> = {}): TrainingSession => ({ id, clientId, date, charge: 'pakiet', exercises: [], ...extra });
const w = (v: number) => ({ sleep: v, energy: v, muscle: v, stress: v, mood: v });

describe('overviewTable', () => {
  it('ostatni trening: bursztyn > 7 dni, czerwony > 14', () => {
    const input = (date: string) => ({ clients: [base], sessions: [sess('s', 'a', date)], appointments: [] });
    expect(overviewRow(base, input('2026-10-20'), today)).toMatchObject({ lastDays: 6, lastTone: undefined });
    expect(overviewRow(base, input('2026-10-17'), today)).toMatchObject({ lastDays: 9, lastTone: 'warn' });
    expect(overviewRow(base, input('2026-10-10'), today)).toMatchObject({ lastDays: 16, lastTone: 'danger' });
    expect(overviewRow(base, { clients: [base], sessions: [], appointments: [] }, today).lastDays).toBeNull();
  });

  it('pakiet, zaległość, następna wizyta, wiadomości', () => {
    const c: Client = {
      ...base,
      billing: 'pakiet',
      payments: [
        { id: 'p1', type: 'pakiet', amount: 1000, date: '2026-09-01', status: 'paid', sessions: 10 },
        { id: 'p2', type: 'inna', amount: 180, date: '2026-10-01', dueDate: '2026-10-10', status: 'due' },
      ],
      inbox: [
        { id: 'n1', at: '2026-10-25T10:00:00Z', text: 'hej' },
        { id: 'n2', at: '2026-10-24T10:00:00Z', text: 'stare', read: true },
      ],
    };
    const sessions = Array.from({ length: 8 }, (_, i) => sess(`s${i}`, 'a', `2026-10-${String(10 + i).padStart(2, '0')}`));
    const appointments: Appointment[] = [
      { id: 'x2', clientId: 'a', date: '2026-10-29', time: '10:00', status: 'planned' } as Appointment,
      { id: 'x1', clientId: 'a', date: '2026-10-27', time: '18:00', status: 'planned' } as Appointment,
      { id: 'x0', clientId: 'a', date: '2026-10-20', time: '18:00', status: 'planned' } as Appointment,
    ];
    const r = overviewRow(c, { clients: [c], sessions, appointments }, today);
    expect(r.pkgLeft).toBe(2);
    expect(r.pkgTone).toBe('warn');
    expect(r.overdue).toBe(180);
    expect(r.next).toEqual({ date: '2026-10-27', time: '18:00' });
    expect(r.unread).toBe(1);
    expect(r.attention).toBe(true);
  });

  it('samopoczucie: spadek względem poprzednich odczytów', () => {
    const c: Client = { ...base, checkins: [{ date: '2026-10-20', ...w(4) }, { date: '2026-10-22', ...w(4) }, { date: '2026-10-25', ...w(3) }] };
    expect(wellnessTrend(c, [], today)).toMatchObject({ last: 3, base: 4, drop: true });
    const ok: Client = { ...base, checkins: [{ date: '2026-10-20', ...w(4) }, { date: '2026-10-25', ...w(4) }] };
    expect(wellnessTrend(ok, [], today).drop).toBe(false);
    // wellness z treningu też się liczy
    expect(wellnessTrend(base, [sess('s', 'a', '2026-10-24', { wellness: w(5) })], today).last).toBe(5);
  });

  it('jedzenie 7 dni względem celu', () => {
    const c: Client = { ...base, targets: { kcal: 2000, protein: 100 }, dayLog: [{ date: '2026-10-25', kcal: 2000, protein: 60 }, { date: '2026-10-24', kcal: 2200, protein: 80 }] };
    const f = food7(c, today);
    expect(f.kcal).toBeCloseTo(1.05);
    expect(f.protein).toBeCloseTo(0.7);
    expect(f.tone).toBe('danger');
    expect(food7(base, today)).toEqual({ kcal: null, protein: null, tone: undefined });
  });

  it('zadania 7 dni: dzisiejszy niezamknięty dzień nie zaniża wyniku', () => {
    const c: Client = { ...base, habits: [{ id: 'h', title: 'Kroki', schedule: { kind: 'daily' } }], habitLog: [{ date: '2026-10-25', done: ['h'] }, { date: '2026-10-24', done: ['h'] }, { date: '2026-10-23', done: ['h'] }] };
    expect(habits7(c, today)).toBeCloseTo(3 / 6);
    expect(habits7({ ...c, habitLog: [...c.habitLog!, { date: today, done: ['h'] }] }, today)).toBeCloseTo(4 / 7);
    expect(habits7(base, today)).toBeNull();
  });

  it('tylko aktywni, sortowanie z pustymi na końcu', () => {
    const b: Client = { ...base, id: 'b', name: 'Bartek' };
    const z: Client = { ...base, id: 'z', name: 'Zenon', status: 'pauza' };
    const input = { clients: [b, base, z], sessions: [sess('1', 'a', '2026-10-01'), sess('2', 'b', '2026-10-24')], appointments: [] };
    const rows = overviewRows(input, today);
    expect(rows.map((r) => r.name)).toEqual(['Anna', 'Bartek']);
    expect(sortRows(rows, 'last', 'desc').map((r) => r.name)).toEqual(['Anna', 'Bartek']);
    expect(sortRows(rows, 'last', 'asc').map((r) => r.name)).toEqual(['Bartek', 'Anna']);
    const withNull = overviewRows({ ...input, sessions: [sess('2', 'b', '2026-10-24')] }, today);
    expect(sortRows(withNull, 'last', 'desc').map((r) => r.name)).toEqual(['Bartek', 'Anna']);
    expect(sortRows(withNull, 'last', 'asc').map((r) => r.name)).toEqual(['Bartek', 'Anna']);
  });
});
