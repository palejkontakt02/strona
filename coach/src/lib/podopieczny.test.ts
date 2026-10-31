import { describe, expect, it } from 'vitest';
import type { Payment, TrainingSession } from '../domain';
import { dueItems, dueLine, fmtAccount, packageLine, paidMessage, payLabel, reportedAt, transferTitle } from './athletePay';
import { isUnchangedEdit, stableJson } from './editRun';
import { isFemale, pastForm } from './gender';
import { intakeFullDue, parseLater } from './intakeLater';
import { quickRunProblem, quickRunSession, runMinutes } from './quickRun';
import { emptyRun, sessionToRun } from './run';

const pay = (p: Partial<Payment>): Payment => ({ id: 'x', type: 'abonament', amount: 600, date: '2026-10-25', status: 'due', ...p });

describe('płatności podopiecznego', () => {
  it('nazwy i linia „Do zapłaty”', () => {
    expect(payLabel(pay({ month: '2026-11' }))).toBe('abonament listopad');
    expect(payLabel(pay({ type: 'pakiet', sessions: 10 }))).toBe('pakiet 10 sesji');
    expect(payLabel(pay({ type: 'pojedyncza', date: '2026-10-28' }))).toBe('sesja 28.10');
    const d = dueItems({ payments: [pay({ id: 'a', month: '2026-11', dueDate: '2026-11-07' }), pay({ id: 'p', status: 'paid' }), pay({ id: 'b', type: 'pojedyncza', amount: 150, dueDate: '2026-10-20' })] }, '2026-10-31');
    expect(d.map((x) => x.id)).toEqual(['b', 'a']);
    expect(d[0].overdue).toBe(true);
    expect(dueLine(d[1])).toBe('Do zapłaty: 600 zł · abonament listopad · termin 07.11');
    expect(paidMessage(d[1], 'przelew')).toBe('Zapłacone: 600 zł abonament listopad (przelew)');
  });
  it('pakiet: zostały / został / wykorzystany', () => {
    expect(packageLine({ total: 10, used: 7, left: 3, size: 10 }, '2026-11-30')).toBe('Pakiet: zostały 3 z 10 (ważny do 30.11)');
    expect(packageLine({ total: 10, used: 9, left: 1, size: 10 })).toBe('Pakiet: został 1 z 10');
    expect(packageLine({ total: 10, used: 5, left: 5, size: 10 })).toBe('Pakiet: zostało 5 z 10');
    expect(packageLine({ total: 10, used: 11, left: -1, size: 10 })).toBe('Pakiet wykorzystany — 1 trening ponad pakiet');
    expect(packageLine(null)).toBeNull();
  });
  it('tytuł przelewu, konto, zgłoszona wpłata', () => {
    expect(transferTitle('Anna Nowak', pay({ month: '2026-11' }))).toBe('Anna Nowak – abonament listopad 2026');
    expect(fmtAccount('12105000001234567890123456')).toBe('12 1050 0000 1234 5678 9012 3456');
    expect(fmtAccount('mBank 123')).toBe('mBank 123');
    const d = { amount: 600, label: 'abonament listopad' };
    expect(reportedAt({ inbox: [{ id: '1', at: '2026-10-30T10:00:00Z', text: 'Zapłacone: 600 zł abonament listopad (BLIK)' }] }, d)).toBe('2026-10-30T10:00:00Z');
    expect(reportedAt({ inbox: [] }, d)).toBeNull();
  });
});

describe('forma zależna od płci', () => {
  it('pole płci, potem imię', () => {
    expect(isFemale({ name: 'Anna Nowak' })).toBe(true);
    expect(isFemale({ name: 'Kuba Lis' })).toBe(false);
    expect(isFemale({ name: 'Anna', sex: 'm' })).toBe(false);
    expect(isFemale({ name: 'Piotr', sex: 'k' })).toBe(true);
    expect(pastForm({ name: 'Julia' }, 'Biegłam', 'Biegłem')).toBe('Biegłam');
  });
});

describe('ankieta „Uzupełnię później”', () => {
  it('pełny ekran najwcześniej po 3 dniach', () => {
    const now = new Date('2026-10-31T12:00:00Z');
    expect(intakeFullDue(null, now)).toBe(true);
    expect(intakeFullDue('2026-10-30T12:00:00.000Z', now)).toBe(false);
    expect(intakeFullDue('2026-10-28T11:00:00.000Z', now)).toBe(true);
    expect(parseLater('1')).toBeNull();
    expect(parseLater('2026-10-30T12:00:00.000Z')).toBe('2026-10-30T12:00:00.000Z');
  });
});

describe('poprawki bez zmian', () => {
  const s: TrainingSession = { id: 's1', clientId: 'c', date: '2026-10-31', workoutName: 'A', charge: 'brak', exercises: [] };
  it('zapis z odtwarzacza = ten sam trening', () => {
    const run = { ...emptyRun('A', '2026-10-31', 0), editSessionId: 's1' };
    expect(isUnchangedEdit(run, s)).toBe(true);
    expect(isUnchangedEdit({ ...run, name: 'B' }, s)).toBe(false);
    expect(isUnchangedEdit({ ...run, editSessionId: undefined }, s)).toBe(false);
    expect(isUnchangedEdit(run, undefined)).toBe(false);
  });
  it('kolejność kluczy nie ma znaczenia', () => {
    expect(stableJson({ b: 1, a: [1, { d: undefined, c: 2 }] })).toBe(stableJson({ a: [1, { c: 2 }], b: 1 }));
  });
  it('zmieniona seria ≠ zapis', () => {
    const saved: TrainingSession = { ...s, exercises: [{ name: 'Przysiad', sets: '1', reps: '8', load: '60', rpe: '', setsLog: [{ load: 60, reps: 8 }] }] };
    const run = sessionToRun(saved, 0);
    run.ex[0].sets[0].load = '65';
    expect(isUnchangedEdit(run, saved)).toBe(false);
  });
});

describe('szybki wpis biegu', () => {
  it('czas mm:ss i h:mm:ss', () => {
    expect(runMinutes('32:15')).toBeCloseTo(32.25);
    expect(runMinutes('1:05:00')).toBe(65);
    expect(runMinutes('45')).toBe(45);
  });
  it('walidacja i zapis', () => {
    const f = { km: '5,2', time: '27:30', effort: '6', hr: '' };
    expect(quickRunProblem(f)).toBeNull();
    expect(quickRunProblem({ ...f, km: '52' })).toMatch(/tempo/);
    expect(quickRunProblem({ ...f, effort: '' })).toMatch(/wysiłek/);
    expect(quickRunProblem({ ...f, hr: '20' })).toMatch(/Tętno/);
    const s = quickRunSession({ ...f, hr: '152' }, { id: 'q', clientId: 'c', date: '2026-10-31', name: 'Bieg' });
    expect(s.solo).toBe(true);
    expect(s.srpe).toBe(6);
    expect(s.duration).toBe(28);
    expect(s.exercises[0]).toMatchObject({ name: 'Bieg', cardio: true });
    expect(s.exercises[0].setsLog![0]).toMatchObject({ reps: 27.5, unit: 'min', dist: 5.2, hr: 152 });
  });
});
