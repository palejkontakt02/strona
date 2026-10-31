import { describe, expect, it } from 'vitest';
import type { Appointment } from '../domain';
import { cancelByTrainer, fmtAccount, normalizeProfile, onVacation, priceDefaults, pricesLine, profileProblems, vacationAppointments, vacationAutoReply, vacationRelevant, vacationReplyText, workHoursLine } from './trainerProfile';

const appt = (id: string, date: string, extra: Partial<Appointment> = {}): Appointment => ({ id, clientId: 'c1', date, time: '18:00', status: 'planned', ...extra });

describe('profil trenera', () => {
  it('porządkuje zapis: puste pola znikają, złe wartości pomijane', () => {
    const p = normalizeProfile({ name: '  Seba ', phone: '', photo: 'http://x', prices: { single: 150, package: { sessions: 0, price: 10 }, subscription: -5 }, defaultDuration: 3, workHours: { from: '07:00', to: '20:00', days: [5, 1, 1, 9] }, vacation: { from: '2026-11-10', to: '2026-11-01' } });
    expect(p).toEqual({ name: 'Seba', prices: { single: 150 }, workHours: { from: '07:00', to: '20:00', days: [1, 5] } });
    expect(normalizeProfile(null)).toEqual({});
    expect(normalizeProfile({ photo: 'sb:trainer/a.jpg', vacation: { from: '2026-11-01', to: '2026-11-07', message: ' Wracam 8.11 ' } })).toEqual({ photo: 'sb:trainer/a.jpg', vacation: { from: '2026-11-01', to: '2026-11-07', message: 'Wracam 8.11' } });
  });
  it('sprawdza numer konta i e-mail', () => {
    expect(profileProblems({ bankAccount: '12 3456' })).toHaveLength(1);
    expect(profileProblems({ bankAccount: 'PL61 1090 1014 0000 0712 1981 2874', email: 'a@b.pl' })).toEqual([]);
    expect(profileProblems({ email: 'zly' })).toHaveLength(1);
    expect(fmtAccount('61109010140000071219812874')).toBe('61 1090 1014 0000 0712 1981 2874');
    expect(fmtAccount('PL61109010140000071219812874')).toBe('PL61 1090 1014 0000 0712 1981 2874');
  });
  it('urlop: od–do włącznie, baner tydzień wcześniej', () => {
    const p = { vacation: { from: '2026-11-10', to: '2026-11-15' } };
    expect(onVacation(p, '2026-11-09')).toBe(false);
    expect(onVacation(p, '2026-11-10')).toBe(true);
    expect(onVacation(p, '2026-11-15')).toBe(true);
    expect(onVacation(p, '2026-11-16')).toBe(false);
    expect(vacationRelevant(p, '2026-11-03')).toBe(true);
    expect(vacationRelevant(p, '2026-11-02')).toBe(false);
    expect(vacationReplyText(p)).toContain('15.11');
    expect(vacationReplyText({ vacation: { ...p.vacation, message: 'Wracam w poniedziałek.' } })).toBe('Wracam w poniedziałek.');
  });
  it('automatyczna odpowiedź raz dziennie', () => {
    const p = { vacation: { from: '2026-11-10', to: '2026-11-15' } };
    const now = new Date('2026-11-11T10:00:00');
    const r = vacationAutoReply({ replies: [] }, p, now)!;
    expect(r.id).toBe('vac-2026-11-11');
    expect(r.auto).toBe('vacation');
    expect(vacationAutoReply({ replies: [r] }, p, now)).toBeNull();
    expect(vacationAutoReply({ replies: [r] }, p, new Date('2026-11-12T10:00:00'))?.id).toBe('vac-2026-11-12');
    expect(vacationAutoReply({}, p, new Date('2026-11-20T10:00:00'))).toBeNull();
    expect(vacationAutoReply({}, null, now)).toBeNull();
  });
  it('wizyty w czasie urlopu: tylko zaplanowane, bez treningu, od dziś', () => {
    const list = [appt('a', '2026-11-12'), appt('b', '2026-11-09'), appt('c', '2026-11-13', { status: 'cancel' }), appt('d', '2026-11-11', { sessionId: 's' }), appt('e', '2026-11-10', { time: '07:00' })];
    expect(vacationAppointments(list, { from: '2026-11-10', to: '2026-11-15' }, '2026-11-01').map((a) => a.id)).toEqual(['e', 'a']);
    expect(vacationAppointments(list, undefined)).toEqual([]);
    expect(cancelByTrainer(list[0]).status).toBe('cancel');
  });
  it('cennik podpowiada stawki tylko w puste pola', () => {
    const p = { prices: { single: 150, package: { sessions: 10, price: 1300 }, subscription: 520.5 } };
    expect(priceDefaults(p, { singleRate: '', pkgSize: '8' })).toEqual({ singleRate: '150', pkgSize: '8', subRate: '520,5', pkgPrice: '1300' });
    expect(priceDefaults({}, { a: '1' })).toEqual({ a: '1' });
    expect(pricesLine(p)).toBe('Sesja 150 zł · Pakiet 10 × 1300 zł · Abonament 520,5 zł/mies.');
  });
  it('godziny pracy po polsku', () => {
    expect(workHoursLine({ from: '07:00', to: '20:00', days: [1, 2, 3, 4, 5] })).toBe('pn–pt 7:00–20:00');
    expect(workHoursLine({ from: '16:00', to: '21:00', days: [1, 3, 5] })).toBe('pn, śr, pt 16:00–21:00');
    expect(workHoursLine(undefined)).toBe('');
  });
});
