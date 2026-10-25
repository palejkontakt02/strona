import { describe, expect, it } from 'vitest';
import type { Checkin, SessionExercise, TrainingSession } from '../domain';
import { milestoneLabel, milestones, monthSummary, monthsRange, shiftMonth } from './progress';
import { musclesOf, muscleTier, normName, setsByMuscle, weeklyMuscleSets, workingSets } from './progressMuscles';
import { changeText, dailyWellness, wellnessChange, wellnessWeeks } from './progressWellness';

const set = (load: number, reps: number, extra: object = {}) => ({ load, reps, done: true, ...extra });
const S = (date: string, exercises: SessionExercise[], extra: Partial<TrainingSession> = {}): TrainingSession => ({ id: date + Math.random(), clientId: 'c', date, charge: 'brak', exercises, ...extra });
const lift = (name: string, sets: ReturnType<typeof set>[]): SessionExercise => ({ name, setsLog: sets });
const run = (km: number, min = 30): SessionExercise => ({ name: 'Bieg ciągły', cardio: true, setsLog: [{ reps: min, dist: km, done: true }] });

describe('musclesOf — słownik po nazwach', () => {
  const p = (n: string) => musclesOf(n).primary;
  it('normalizuje polskie znaki', () => {
    expect(normName('  Wyciskanie ŻOŁNIERSKIE ')).toBe('wyciskanie zolnierskie');
  });
  it('dół ciała', () => {
    expect(p('Przysiad ze sztangą')).toEqual(['czworoglowe', 'posladki']);
    expect(p('Przysiad bułgarski')).toEqual(['czworoglowe', 'posladki']);
    expect(p('Wykroki chodzone')).toEqual(['czworoglowe', 'posladki']);
    expect(p('Martwy ciąg')).toEqual(['posladki', 'dwuglowe', 'plecy']);
    expect(p('Martwy ciąg rumuński')).toEqual(['dwuglowe', 'posladki']);
    expect(p('Single leg RDL')).toEqual(['dwuglowe', 'posladki']);
    expect(p('Hip thrust')).toEqual(['posladki']);
    expect(p('Nordic hamstring')).toEqual(['dwuglowe']);
    expect(p('Uginanie nóg leżąc')).toEqual(['dwuglowe']);
    expect(p('Prostowanie nóg na maszynie')).toEqual(['czworoglowe']);
    expect(p('Wspięcia na palce')).toEqual(['lydki']);
    expect(p('Izometria czworogłowego')).toEqual(['czworoglowe']);
  });
  it('góra ciała', () => {
    expect(p('Wyciskanie sztangi leżąc')).toEqual(['klatka']);
    expect(musclesOf('Wyciskanie sztangi leżąc').secondary).toEqual(['triceps', 'barki']);
    expect(p('Wyciskanie hantli na skosie')).toEqual(['klatka']);
    expect(p('Wyciskanie żołnierskie')).toEqual(['barki']);
    expect(p('OHP')).toEqual(['barki']);
    expect(p('Wyciskanie francuskie')).toEqual(['triceps']);
    expect(p('Prostowanie ramion na wyciągu')).toEqual(['triceps']);
    expect(p('Uginanie ramion z hantlami')).toEqual(['biceps']);
    expect(p('Podciąganie')).toEqual(['plecy']);
    expect(p('Wiosłowanie sztangą')).toEqual(['plecy']);
    expect(p('Pompki')).toEqual(['klatka']);
    expect(p('Face pull')).toEqual(['barki']);
    expect(p('Unoszenie hantli bokiem')).toEqual(['barki']);
    expect(p('Triceps kickback')).toEqual(['triceps']);
  });
  it('core i rzeczy bez serii na mięśnie', () => {
    expect(p('Plank boczny')).toEqual(['brzuch']);
    expect(p('Pallof press')).toEqual(['brzuch']);
    expect(p('Wznosy nóg w zwisie')).toEqual(['brzuch']);
    expect(p('Wioślarz 500 m')).toEqual([]);
    expect(p('Skok na skrzynię')).toEqual([]);
    expect(p('Rower interwały')).toEqual([]);
    expect(p('Coś nieznanego')).toEqual([]);
    expect(p('')).toEqual([]);
  });
  it('angielskie nazwy z atlasu', () => {
    expect(p('Back Squat')).toEqual(['czworoglowe', 'posladki']);
    expect(p('Bench Press')).toEqual(['klatka']);
    expect(p('Romanian Deadlift')).toEqual(['dwuglowe', 'posladki']);
    expect(p('Lat Pulldown')).toEqual(['plecy']);
  });
});

describe('serie na partię', () => {
  it('liczy tylko ukończone serie robocze', () => {
    expect(workingSets(lift('Przysiad', [set(60, 5, { warmup: true }), set(100, 5), set(100, 5, { done: false }), set(100, 5)]))).toBe(2);
    expect(workingSets({ name: 'Przysiad', sets: '3', reps: '5', load: '100' })).toBe(3);
    expect(workingSets(run(5))).toBe(0);
  });
  it('główne × 1, pomocnicze × ½', () => {
    const r = setsByMuscle([S('2026-10-20', [lift('Wyciskanie sztangi leżąc', [set(80, 5), set(80, 5)])])]);
    expect(r.klatka).toBe(2);
    expect(r.triceps).toBe(1);
    expect(r.barki).toBe(1);
    expect(r.plecy).toBe(0);
  });
  it('bieżący i poprzedni tydzień', () => {
    const sessions = [
      S('2026-10-19', [lift('Podciąganie', [set(0, 5), set(0, 5), set(0, 5)])]), // pn bieżącego
      S('2026-10-14', [lift('Podciąganie', [set(0, 5)])]), // poprzedni
      S('2026-10-05', [lift('Podciąganie', [set(0, 5)])]), // starszy — pomijany
    ];
    const rows = weeklyMuscleSets(sessions, '2026-10-22');
    const plecy = rows.find((r) => r.muscle === 'plecy')!;
    expect(plecy).toMatchObject({ now: 3, prev: 1, label: 'Plecy' });
    expect(rows).toHaveLength(10);
  });
  it('odcień sylwetki', () => {
    expect([0, 0.5, 9.5, 10, 20].map(muscleTier)).toEqual([0, 1, 1, 2, 2]);
  });
});

describe('trend samopoczucia', () => {
  const ci = (date: string, v: number, extra: object = {}): Checkin => ({ date, sleep: v, energy: v, muscle: v, stress: v, mood: v, ...extra });
  it('check-in ma pierwszeństwo przed wellness z treningu', () => {
    const d = dailyWellness([ci('2026-10-20', 4)], [S('2026-10-20', [], { wellness: { sleep: 1 } }), S('2026-10-21', [], { wellness: { sleep: 2 } })]);
    expect(d.get('2026-10-20')?.sleep).toBe(4);
    expect(d.get('2026-10-21')?.sleep).toBe(2);
  });
  it('średnie tygodniowe, od najstarszego', () => {
    const d = dailyWellness([ci('2026-10-19', 2), ci('2026-10-21', 4), ci('2026-10-13', 3)], []);
    const w = wellnessWeeks(d, '2026-10-22', 4);
    expect(w.map((x) => x.week)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']);
    expect(w[3].avg.sleep).toBe(3);
    expect(w[3].days).toBe(2);
    expect(w[2].avg.sleep).toBe(3);
    expect(w[0].avg.sleep).toBeNull();
  });
  it('zmiana słowami vs 2 tygodnie temu', () => {
    const d = dailyWellness([ci('2026-10-21', 4, { stress: 2 }), ci('2026-10-06', 3)], []);
    const s = wellnessChange(d, 'sleep', '2026-10-22')!;
    expect(s.trend).toBe('better');
    expect(s.text).toBe('sen lepszy niż 2 tyg. temu');
    const st = wellnessChange(d, 'stress', '2026-10-22')!;
    expect(st).toMatchObject({ trend: 'worse', attention: true, text: 'więcej stresu niż 2 tyg. temu' });
    expect(changeText('energy', 'same')).toBe('energia podobna jak 2 tyg. temu');
    expect(wellnessChange(dailyWellness([ci('2026-10-21', 4)], []), 'sleep', '2026-10-22')).toBeNull();
  });
});

describe('podsumowanie miesiąca', () => {
  const sessions = [
    S('2026-09-10', [lift('Przysiad', [set(100, 5)])]),
    S('2026-10-02', [lift('Przysiad', [set(105, 5)]), run(5)]),
    S('2026-10-20', [lift('Przysiad', [set(110, 5), set(100, 5)])]),
    S('2026-10-21', [{ name: 'Rower', cardio: true, setsLog: [{ reps: 30, dist: 15 }] }]),
  ];
  it('miesiące', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(monthsRange(sessions, '2026-10-25')).toEqual(['2026-09', '2026-10']);
    expect(monthsRange([], '2026-10-25')).toEqual(['2026-10']);
  });
  it('liczby i rekordy miesiąca', () => {
    const m = monthSummary(sessions, '2026-10');
    expect(m.sessions).toBe(3);
    expect(m.tonnage).toBe(105 * 5 + 110 * 5 + 100 * 5);
    expect(m.km).toBe(5); // rower się nie liczy
    expect(m.records).toHaveLength(1);
    expect(m.records[0].name).toBe('Przysiad');
    expect(m.records[0].gain).toBeCloseTo(110 * (1 + 5 / 30) - 100 * (1 + 5 / 30), 5);
    const sep = monthSummary(sessions, '2026-09');
    expect(sep).toMatchObject({ sessions: 1, tonnage: 500, km: 0, records: [] });
  });
});

describe('kamienie milowe', () => {
  it('etykiety z odmianą', () => {
    expect(milestoneLabel('sessions', 50)).toBe('50 treningów');
    expect(milestoneLabel('sessions', 25)).toBe('25 treningów');
    expect(milestoneLabel('streak', 4)).toBe('4 tygodnie z rzędu');
    expect(milestoneLabel('streak', 12)).toBe('12 tygodni z rzędu');
    expect(milestoneLabel('tonnage', 10)).toBe('10 t podniesione łącznie');
    expect(milestoneLabel('km', 100)).toBe('100 km');
  });
  it('osiągnięte z datą i następny z postępem', () => {
    // 12 tygodni po 1 treningu (pn), 1000 kg na trening, 5 km co trening
    const sessions: TrainingSession[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(2026, 7, 3 + 7 * i)).toISOString().slice(0, 10);
      sessions.push(S(d, [lift('Przysiad', [set(100, 10)]), run(5)]));
    }
    const m = milestones(sessions, '2026-10-25');
    const by = (label: string) => m.achieved.find((a) => a.label === label);
    expect(by('10 treningów')?.date).toBe(sessions[9].date);
    expect(by('1 t podniesione łącznie')?.date).toBe(sessions[0].date);
    expect(by('10 t podniesione łącznie')?.date).toBe(sessions[9].date);
    expect(by('50 km')?.date).toBe(sessions[9].date);
    expect(by('4 tygodnie z rzędu')?.date).toBe(sessions[3].date);
    expect(by('12 tygodni z rzędu')?.date).toBe(sessions[11].date);
    expect(m.achieved[0].date >= m.achieved[m.achieved.length - 1].date).toBe(true);
    const next = Object.fromEntries(m.next.map((n) => [n.kind, n]));
    expect(next.sessions).toMatchObject({ target: 25, value: 12 });
    expect(next.tonnage).toMatchObject({ target: 25, value: 12 });
    expect(next.km).toMatchObject({ target: 100, value: 60 });
    expect(next.streak).toMatchObject({ target: 16, value: 12 });
  });
  it('przerwa zeruje serię tygodni; bez biegania brak km', () => {
    const sessions = ['2026-09-07', '2026-09-14', '2026-09-28', '2026-10-05'].map((d) => S(d, [lift('Przysiad', [set(100, 5)])]));
    const m = milestones(sessions, '2026-10-06');
    expect(m.achieved.some((a) => a.kind === 'streak')).toBe(false);
    expect(m.next.find((n) => n.kind === 'streak')).toMatchObject({ value: 2, target: 4 });
    expect(m.next.some((n) => n.kind === 'km')).toBe(false);
    expect(milestones([], '2026-10-06').next).toEqual([{ kind: 'sessions', target: 10, label: '10 treningów', value: 0 }]);
  });
});
