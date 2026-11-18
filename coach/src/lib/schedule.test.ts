import { describe, expect, it } from 'vitest';
import { createSeed } from '../data/seed';
import { followPlan, scheduleWorkout, workoutAppointment } from '../data/ops';
import type { Appointment, Plan } from '../domain';
import type { Change, Db } from '../data/db';
import { moveVisit } from './calendarMove';
import { nextDate, nextWorkout } from './plan';

const applyAll = (db: Db, ch: Change[]): Db => {
  const out = structuredClone(db);
  for (const c of ch) {
    if (c.op !== 'put') continue;
    const list = out[c.col] as unknown as { id: string }[];
    const i = list.findIndex((x) => x.id === (c.item as { id: string }).id);
    if (i >= 0) list[i] = c.item as never;
    else list.push(c.item as never);
  }
  return out;
};

const base = createSeed();
const plan = base.plans.find((p) => p.active && !p.extra && p.weeks.length > 1 && p.weeks[0].workouts.length)!;
const cid = plan.clientId;
// bez zaplanowanych wizyt tego podopiecznego (czysty start)
const db0: Db = { ...base, appointments: base.appointments.filter((a) => a.clientId !== cid) };
const k = plan.weeks[1].workouts[0];
const workout = (p: Plan) => p.weeks.flatMap((w) => w.workouts).find((x) => x.id === k.id)!;

describe('termin jednostki planu', () => {
  it('dzień + godzina: jednostka na ten dzień, nowa wizyta powiązana z jednostką', () => {
    const db = applyAll(db0, scheduleWorkout(db0, plan, k.id, '2026-12-03', '18:00'));
    const p = db.plans.find((x) => x.id === plan.id)!;
    expect(workout(p).date).toBe('2026-12-03');
    expect(workout(p).moved?.by).toBe('trainer');
    const a = workoutAppointment(db, plan.id, k.id)!;
    expect(a).toMatchObject({ clientId: cid, date: '2026-12-03', time: '18:00', status: 'planned' });
  });
  it('zmiana terminu przesuwa tę samą wizytę (bez drugiej)', () => {
    const db1 = applyAll(db0, scheduleWorkout(db0, plan, k.id, '2026-12-03', '18:00'));
    const p1 = db1.plans.find((x) => x.id === plan.id)!;
    const db2 = applyAll(db1, scheduleWorkout(db1, p1, k.id, '2026-12-04', '7:30'));
    const mine = db2.appointments.filter((a) => a.clientId === cid);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ date: '2026-12-04', time: '07:30' });
    expect(workout(db2.plans.find((x) => x.id === plan.id)!).date).toBe('2026-12-04');
  });
  it('bez godziny: tylko dzień jednostki, bez wizyty', () => {
    const db = applyAll(db0, scheduleWorkout(db0, plan, k.id, '2026-12-03', ''));
    expect(db.appointments.filter((a) => a.clientId === cid)).toHaveLength(0);
    expect(workout(db.plans.find((x) => x.id === plan.id)!).date).toBe('2026-12-03');
  });
  it('wizyta już umówiona tego dnia — podpięta zamiast drugiej', () => {
    const appt: Appointment = { id: 'a1', clientId: cid, date: '2026-12-03', time: '17:00', duration: 60, status: 'planned' };
    const db1 = { ...db0, appointments: [...db0.appointments, appt] };
    const db = applyAll(db1, scheduleWorkout(db1, plan, k.id, '2026-12-03', '18:00'));
    const mine = db.appointments.filter((a) => a.clientId === cid);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: 'a1', time: '18:00', planRef: { planId: plan.id, workoutId: k.id } });
  });
  it('przesunięcie wizyty w kalendarzu przesuwa jednostkę planu', () => {
    const db1 = applyAll(db0, scheduleWorkout(db0, plan, k.id, '2026-12-03', '18:00'));
    const a = workoutAppointment(db1, plan.id, k.id)!;
    const db2 = applyAll(db1, moveVisit(db1, a, '2026-12-05', '10:00'));
    expect(workout(db2.plans.find((x) => x.id === plan.id)!).date).toBe('2026-12-05');
    expect(followPlan(db2, { ...a, date: '2026-12-05' }, '2026-12-05')).toEqual([]);
  });
  it('następna jednostka z terminem: data następnego treningu = termin', () => {
    const first = nextWorkout(plan, [])!;
    const db = applyAll(db0, scheduleWorkout(db0, plan, first.workout.id, '2030-01-09', '18:00'));
    const p = db.plans.find((x) => x.id === plan.id)!;
    expect(nextDate(p, nextWorkout(p, []), '2030-01-01')).toBe('2030-01-09');
  });
});
