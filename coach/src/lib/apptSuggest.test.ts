import { describe, expect, it } from 'vitest';
import type { Appointment } from '../domain';
import { firstFreeHour, suggestSlot, usualSlot } from './apptSuggest';

const ap = (p: Partial<Appointment>): Appointment => ({ id: Math.random().toString(36), clientId: 'c1', date: '2026-10-01', time: '18:00', status: 'done', ...p });

describe('podpowiedź terminu wizyty', () => {
  it('najczęstsza godzina i długość klienta, remis — nowsza', () => {
    const list = [ap({ time: '7:30', duration: 45, date: '2026-09-01' }), ap({ time: '07:30', duration: 45, date: '2026-09-08' }), ap({ time: '18:00', duration: 90, date: '2026-09-15' }), ap({ time: '18:00', status: 'cancel' }), ap({ clientId: 'c2', time: '9:00' })];
    expect(usualSlot(list, 'c1')).toEqual({ time: '07:30', duration: 45 });
    expect(usualSlot([ap({ time: '9:00', date: '2026-09-01' }), ap({ time: '10:00', date: '2026-09-08' })], 'c1')?.time).toBe('10:00');
    expect(usualSlot(list, 'brak')).toBeNull();
  });
  it('pierwsza wolna pełna godzina 7–20 bez kolizji', () => {
    const day = '2026-10-27';
    const busy = [ap({ date: day, time: '07:00', status: 'planned' }), ap({ date: day, time: '08:30', status: 'planned' }), ap({ date: day, time: '10:00', status: 'cancel' })];
    expect(firstFreeHour(busy, day)).toBe('10:00');
    expect(firstFreeHour([], day, 60, { nowMin: 13 * 60 + 10 })).toBe('14:00');
    expect(firstFreeHour([], day, 60, { nowMin: 19 * 60 + 5 })).toBeNull();
  });
  it('zwyczaj klienta, a gdy zajęty — pierwsza wolna godzina', () => {
    const day = '2026-10-27';
    const hist = [ap({ time: '18:00', duration: 60 }), ap({ time: '18:00', duration: 60, date: '2026-10-08' })];
    expect(suggestSlot(hist, 'c1', day)).toEqual({ time: '18:00', duration: 60 });
    const taken = [...hist, ap({ clientId: 'c2', date: day, time: '17:30', status: 'planned' })];
    expect(suggestSlot(taken, 'c1', day)).toEqual({ time: '07:00', duration: 60 });
    expect(suggestSlot([], '', day).time).toBe('07:00');
  });
});
