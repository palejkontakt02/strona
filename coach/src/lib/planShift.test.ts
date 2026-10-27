import { describe, expect, it } from 'vitest';
import type { Plan } from '../domain';
import { absenceShift, nextBlock, nextBlockName, planEnd, shiftPlanFrom, shiftPreview } from './planShift';
import { workoutDate } from './plan';

const wk = (n: number, days: number[]) => ({ id: `w${n}`, name: `Tydzień ${n}`, workouts: days.map((d, i) => ({ id: `w${n}k${i}`, name: `Trening ${'AB'[i]}`, day: d, exercises: [] })) });
// start czw. 22.10.2026 → tydzień 1 = 19.10–25.10
const plan = (): Plan => ({ id: 'p', clientId: 'c', name: 'Siła', startDate: '2026-10-22', active: true, weeks: [wk(1, [1, 4]), wk(2, [1, 4]), wk(3, [1, 4]), wk(4, [1, 4])] });
const dates = (p: Plan) => p.weeks.flatMap((w, wi) => w.workouts.map((k) => workoutDate(p, wi, k)));

describe('shiftPlanFrom', () => {
  it('przesuwa od wybranej daty, wcześniejsze zostają', () => {
    const p = plan();
    const s = shiftPlanFrom(p, '2026-11-02', 7);
    expect(dates(s)).toEqual(['2026-10-19', '2026-10-22', '2026-10-26', '2026-10-29', '2026-11-09', '2026-11-12', '2026-11-16', '2026-11-19']);
    // oryginał bez zmian
    expect(dates(p)[4]).toBe('2026-11-02');
  });
  it('w środku tygodnia — przesuwa tylko jednostki od tej daty', () => {
    const s = shiftPlanFrom(plan(), '2026-10-29', 3);
    expect(dates(s).slice(2)).toEqual(['2026-10-26', '2026-11-01', '2026-11-05', '2026-11-08', '2026-11-12', '2026-11-15']);
    // dzień tygodnia zgodny z nową datą
    expect(s.weeks[1].workouts[1].day).toBe(7);
  });
  it('cały plan o pełne tygodnie — zmienia tylko start, dni tygodnia zostają', () => {
    const s = shiftPlanFrom(plan(), '2026-01-01', 14);
    expect(s.startDate).toBe('2026-11-05');
    expect(s.weeks[0].workouts[0].date).toBeUndefined();
    expect(dates(s)[0]).toBe('2026-11-02');
  });
  it('wpisane daty też się przesuwają; 0 dni i brak jednostek po dacie — bez zmian', () => {
    const p = plan();
    p.weeks[3].workouts[1] = { ...p.weeks[3].workouts[1], day: undefined, date: '2026-11-14' };
    expect(shiftPlanFrom(p, '2026-11-13', 7).weeks[3].workouts[1].date).toBe('2026-11-21');
    expect(shiftPlanFrom(p, '2026-11-13', 0)).toEqual(p);
    expect(shiftPlanFrom(p, '2027-01-01', 7)).toEqual(p);
  });
});

describe('shiftPreview', () => {
  it('tydzień po tygodniu, od pierwszej przesuwanej daty', () => {
    const r = shiftPreview(plan(), '2026-10-29', 7);
    expect(r[0]).toEqual({ week: 'Tydzień 2', from: '2026-10-29', to: '2026-11-05', count: 1 });
    expect(r.map((x) => x.week)).toEqual(['Tydzień 2', 'Tydzień 3', 'Tydzień 4']);
  });
});

describe('nextBlock', () => {
  it('start od poniedziałku po końcu oryginału, nazwa „— blok 2”, nieaktywny, nowe id', () => {
    const p = plan();
    expect(planEnd(p)).toBe('2026-11-12');
    const b = nextBlock(p);
    expect(b.startDate).toBe('2026-11-16');
    expect(b.name).toBe('Siła — blok 2');
    expect(b.active).toBe(false);
    expect(b.id).not.toBe(p.id);
    expect(b.weeks[0].workouts[0].id).not.toBe(p.weeks[0].workouts[0].id);
    expect(dates(b)[0]).toBe('2026-11-16');
  });
  it('kolejne numery bloków', () => {
    expect(nextBlockName('S&C — blok 2')).toBe('S&C — blok 3');
    expect(nextBlockName('Siła (kopia)')).toBe('Siła — blok 2');
  });
});

describe('absenceShift', () => {
  it('nieobecność na treningach → przesunięcie o pełne tygodnie', () => {
    const r = absenceShift(plan(), [{ from: '2026-11-01', to: '2026-11-07', reason: 'urlop' }], '2026-10-26');
    expect(r).toMatchObject({ from: '2026-11-01', days: 7 });
    expect(absenceShift(plan(), [{ from: '2026-11-01', to: '2026-11-10' }], '2026-10-26')?.days).toBe(14);
  });
  it('miniona albo bez treningów — brak propozycji', () => {
    expect(absenceShift(plan(), [{ from: '2026-10-01', to: '2026-10-07' }], '2026-10-26')).toBeNull();
    expect(absenceShift(plan(), [{ from: '2027-01-01', to: '2027-01-07' }], '2026-10-26')).toBeNull();
    expect(absenceShift(plan(), undefined, '2026-10-26')).toBeNull();
  });
});
