import { describe, expect, it } from 'vitest';
import type { Client, Location, Payment, TrainingSession } from '../domain';
import { arrearsAt, csvAmount, exportRows, monthEnd, monthReport, toCsv, unusedPackagesAt } from './paymentsReport';
import { defaultSubDue, defaultSubMonth, shiftMonth, subscriptionCandidates } from './billing';
import { daysOverdue, fmtAccount, overdueText, reminderText, remindedText, smsHref, transferTitle } from './payReminder';

const label = (p: Payment) => p.desc ?? p.type;
const cl = (id: string, name: string, payments: Payment[], extra: Partial<Client> = {}) =>
  ({ id, name, status: 'aktywny', payments, measurements: [], tests: [], injuryLog: [], checkins: [], ...extra }) as Client;

const anna = cl('a', 'Anna Kowalska', [
  { id: 'p1', type: 'pakiet', amount: 1000, sessions: 10, date: '2026-10-02', status: 'paid', paidDate: '2026-10-02', method: 'blik' },
  { id: 'p2', type: 'pojedyncza', amount: 120.5, date: '2026-10-10', dueDate: '2026-10-17', status: 'paid', paidDate: '2026-11-03', method: 'gotówka', doc: 'PAR/12' },
  { id: 'p3', type: 'inna', desc: 'Plan; "dieta"', amount: 200, date: '2026-10-20', dueDate: '2026-10-27', status: 'due' },
]);
const bartek = cl('b', 'Bartek Nowak', [
  { id: 'p4', type: 'abonament', amount: 400, month: '2026-10', date: '2026-10-01', dueDate: '2026-10-07', status: 'paid', paidDate: '2026-10-05', method: 'przelew' },
  { id: 'p5', type: 'abonament', amount: 400, month: '2026-09', date: '2026-09-01', dueDate: '2026-09-07', status: 'paid', paidDate: '2026-09-06' },
], { billing: 'abonament', subRate: 400 });
const club: Location = { id: 'l1', name: 'Klub Zdrowie', kind: 'klub', hue: 0, payouts: [{ id: 'po', month: '2026-09', amount: 300, sessions: 6, paidDate: '2026-10-12' }] };
const sessions = [
  { id: 's1', clientId: 'a', date: '2026-10-05', charge: 'pakiet' },
  { id: 's2', clientId: 'a', date: '2026-10-12', charge: 'pakiet' },
  { id: 's3', clientId: 'a', date: '2026-11-02', charge: 'pakiet' },
] as TrainingSession[];
const input = { clients: [anna, bartek], sessions, locations: [club], appointments: [{ id: 'ap', clientId: 'a', date: '2026-10-20', time: '10:00' }] as never };

describe('raport miesięczny', () => {
  it('sumy wg formy, rodzaju i klienta + porównanie z poprzednim', () => {
    const r = monthReport(input, '2026-10', label);
    expect(r.total).toBe(1700);
    expect(r.count).toBe(3);
    expect(r.byMethod.map((b) => [b.key, b.amount])).toEqual([['przelew', 400], ['blik', 1000], ['brak', 300]]);
    expect(r.byKind.map((b) => [b.key, b.amount])).toEqual([['pakiet', 1000], ['abonament', 400], ['klub', 300]]);
    expect(r.byClient[0]).toMatchObject({ label: 'Anna Kowalska', amount: 1000 });
    expect(r.prevMonth).toBe('2026-09');
    expect(r.prevTotal).toBe(400);
    expect(r.diff).toBe(1300);
    expect(r.diffPct).toBe(325);
  });
  it('zaległości na koniec miesiąca liczą też płatność opłaconą później', () => {
    expect(arrearsAt([anna, bartek], monthEnd('2026-10'))).toEqual({ amount: 320.5, count: 2, clients: 1 });
    expect(arrearsAt([anna, bartek], monthEnd('2026-11')).amount).toBe(200);
  });
  it('niewykorzystane sesje z pakietów (z nieobecnością pobraną z pakietu)', () => {
    const a2 = { ...anna, noShowCharges: ['ap'] };
    expect(unusedPackagesAt({ ...input, clients: [a2] }, '2026-10-31')).toEqual({ sessions: 7, value: 700, clients: 1 });
    expect(unusedPackagesAt({ ...input, clients: [a2] }, '2026-11-30').sessions).toBe(6);
  });
  it('monthEnd', () => {
    expect(monthEnd('2026-02')).toBe('2026-02-28');
    expect(monthEnd('2028-02')).toBe('2028-02-29');
    expect(monthEnd('2026-12')).toBe('2026-12-31');
  });
});

describe('CSV', () => {
  it('BOM, średnik, przecinek dziesiętny, cudzysłowy', () => {
    const csv = toCsv(exportRows(input, '2026-10', label));
    expect(csv.startsWith('﻿Data;Klient;Opis;Rodzaj;Kwota;Forma;Dokument;Status;Termin\r\n')).toBe(true);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(5);
    expect(lines[1]).toBe('02.10.2026;Anna Kowalska;pakiet;Pakiet;1000,00;BLIK;;Opłacone;');
    expect(csv).toContain('20.10.2026;Anna Kowalska;"Plan; ""dieta""";Inna;200,00;;;Do zapłaty;27.10.2026');
    expect(csv).toContain(';Klub;300,00;');
    expect(csvAmount(120.5)).toBe('120,50');
  });
});

describe('abonamenty hurtem', () => {
  it('pomija zakończonych, oznacza wystawione', () => {
    const c = cl('c', 'Celina', [], { billing: 'abonament', subRate: 350 });
    const z = cl('z', 'Zenon', [], { billing: 'abonament', subRate: 350, status: 'zakończony' });
    const p = cl('p', 'Pola', [], { billing: 'abonament', status: 'pauza', subRate: 300 });
    const list = subscriptionCandidates([anna, bartek, c, z, p], '2026-10');
    expect(list.map((x) => [x.client.name, x.issued, x.checked])).toEqual([['Celina', false, true], ['Pola', false, false], ['Bartek Nowak', true, false]]);
    expect(subscriptionCandidates([bartek], '2026-11')[0]).toMatchObject({ issued: false, checked: true, amount: 400 });
  });
  it('miesiąc i termin domyślnie', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(defaultSubMonth('2026-10-31')).toBe('2026-11');
    expect(defaultSubMonth('2026-10-05')).toBe('2026-10');
    expect(defaultSubDue('2026-11', '2026-10-31')).toBe('2026-11-07');
    expect(defaultSubDue('2026-10', '2026-10-12')).toBe('2026-10-19');
  });
});

describe('przypomnienie', () => {
  const p: Payment = { id: 'x', type: 'abonament', amount: 400, month: '2026-11', date: '2026-11-01', dueDate: '2026-11-07', status: 'due' };
  it('tytuł przelewu i treść', () => {
    expect(transferTitle('Anna Kowalska', p, 'Abonament listopad 2026')).toBe('Anna Kowalska – Abonament – 11.2026');
    const t = reminderText('Anna Kowalska', p, 'Abonament listopad 2026', { name: 'Jan Trener', bankAccount: '12345678901234567890123456', bankName: 'mBank', blikPhone: '600 100 200' }, '2026-11-10');
    expect(t).toContain('Cześć Anna!');
    expect(t).toContain('400 zł');
    expect(t).toContain('termin minął 07.11.2026');
    expect(t).toContain('Przelew: 12 3456 7890 1234 5678 9012 3456 (mBank), odbiorca: Jan Trener');
    expect(t).toContain('Tytuł przelewu: Anna Kowalska – Abonament – 11.2026');
    expect(t).toContain('BLIK na telefon: 600 100 200');
    expect(t.endsWith('Dziękuję! Jan')).toBe(true);
    expect(reminderText('Ola', { ...p, type: 'pojedyncza', month: undefined }, 'Sesja', {}, '2026-11-01')).not.toContain('Przelew');
  });
  it('dni po terminie, przypomniano, sms', () => {
    expect(daysOverdue(p, '2026-11-10')).toBe(3);
    expect(daysOverdue(p, '2026-11-05')).toBe(0);
    expect(overdueText(1)).toBe('1 dzień po terminie');
    expect(overdueText(22)).toBe('22 dni po terminie');
    expect(remindedText('2026-11-08', '2026-11-10')).toBe('przypomniano 2 dni temu');
    expect(remindedText('2026-11-10', '2026-11-10')).toBe('przypomniano dziś');
    expect(smsHref('600 100 200', 'a b')).toBe('sms:+48600100200?body=a%20b');
    expect(fmtAccount('PL12345678901234567890123456')).toBe('PL12 3456 7890 1234 5678 9012 3456');
  });
});
