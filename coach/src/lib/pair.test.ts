import { describe, expect, it } from 'vitest';
import { deleteAppointment, groupOf, saveGroupAppointments } from '../data/ops';
import { clashes } from './calendar';
import type { Db } from '../data/db';
import type { Appointment } from '../domain';

const empty = (): Db => ({ clients: [], plans: [], sessions: [], appointments: [], library: [], locations: [], trainer_notes: [] });
const items = (ch: { op: string; col: string; item?: unknown; id?: string }[]) => ch.filter((c) => c.op === 'put').map((c) => c.item as Appointment);

describe('trening w parze', () => {
  const base: Appointment = { id: 'a', clientId: 'A', date: '2026-10-20', time: '18:00', duration: 60, status: 'planned' };
  it('nowa para: dwie wizyty z jednym groupId, partner nie jest kolizją', () => {
    const out = items(saveGroupAppointments(empty(), base, ['B'], 1));
    expect(out.map((a) => a.clientId)).toEqual(['A', 'B']);
    expect(out[0].groupId).toBeTruthy();
    expect(out[1].groupId).toBe(out[0].groupId);
    expect(clashes(out[0], out)).toEqual([]);
    expect(clashes({ ...out[0], groupId: undefined }, out).map((a) => a.clientId)).toEqual(['B']);
  });
  it('seria co tydzień w parze: każda data osobną grupą', () => {
    const out = items(saveGroupAppointments(empty(), base, ['B'], 4));
    expect(out).toHaveLength(8);
    const db = { ...empty(), appointments: out };
    expect(groupOf(db.appointments, out[2]).map((a) => a.clientId).sort()).toEqual(['A', 'B']);
  });
  it('zmiana godziny przenosi partnera; usunięcie partnera kasuje jego zaplanowaną wizytę', () => {
    const db = { ...empty(), appointments: items(saveGroupAppointments(empty(), base, ['B'], 1)) };
    const a = db.appointments[0];
    const moved = items(saveGroupAppointments(db, { ...a, time: '19:00' }, ['B'], 1, a));
    expect(moved.find((x) => x.clientId === 'B')!.time).toBe('19:00');
    const ch = saveGroupAppointments(db, { ...a }, [], 1, a);
    expect(ch.some((c) => c.op === 'del' && c.id === db.appointments[1].id)).toBe(true);
    expect(items(ch)[0].groupId).toBeUndefined();
  });
  it('usunięcie wizyty z partnerami', () => {
    const db = { ...empty(), appointments: items(saveGroupAppointments(empty(), base, ['B', 'C'], 1)) };
    expect(deleteAppointment(db, db.appointments[0], false, true)).toHaveLength(3);
    expect(deleteAppointment(db, db.appointments[0], false, false)).toHaveLength(1);
  });
});
