import { describe, expect, it } from 'vitest';
import type { PlanWorkout, TrainingSession } from '../domain';
import { fmtTon, isAsym, matchesFilter, painTone, planCoverage, planWorkoutSummary, repsLabel, runRowText, stoppedLabel } from './sessionBadges';

const sess = (p: Partial<TrainingSession>): TrainingSession => ({ id: 's', clientId: 'c', date: '2026-10-20', charge: 'brak', exercises: [], ...p });

describe('sessionBadges', () => {
  it('próg bólu: bursztyn 4–5, czerwony od 6', () => {
    expect([undefined, 0, 3, 4, 5, 6, 10].map((v) => painTone(v))).toEqual(['muted', 'muted', 'muted', 'warn', 'warn', 'danger', 'danger']);
  });
  it('tonaż w tonach z twardą spacją', () => {
    expect(fmtTon(7063)).toBe('7,1 t');
    expect(fmtTon(850)).toBe('0,9 t');
  });
  it('przerwany: poziom i najmocniejsze miejsce', () => {
    const s = sess({ stoppedForPain: { level: 7, spots: [{ area: 'odcinek lędźwiowy', level: 4 }, { area: 'kolano', side: 'P', level: 7 }] } });
    expect(stoppedLabel(s)).toBe('przerwany — ból 7/10 · kolano P');
    expect(stoppedLabel(sess({ stoppedForPain: { level: 5 } }))).toBe('przerwany — ból 5/10');
    expect(stoppedLabel(sess({}))).toBeNull();
  });
  it('serie jednolicie: L/P, na stronę, na czas', () => {
    expect(repsLabel({ reps: 5, repsR: 5 })).toBe('5/5 L/P');
    expect(repsLabel({ reps: 8 }, true)).toBe('8/str.');
    expect(repsLabel({ reps: 90, unit: 's' }, true)).toBe('1:30/str.');
    expect(repsLabel({ reps: 45, unit: 's' })).toBe('45 s');
    expect(repsLabel({ reps: 15, repsR: 10, unit: 's' }, true)).toBe('15/10 s L/P');
    expect(repsLabel({ reps: 90, repsR: 80, unit: 's' })).toBe('1:30/1:20 L/P');
    expect(isAsym({ reps: 3, repsR: 5 })).toBe(true);
    expect(isAsym({ reps: 5, repsR: 5 })).toBe(false);
  });
  it('bieg w wierszu: km i tempo', () => {
    const s = sess({ exercises: [{ name: 'Bieg', cardio: true, setsLog: [{ reps: 46.8, dist: 9 }] }] });
    expect(runRowText(s)).toBe('9,0 km · 5:12/km');
    expect(runRowText(sess({ exercises: [{ name: 'Przysiad', setsLog: [{ reps: 5, load: 100 }] }] }))).toBeNull();
  });
  it('pominięte ćwiczenia z planu', () => {
    const w: PlanWorkout = { id: 'w', name: 'A', exercises: ['Przysiad', 'Wyciskanie', 'Wiosłowanie'].map((name, i) => ({ id: String(i), name, groups: [] })) };
    const s = sess({ exercises: [{ name: 'Przysiad', setsLog: [{ reps: 5 }] }, { name: 'Wyciskanie', setsLog: [] }] });
    expect(planCoverage(s, w)).toEqual({ done: 1, total: 3 });
    const all = sess({ exercises: w.exercises.map((e) => ({ name: e.name, sets: '3' })) });
    expect(planCoverage(all, w)).toBeNull();
  });
  it('opis jednostki biegowej z planu', () => {
    const w: PlanWorkout = {
      id: 'w',
      name: 'Interwały',
      exercises: [{ id: 'e', name: 'Bieg', cardio: true, groups: [
        { type: 'Rozgrzewka', sets: '1', reps: '15', load: '', rpe: '' },
        { type: 'Robocze', sets: '6', reps: '', load: '800 m', rpe: '', pace: 'Z5', rest: '2:00' },
      ] }],
    };
    const t = planWorkoutSummary(w, { t5k: '25:00' });
    expect(t).toMatch(/^6 × 800 m Z5 · ~/);
    expect(t).toMatch(/km · ~\d+ min$/);
    expect(planWorkoutSummary({ id: 'x', name: 'S', exercises: [{ id: '1', name: 'Przysiad', groups: [] }, { id: '2', name: 'Martwy ciąg', groups: [] }] })).toBe('2 ćwiczenia');
  });
  it('filtry', () => {
    const s = sess({ pain: 5 });
    expect(matchesFilter(s, 'pain', false)).toBe(true);
    expect(matchesFilter(s, 'stopped', false)).toBe(false);
    expect(matchesFilter(s, 'solo', true)).toBe(true);
    expect(matchesFilter(s, 'coach', true)).toBe(false);
    expect(matchesFilter(sess({ exercises: [{ name: 'x', setsLog: [{ reps: 1, video: 'idb:1' }] }] }), 'video', false)).toBe(true);
  });
});
