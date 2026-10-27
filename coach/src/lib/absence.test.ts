import { describe, expect, it } from 'vitest';
import type { Absence } from '../domain';
import {
  absenceCard,
  absenceMessage,
  absenceProblem,
  activeAbsence,
  defaultAbsenceRange,
  endEarly,
  isAbsent,
  returnWord,
  streakWithAbsences,
  upcomingAbsence,
  weekFullyAbsent,
} from './absence';

const A = (from: string, to: string, reason: Absence['reason'] = 'urlop', note?: string): Absence => ({ id: from + to, from, to, reason, note, at: '2026-10-01T10:00:00Z' });

describe('nieobecność — zakresy', () => {
  it('domyślnie dziś + 7 dni', () => {
    expect(defaultAbsenceRange('2026-10-26')).toEqual({ from: '2026-10-26', to: '2026-11-02' });
  });
  it('dzień objęty / nieobjęty, odwołana się nie liczy', () => {
    const l = [A('2026-11-01', '2026-11-07')];
    expect(isAbsent(l, '2026-11-01')).toBe(true);
    expect(isAbsent(l, '2026-11-07')).toBe(true);
    expect(isAbsent(l, '2026-11-08')).toBe(false);
    expect(isAbsent([A('2026-11-01', '2026-10-31')], '2026-11-01')).toBe(false);
    expect(isAbsent(undefined, '2026-11-01')).toBe(false);
  });
  it('aktywna i zaplanowana', () => {
    const l = [A('2026-11-01', '2026-11-07'), A('2026-12-01', '2026-12-03')];
    expect(activeAbsence(l, '2026-11-03')?.from).toBe('2026-11-01');
    expect(activeAbsence(l, '2026-11-08')).toBeNull();
    expect(upcomingAbsence(l, '2026-11-08')?.from).toBe('2026-12-01');
  });
  it('walidacja formularza', () => {
    expect(absenceProblem('2026-10-26', '2026-11-02', '2026-10-26')).toBeNull();
    expect(absenceProblem('2026-10-26', '2026-10-25', '2026-10-26')).toMatch(/przed/);
    expect(absenceProblem('2026-10-01', '2026-10-20', '2026-10-26')).toMatch(/minęła/);
    expect(absenceProblem('', '2026-10-20', '2026-10-26')).toMatch(/daty/);
    expect(absenceProblem('2026-10-26', '2027-12-01', '2026-10-26')).toMatch(/rok/);
  });
});

describe('teksty', () => {
  it('wiadomość do trenera', () => {
    expect(absenceMessage(A('2026-11-01', '2026-11-07'))).toBe('Nieobecność: urlop 01.11–07.11');
    expect(absenceMessage(A('2026-11-01', '2026-11-01', 'choroba', ' grypa '))).toBe('Nieobecność: choroba 01.11 — grypa');
  });
  it('karta na Dziś: kiedy wraca', () => {
    // 07.11.2026 to sobota → powrót w niedzielę 08.11
    const a = A('2026-11-01', '2026-11-06');
    expect(returnWord(a, '2026-11-03')).toBe('w sobotę');
    expect(absenceCard(a, '2026-11-03')).toEqual({ title: 'Urlop do 06.11', text: 'Urlop do 06.11 — odpocznij. Wracasz w sobotę.' });
    expect(returnWord(a, '2026-11-06')).toBe('jutro');
    expect(returnWord(A('2026-11-01', '2026-11-30'), '2026-11-02')).toBe('01.12');
    expect(absenceCard(A('2026-11-01', '2026-11-06', 'choroba'), '2026-11-03').text).toMatch(/wracaj do zdrowia/);
  });
  it('„Wracam wcześniej” — koniec wczoraj; w dniu startu odwołana', () => {
    expect(endEarly(A('2026-11-01', '2026-11-07'), '2026-11-04').to).toBe('2026-11-03');
    const same = endEarly(A('2026-11-04', '2026-11-07'), '2026-11-04');
    expect(isAbsent([same], '2026-11-04')).toBe(false);
  });
});

describe('seria tygodni z nieobecnością', () => {
  const S = (date: string) => ({ date });
  // tygodnie (pn): 05.10, 12.10, 19.10, 26.10
  const sessions = [S('2026-10-06'), S('2026-10-20'), S('2026-10-27')];
  it('bez nieobecności tydzień bez treningu przerywa serię', () => {
    expect(streakWithAbsences(sessions, '2026-10-28', []).weeks).toBe(2);
  });
  it('tydzień w całości na urlopie nie przerywa (i się nie dolicza)', () => {
    const r = streakWithAbsences(sessions, '2026-10-28', [A('2026-10-11', '2026-10-19')]);
    expect(r).toEqual({ weeks: 3, sessions: 3 });
  });
  it('urlop tylko przez część tygodnia — przerywa', () => {
    expect(streakWithAbsences(sessions, '2026-10-28', [A('2026-10-12', '2026-10-16')]).weeks).toBe(2);
  });
  it('kilka nachodzących nieobecności pokrywa tydzień', () => {
    expect(weekFullyAbsent([A('2026-10-12', '2026-10-14'), A('2026-10-15', '2026-10-18', 'choroba')], '2026-10-12')).toBe(true);
  });
  it('bieżący tydzień pusty — liczy od poprzedniego; brak treningów — 0', () => {
    expect(streakWithAbsences([S('2026-10-20')], '2026-10-28', []).weeks).toBe(1);
    expect(streakWithAbsences([], '2026-10-28', [A('2026-10-01', '2026-10-30')]).weeks).toBe(0);
  });
});
