import { describe, expect, it } from 'vitest';
import { flashText, nextSetInfo, speechText } from './announce';
import type { Run, RunExercise, RunSet } from './run';

const set = (load: string, reps: string, extra: Partial<RunSet> = {}): RunSet => ({ load, reps, rpe: '', done: false, warmup: false, sug: '', edited: false, tRpe: '', spec: '', rest: '', ...extra });
const ex = (name: string, sets: RunSet[], extra: Partial<RunExercise> = {}): RunExercise => ({ name, rest: '', tempo: null, tempoStr: '', notes: '', sets, ...extra });
const run = (exs: RunExercise[], idx = 0): Run => ({ planId: '', workoutId: '', name: 'T', planName: '', weekName: '', date: '2026-10-26', startedAt: 0, idx, ex: exs });

describe('zapowiedź następnej serii', () => {
  const r = run([
    ex('Przysiad ze sztangą', [set('40', '5', { warmup: true, done: true }), set('60', '8', { done: true }), set('60', '8', { done: true }), set('62,5', '8')]),
    ex('Deska', [set('', '30', { unit: 's' })]),
  ]);
  it('pierwsza niezaliczona w bieżącym bloku; numer bez rozgrzewki', () => {
    const x = nextSetInfo(r)!;
    expect([x.k, x.i, x.n, x.load]).toEqual([0, 3, 3, 62.5]);
    expect(flashText(x)).toBe('Seria 3 — przysiad ze sztangą 62,5 kg × 8');
    expect(speechText(x)).toBe('Następna seria: przysiad ze sztangą, 62,5 kilograma, 8 powtórzeń');
  });
  it('blok zrobiony — kolejny; seria na czas', () => {
    const done = structuredClone(r);
    done.ex[0].sets[3].done = true;
    const x = nextSetInfo(done)!;
    expect(flashText(x)).toBe('Seria 1 — deska 30 s');
    expect(speechText(x)).toBe('Następna seria: deska, 30 sekund');
    done.ex[1].sets[0].done = true;
    expect(nextSetInfo(done)).toBeNull();
  });
  it('wskazana seria (obwód), odmiana liczebników, skrót nazwy z wielkiej litery', () => {
    const x = nextSetInfo(r, { k: 1, i: 0 })!;
    expect(x.name).toBe('Deska');
    expect(speechText({ k: 0, i: 0, n: 1, name: 'RDL', load: 2, reps: '1', cardio: false })).toBe('Następna seria: RDL, 2 kilogramy, 1 powtórzenie');
    expect(speechText({ k: 0, i: 0, n: null, name: 'Wiosłowanie', load: 22, reps: '10/10' })).toBe('Rozgrzewka: wiosłowanie, 22 kilogramy, 10 powtórzeń na stronę');
  });
});
