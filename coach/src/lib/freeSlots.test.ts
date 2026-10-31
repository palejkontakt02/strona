import { describe, expect, it } from 'vitest';
import type { Appointment } from '../domain';
import { axisRange, busyOn, freeSlots, hoursOn, lanes, nextFree, slotLabel, weekSummary } from './freeSlots';

const ap = (id: string, date: string, time: string, duration = 60, status: Appointment['status'] = 'planned'): Appointment => ({ id, clientId: 'c', date, time, duration, status });
// 2026-11-02 = poniedziałek
const MON = '2026-11-02';

describe('freeSlots', () => {
  it('domyślne godziny pracy: pn–pt 7–21, sob 8–14, nd wolne', () => {
    expect(hoursOn(MON)).toEqual({ from: 420, to: 1260 });
    expect(hoursOn('2026-11-07')).toEqual({ from: 480, to: 840 });
    expect(hoursOn('2026-11-08')).toBeNull();
  });
  it('godziny z profilu trenera', () => {
    const wh = { from: '09:00', to: '17:00', days: [1, 3] };
    expect(hoursOn(MON, wh)).toEqual({ from: 540, to: 1020 });
    expect(hoursOn('2026-11-03', wh)).toBeNull();
  });
  it('scala nakładające się wizyty, pomija odwołane', () => {
    expect(busyOn([ap('a', MON, '10:00', 60), ap('b', MON, '10:30', 60), ap('x', MON, '12:00', 60, 'cancel')], MON)).toEqual([{ from: 600, to: 690 }]);
  });
  it('okienka ≥ 60 min między wizytami', () => {
    const wh = { from: '08:00', to: '14:00', days: [1] };
    const s = freeSlots([ap('a', MON, '09:00'), ap('b', MON, '10:30'), ap('c', MON, '12:00')], MON, wh);
    // 8–9 (60), 10–10:30 (30, za krótkie), 11:30–12 (30), 13–14 (60)
    expect(s).toEqual([{ from: 480, to: 540 }, { from: 780, to: 840 }]);
  });
  it('dziś: nie wcześniej niż teraz (do pełnych 15 min); urlop — brak', () => {
    const wh = { from: '08:00', to: '12:00', days: [1] };
    expect(freeSlots([], MON, wh, { notBefore: 9 * 60 + 7 })).toEqual([{ from: 555, to: 720 }]);
    expect(freeSlots([], MON, wh, { off: { from: '2026-11-01', to: '2026-11-03' } })).toEqual([]);
  });
  it('etykieta „wt 14–16”', () => {
    expect(slotLabel('2026-11-03', { from: 840, to: 960 })).toBe('wt 14–16');
    expect(slotLabel('2026-11-05', { from: 630, to: 720 })).toBe('czw 10:30–12');
  });
  it('najbliższe wolne okienka i podsumowanie tygodnia', () => {
    const wh = { from: '10:00', to: '12:00', days: [2, 4] };
    const appts = [ap('a', '2026-11-03', '10:00', 120), ap('b', '2026-11-05', '10:00', 60), ap('c', MON, '18:00', 60), ap('d', MON, '19:00', 60, 'cancel')];
    expect(nextFree(appts, MON, 0, wh)).toEqual([{ date: '2026-11-05', slot: { from: 660, to: 720 } }]);
    const w = weekSummary(appts, MON, 0, wh);
    expect(w.visits).toBe(3);
    expect(w.label).toBe('Ten tydzień: 3 wizyty, wolne: czw 11–12');
  });
  it('koniec tygodnia bez okienek — bierze następny tydzień', () => {
    const w = weekSummary([], '2026-11-08', 0, { from: '10:00', to: '12:00', days: [2] });
    expect(w.free[0].date).toBe('2026-11-10');
    expect(w.label).toBe('Ten tydzień: 0 wizyt, wolne: wt 10–12');
  });
  it('oś godzin poszerzona o wizyty spoza godzin pracy', () => {
    expect(axisRange([ap('a', MON, '06:15', 45), ap('b', MON, '21:40', 60)], MON)).toEqual({ from: 360, to: 1380 });
    expect(axisRange([], '2026-11-08')).toEqual({ from: 480, to: 1080 });
  });
  it('kolizje obok siebie (kolumny)', () => {
    const r = lanes([ap('a', MON, '10:00', 60), ap('b', MON, '10:30', 60), ap('c', MON, '12:00', 60)]);
    expect(r.map((x) => [x.item.id, x.lane, x.of])).toEqual([['a', 0, 2], ['b', 1, 2], ['c', 0, 1]]);
  });
});
