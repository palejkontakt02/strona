import { describe, expect, it } from 'vitest';
import type { Appointment } from '../domain';
import { moveClashes, moveOptions, moveReply, nextAppointment, shiftTime, whenLabel } from './moveAppt';

const a = (id: string, date: string, time: string, extra: Partial<Appointment> = {}): Appointment => ({ id, clientId: 'c1', date, time, status: 'planned', ...extra });

describe('przesuń wizytę z rozmowy', () => {
  it('najbliższa zaplanowana wizyta, od teraz', () => {
    const list = [a('x', '2026-11-05', '10:00'), a('y', '2026-11-04', '08:00'), a('z', '2026-11-04', '18:00'), a('w', '2026-11-04', '19:00', { status: 'cancel' }), a('v', '2026-11-04', '17:00', { clientId: 'c2' })];
    expect(nextAppointment(list, 'c1', '2026-11-04', new Date('2026-11-04T12:00:00'))?.id).toBe('z');
    expect(nextAppointment(list, 'c3', '2026-11-04')).toBeUndefined();
  });
  it('opcje +1 h / −1 h / jutro', () => {
    expect(moveOptions({ date: '2026-11-04', time: '18:00' })).toEqual([
      { key: 'plus1', label: '+1 h', date: '2026-11-04', time: '19:00' },
      { key: 'minus1', label: '−1 h', date: '2026-11-04', time: '17:00' },
      { key: 'tomorrow', label: 'jutro', date: '2026-11-05', time: '18:00' },
    ]);
    expect(moveOptions({ date: '2026-11-04', time: '18:00' }, '2026-11-04')[2]).toEqual({ key: 'tomorrow', label: 'jutro', date: '2026-11-05', time: '18:00' });
    expect(moveOptions({ date: '2026-11-05', time: '18:00' }, '2026-11-04')[2]).toEqual({ key: 'tomorrow', label: '+1 dzień', date: '2026-11-06', time: '18:00' });
    expect(shiftTime('23:30', 60)).toBeNull();
    expect(moveOptions({ date: '2026-11-04', time: '00:30' }).map((o) => o.key)).toEqual(['plus1', 'tomorrow']);
  });
  it('kolizje i odpowiedź', () => {
    const me = a('m', '2026-11-04', '18:00');
    const other = a('o', '2026-11-04', '19:00', { clientId: 'c2' });
    expect(moveClashes(me, '2026-11-04', '19:00', [me, other]).map((x) => x.id)).toEqual(['o']);
    expect(moveClashes(me, '2026-11-04', '17:00', [me, other])).toEqual([]);
    expect(moveReply('2026-11-05', '18:00', '2026-11-02')).toBe('Przesunąłem na czw. 18:00 ✓');
    expect(whenLabel('2026-11-03', '18:00', '2026-11-02')).toBe('jutro 18:00');
    expect(whenLabel('2026-11-20', '9:00', '2026-11-02')).toBe('pt. 20.11, 9:00');
  });
});
