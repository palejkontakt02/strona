import { describe, expect, it } from 'vitest';
import type { Appointment } from '../domain';
import type { Change, Db } from '../data/db';
import { moveVisit, seriesEdit, visitsLeftInPackage } from './calendarMove';

const ap = (id: string, date: string, extra: Partial<Appointment> = {}): Appointment => ({ id, clientId: 'c1', date, time: '18:00', status: 'planned', ...extra });
const dbOf = (appointments: Appointment[]) => ({ clients: [], plans: [], sessions: [], appointments, library: [], locations: [], trainer_notes: [] }) as unknown as Db;
const items = (ch: Change[]) => ch.map((c) => (c as { item: Appointment }).item).sort((a, b) => a.id.localeCompare(b.id)).map((a) => `${a.id}@${a.date} ${a.time}`);

describe('przesuwanie wizyt', () => {
  it('pojedyncza wizyta: nowy dzień i godzina', () => {
    const a = ap('a', '2026-10-27');
    expect(items(moveVisit(dbOf([a]), a, '2026-10-29', '07:30'))).toEqual(['a@2026-10-29 07:30']);
  });

  it('para (groupId) przesuwa się razem, inne terminy grupy zostają', () => {
    const list = [ap('a', '2026-10-27', { groupId: 'g' }), ap('b', '2026-10-27', { clientId: 'c2', groupId: 'g' }), ap('c', '2026-11-03', { groupId: 'g' })];
    expect(items(moveVisit(dbOf(list), list[0], '2026-10-28', '18:00'))).toEqual(['a@2026-10-28 18:00', 'b@2026-10-28 18:00']);
  });

  it('seria: „ta i następne” przesuwa kolejne o tyle samo dni, bez odbytych i wcześniejszych', () => {
    const list = [
      ap('s0', '2026-10-20', { seriesId: 'S' }),
      ap('s1', '2026-10-27', { seriesId: 'S' }),
      ap('s2', '2026-11-03', { seriesId: 'S' }),
      ap('s3', '2026-11-10', { seriesId: 'S', status: 'done', sessionId: 'x' }),
      ap('s4', '2026-11-17', { seriesId: 'S' }),
      ap('o', '2026-11-03', { seriesId: 'INNA' }),
    ];
    expect(items(moveVisit(dbOf(list), list[1], '2026-10-29', '19:00', true))).toEqual(['s1@2026-10-29 19:00', 's2@2026-11-05 19:00', 's4@2026-11-19 19:00']);
    expect(items(moveVisit(dbOf(list), list[1], '2026-10-29', '19:00', false))).toEqual(['s1@2026-10-29 19:00']);
  });

  it('seria w parze: kolejne wizyty obu osób', () => {
    const list = [
      ap('m1', '2026-10-27', { seriesId: 'S', groupId: 'g' }),
      ap('p1', '2026-10-27', { clientId: 'c2', seriesId: 'S:c2', groupId: 'g' }),
      ap('m2', '2026-11-03', { seriesId: 'S', groupId: 'g' }),
      ap('p2', '2026-11-03', { clientId: 'c2', seriesId: 'S:c2', groupId: 'g' }),
    ];
    expect(items(moveVisit(dbOf(list), list[0], '2026-10-28', '18:00', true))).toEqual(['m1@2026-10-28 18:00', 'm2@2026-11-04 18:00', 'p1@2026-10-28 18:00', 'p2@2026-11-04 18:00']);
  });

  it('edycja w oknie wizyty: zmiana dnia i godziny w kolejnych z serii', () => {
    const list = [ap('s1', '2026-10-27', { seriesId: 'S' }), ap('s2', '2026-11-03', { seriesId: 'S' })];
    expect(items(seriesEdit(dbOf(list), list[0], { ...list[0], date: '2026-10-26', time: '08:00' }))).toEqual(['s2@2026-11-02 08:00']);
  });

  it('do końca pakietu: pozostałe treningi minus już zaplanowane', () => {
    const list = [ap('a', '2026-10-27'), ap('b', '2026-10-20'), ap('c', '2026-11-03', { status: 'cancel' }), ap('d', '2026-11-10', { clientId: 'c2' })];
    expect(visitsLeftInPackage(dbOf(list), 'c1', 6, '2026-10-24')).toBe(5);
  });
});
