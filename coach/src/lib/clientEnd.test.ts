import { describe, expect, it } from 'vitest';
import type { Appointment, Client, TrainingSession } from '../domain';
import { packageStatus } from './billing';
import { endSummary, refundPayment } from './clientEnd';

const c: Client = { id: 'c1', name: 'Ania', status: 'aktywny', payments: [{ id: 'p1', type: 'pakiet', amount: 1300, sessions: 10, date: '2026-10-01', status: 'paid' }], measurements: [], tests: [], injuryLog: [], checkins: [] };
const ses = (i: number) => ({ id: `s${i}`, clientId: 'c1', date: '2026-10-0' + (i + 1), charge: 'pakiet', exercises: [] }) as unknown as TrainingSession;
const ap = (id: string, date: string, extra: Partial<Appointment> = {}): Appointment => ({ id, clientId: 'c1', date, time: '18:00', status: 'planned', ...extra });

describe('zakończenie współpracy', () => {
  it('liczy przyszłe wizyty i niewykorzystany pakiet', () => {
    const s = endSummary(c, [0, 1, 2, 3].map(ses), [ap('a', '2026-11-05'), ap('b', '2026-10-01'), ap('c', '2026-11-06', { status: 'cancel' }), ap('d', '2026-11-02', { clientId: 'x' })], '2026-11-01');
    expect(s.future.map((a) => a.id)).toEqual(['a']);
    expect(s.unused).toBe(6);
    expect(s.value).toBe(780);
  });
  it('zwrot zeruje pakiet', () => {
    const s = endSummary(c, [ses(0)], [], '2026-11-01');
    const r = refundPayment(s, '2026-11-01', 'r1')!;
    expect(r).toMatchObject({ amount: -1170, sessions: -9, status: 'paid' });
    expect(packageStatus({ ...c, payments: [...c.payments, r] }, [ses(0)])?.left).toBe(0);
    expect(refundPayment({ future: [], unused: 0, value: 0 }, '2026-11-01', 'r')).toBeNull();
  });
});
