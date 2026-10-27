import { describe, expect, it } from 'vitest';
import type { Client, SessionExercise, TrainingSession } from '../domain';
import { addDays } from './dates';
import { DEFAULT_RULES, clientEvents, dueMessages, fillTemplate, isBirthday, normalizeRules, absentRecently, parseCounts, sampleVars, treningi, type AutoRules } from './autoMessages';

const TODAY = '2026-10-26';
const NOW = new Date('2026-10-26T09:00:00+01:00');
const allOn = (patch: Partial<Record<keyof AutoRules, object>> = {}): AutoRules => {
  const r = normalizeRules({});
  for (const k of Object.keys(r) as (keyof AutoRules)[]) r[k] = { ...r[k], on: true, ...(patch[k] ?? {}) };
  return r;
};
const only = (kind: keyof AutoRules, patch: object = {}): AutoRules => {
  const r = normalizeRules({});
  r[kind] = { ...r[kind], on: true, ...patch };
  return r;
};
const C = (extra: Partial<Client> = {}): Client => ({
  id: 'c1', name: 'Anna Nowak', email: 'anna@example.com', status: 'aktywny', payments: [], measurements: [], tests: [], injuryLog: [], checkins: [], ...extra,
});
let n = 0;
const S = (date: string, exercises: SessionExercise[] = [], extra: Partial<TrainingSession> = {}): TrainingSession => ({ id: `s${++n}`, clientId: 'c1', date, charge: 'brak', exercises, ...extra });
const squat = (load: number, reps = 5): SessionExercise => ({ name: 'Przysiad', setsLog: [{ load, reps, done: true }] });

describe('fillTemplate', () => {
  it('wstawia pola, także bez polskich znaków', () => {
    expect(fillTemplate('{imię}: {ćwiczenie} {wynik}, {imie} {zostalo}', { imię: 'Ania', ćwiczenie: 'Przysiad', wynik: '100 kg × 5', zostało: '2 treningi' })).toBe('Ania: Przysiad 100 kg × 5, Ania 2 treningi');
  });
  it('nieznane pole zostaje', () => {
    expect(fillTemplate('Hej {kto}', { imię: 'A' })).toBe('Hej {kto}');
  });
  it('domyślne treści bez emoji i z polami', () => {
    for (const r of Object.values(DEFAULT_RULES)) {
      expect(r.text).toMatch(/\{imię\}/);
      expect(r.text).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

describe('normalizeRules', () => {
  it('brak zapisu = wszystko wyłączone z domyślną treścią', () => {
    const r = normalizeRules(null);
    expect(Object.values(r).every((x) => !x.on)).toBe(true);
    expect(r.inactive.days).toBe(7);
    expect(r.package.left).toBe(2);
    expect(r.milestone.counts).toEqual([10, 25, 50, 100]);
  });
  it('czyta format { v, rules } i pilnuje zakresów', () => {
    const r = normalizeRules({ v: 1, rules: { inactive: { on: true, text: 'X', days: 500 }, package: { on: true, left: 3 }, milestone: { counts: '50, 10, 10, 1' } } });
    expect(r.inactive).toMatchObject({ on: true, text: 'X', days: 7 });
    expect(r.package.left).toBe(3);
    expect(r.milestone.counts).toEqual([10, 50]);
    expect(r.first.on).toBe(false);
  });
  it('parseCounts', () => {
    expect(parseCounts('100; 25 10')).toEqual([10, 25, 100]);
  });
});

describe('pomocnicze', () => {
  it('urodziny, także 29 lutego', () => {
    expect(isBirthday('1990-10-26', TODAY)).toBe(true);
    expect(isBirthday('1990-10-25', TODAY)).toBe(false);
    expect(isBirthday('2000-02-29', '2027-02-28')).toBe(true);
    expect(isBirthday('2000-02-29', '2028-02-28')).toBe(false);
  });
  it('nieobecność w ostatnich X dniach', () => {
    const ab = (from: string, to: string) => C({ absences: [{ id: 'a', from, to, reason: 'urlop', at: '' }] });
    expect(absentRecently(ab('2026-10-20', '2026-10-30'), TODAY, 7)).toBe(true);
    expect(absentRecently(ab('2026-10-10', '2026-10-21'), TODAY, 7)).toBe(true);
    expect(absentRecently(ab('2026-10-10', '2026-10-19'), TODAY, 7)).toBe(false);
    expect(absentRecently(ab('2026-11-01', '2026-11-05'), TODAY, 7)).toBe(false);
    expect(absentRecently(ab('2026-10-26', '2026-10-25'), TODAY, 7)).toBe(false); // odwołana
    expect(absentRecently(C(), TODAY, 7)).toBe(false);
  });
  it('odmiana', () => {
    expect([1, 2, 5].map(treningi)).toEqual(['1 trening', '2 treningi', '5 treningów']);
  });
  it('podgląd', () => {
    expect(fillTemplate(DEFAULT_RULES.inactive.text, sampleVars('inactive', DEFAULT_RULES))).toContain('Ania, minęło 7 dni');
  });
});

describe('reguły', () => {
  it('(a) pierwszy trening — tylko świeży', () => {
    expect(clientEvents(C(), [S(addDays(TODAY, -1))], only('first'), TODAY).map((e) => [e.kind, e.key])).toEqual([['first', 'first']]);
    expect(clientEvents(C(), [S(addDays(TODAY, -5))], only('first'), TODAY)).toEqual([]);
    expect(clientEvents(C(), [S(addDays(TODAY, -3)), S(TODAY)], only('first'), TODAY)).toEqual([]);
  });
  it('(b) przerwa X dni — klucz = data ostatniego treningu; pauza, zakończony, nieobecność — bez wiadomości', () => {
    const ses = [S('2026-10-01'), S('2026-10-18')];
    const ev = clientEvents(C(), ses, only('inactive'), TODAY);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: 'inactive', key: '2026-10-18', text: expect.stringContaining('minęło 8 dni') });
    expect(clientEvents(C(), ses, only('inactive', { days: 10 }), TODAY)).toEqual([]);
    expect(clientEvents(C({ status: 'pauza' }), ses, only('inactive'), TODAY)).toEqual([]);
    expect(clientEvents(C({ status: 'zakończony' }), ses, only('inactive'), TODAY)).toEqual([]);
    expect(clientEvents(C({ absences: [{ id: 'a', from: '2026-10-20', to: '2026-11-02', reason: 'urlop', at: '' }] }), ses, only('inactive'), TODAY)).toEqual([]);
    // dawno nieaktywny (ponad X + 30 dni) i bez treningów — nic
    expect(clientEvents(C(), [S('2026-08-01')], only('inactive'), TODAY)).toEqual([]);
    expect(clientEvents(C(), [], only('inactive'), TODAY)).toEqual([]);
  });
  it('bez e-maila (brak konta) — nic', () => {
    expect(clientEvents(C({ email: '' }), [S(TODAY)], only('first'), TODAY)).toEqual([]);
  });
  it('(c) rekord — najnowszy trening, największy przyrost; nie częściej niż co 2 dni', () => {
    const ses = [S('2026-09-01', [squat(90)]), S('2026-10-25', [squat(100), { name: 'Martwy ciąg', setsLog: [{ load: 100, reps: 5, done: true }] }])];
    const ev = clientEvents(C(), ses, only('record'), TODAY);
    expect(ev).toHaveLength(1);
    expect(ev[0].key).toBe(ses[1].id);
    expect(ev[0].text).toContain('Przysiad — 100 kg × 5');
    const sent = [{ clientId: 'c1', kind: 'record' as const, key: 'x', at: '2026-10-25T09:00:00+01:00' }];
    expect(clientEvents(C(), ses, only('record'), TODAY, sent, NOW)).toEqual([]);
    // rozgrzewka i pierwszy wynik nie są rekordem
    expect(clientEvents(C(), [S('2026-10-25', [squat(100)])], only('record'), TODAY)).toEqual([]);
  });
  it('(d) pakiet ≤ N — klucz = ostatni pakiet', () => {
    const c = C({ payments: [{ id: 'p1', type: 'pakiet', amount: 0, date: '2026-09-01', status: 'paid', sessions: 4 }] });
    const pk = (k: number) => Array.from({ length: k }, (_, i) => S(addDays('2026-10-01', i), [], { charge: 'pakiet' }));
    expect(clientEvents(c, pk(1), only('package'), TODAY)).toEqual([]);
    const ev = clientEvents(c, pk(2), only('package'), TODAY);
    expect(ev[0]).toMatchObject({ kind: 'package', key: 'p1', text: expect.stringContaining('masz jeszcze 2 treningi') });
    expect(clientEvents(c, pk(3), only('package'), TODAY)[0].text).toContain('1 trening.');
    expect(clientEvents(c, pk(4), only('package'), TODAY)).toEqual([]);
  });
  it('(e) urodziny — także przy pauzie', () => {
    expect(clientEvents(C({ dob: '1995-10-26', status: 'pauza' }), [], only('birthday'), TODAY)[0]).toMatchObject({ kind: 'birthday', key: '2026' });
  });
  it('(f) N-ty trening — tylko świeży, największy próg', () => {
    const ten = Array.from({ length: 10 }, (_, i) => S(addDays('2026-10-17', i)));
    const ev = clientEvents(C(), ten, only('milestone'), TODAY);
    expect(ev[0]).toMatchObject({ kind: 'milestone', key: '10', text: expect.stringContaining('Twój 10. trening') });
    const old = Array.from({ length: 11 }, (_, i) => S(addDays('2026-10-01', i)));
    expect(clientEvents(C(), old, only('milestone'), TODAY)).toEqual([]);
  });
});

describe('dueMessages', () => {
  it('jedna wiadomość na podopiecznego wg priorytetu, deduplikacja po kluczu', () => {
    const db = { clients: [C({ dob: '1990-10-26' })], sessions: [S(addDays(TODAY, -1))] };
    const rules = allOn();
    const first = dueMessages(db, rules, TODAY);
    expect(first.map((m) => m.kind)).toEqual(['birthday']);
    const sent = first.map((m) => ({ ...m, at: NOW.toISOString() }));
    // tego samego dnia — już nic (najwyżej jedna dziennie)
    expect(dueMessages(db, rules, TODAY, sent)).toEqual([]);
    const yesterday = first.map((m) => ({ ...m, at: '2026-10-25T09:00:00+01:00' }));
    expect(dueMessages(db, rules, TODAY, yesterday).map((m) => m.kind)).toEqual(['first']);
    const sent2 = [...yesterday, { clientId: 'c1', kind: 'first' as const, key: 'first', at: '2026-10-25T10:00:00+01:00' }];
    expect(dueMessages(db, rules, TODAY, sent2)).toEqual([]);
  });
  it('wyłączona reguła nic nie wysyła', () => {
    expect(dueMessages({ clients: [C({ dob: '1990-10-26' })], sessions: [] }, normalizeRules({}), TODAY)).toEqual([]);
  });
});
