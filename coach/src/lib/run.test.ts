import { describe, expect, it } from 'vitest';
import type { PlanExercise, SetGroup, TrainingSession } from '../domain';
import { buildRunExercise, completeSet, runToExercises, type Run } from './run';

const g = (p: Partial<SetGroup>): SetGroup => ({ type: 'Robocze', sets: '1', reps: '5', load: '', rpe: '8', ...p });
const ex = (groups: SetGroup[], notes = ''): PlanExercise => ({ id: 'e', name: 'Przysiad', rest: '2:00', notes, groups });
// historia: 100 kg × 5 @8 → e1RM 123,3
const hist: TrainingSession[] = [{ id: 's', clientId: 'c', date: '2026-10-01', charge: 'brak', exercises: [{ name: 'Przysiad', sets: '3', reps: '5', load: '100', rpe: '8' }] }];

describe('buildRunExercise', () => {
  it('resolves top set from RPE history and back-offs relative to it', () => {
    const r = buildRunExercise(ex([g({ type: 'Rozgrzewka', load: '50%', rpe: '' }), g({ type: 'Top set', rpe: '8' }), g({ type: 'Back-off', load: '-10%', rpe: '7' }), g({ type: 'Back-off', load: '-10%', rpe: '7' })]), hist);
    expect(r.sets.map((s) => s.load)).toEqual(['62.5', '100', '90', '90']);
    expect(r.sets.map((s) => s.warmup)).toEqual([true, false, false, false]);
    expect(r.sets[1].sug).toBe('dobrane z historii do RPE 8');
    expect(r.sets[2].first).toBe(true);
    expect(r.sets[3].first).toBe(false);
    expect(r.sets[2].gdesc).toBe('Back-off 2 × 5 @7');
  });
  it('drop sets cascade set by set', () => {
    const r = buildRunExercise(ex([g({ load: '100' }), g({ type: 'Drop set', load: '-10%' }), g({ type: 'Drop set', load: '-10%' })]), []);
    expect(r.sets.map((s) => s.load)).toEqual(['100', '90', '80']);
  });
  it('extracts tempo from notes', () => {
    const r = buildRunExercise(ex([g({})], 'Tempo 3-1-X-0, pauza'), []);
    expect(r.tempo).toEqual([3, 1, 1, 0]);
    expect(r.tempoStr).toBe('3-1-X-0');
    expect(r.notes).toBe('pauza');
  });
});

describe('completeSet autoregulation', () => {
  it('same relative block follows actual load', () => {
    const r = buildRunExercise(ex([g({ type: 'Top set', load: '100' }), g({ type: 'Back-off', load: '-10%', rpe: '7' }), g({ type: 'Back-off', load: '-10%', rpe: '7' })]), []);
    let sets = r.sets;
    sets[1] = { ...sets[1], load: '92.5' }; // zawodnik wpisał inny ciężar, ale nie oznaczył edycji
    let res = completeSet({ ...r, sets }, 0);
    expect(res.sets[0].rpe).toBe('8');
    expect(res.sets[1].load).toBe('90');
    expect(res.sets[1].sug).toBe('-10% od poprzedniej serii (100 kg)');
    expect(res.rest).toBe(120);
    sets = res.sets;
    sets[1] = { ...sets[1], load: '95' };
    res = completeSet({ ...r, sets }, 1);
    expect(res.sets[2].load).toBe('95');
  });
  it('empty spec picks load from this set e1RM toward target RPE', () => {
    const r = buildRunExercise(ex([g({ load: '100', rpe: '8' }), g({ load: '', rpe: '8' })]), []);
    const sets = r.sets.map((s) => ({ ...s }));
    sets[0].rpe = '6'; // było lżej niż cel
    const res = completeSet({ ...r, sets }, 0);
    // e1RM = 100 × (1 + 9/30) = 130 → 5 @8 = 130 / (1 + 7/30) = 105.4 → 105
    expect(res.sets[1].load).toBe('105');
    expect(res.sets[1].sug).toBe('+5% vs poprzednia seria (RPE niżej / cel 8)');
  });
  it('manual edits and fixed loads are left alone; undo just unticks', () => {
    const r = buildRunExercise(ex([g({ load: '100' }), g({ load: '' }), g({ load: '110' })]), []);
    const sets = r.sets.map((s) => ({ ...s }));
    sets[1].edited = true;
    sets[1].load = '80';
    let res = completeSet({ ...r, sets }, 0);
    expect(res.sets[1].load).toBe('80');
    res = completeSet({ ...r, sets: res.sets }, 1);
    expect(res.sets[2].load).toBe('110');
    const undo = completeSet({ ...r, sets: res.sets }, 1);
    expect(undo.sets[1].done).toBe(false);
    expect(undo.rest).toBeNull();
  });
  it('warmup completion gives no rest and no autoregulation', () => {
    const r = buildRunExercise(ex([g({ type: 'Rozgrzewka', load: '60', rpe: '' }), g({ load: '' })]), []);
    const res = completeSet(r, 0);
    expect(res.rest).toBeNull();
    expect(res.sets[1].load).toBe('');
  });
});

describe('runToExercises', () => {
  it('keeps only done sets and summarises working sets', () => {
    const e = buildRunExercise(ex([g({ type: 'Rozgrzewka', load: '60', rpe: '' }), g({ load: '100' }), g({ load: '100' })]), []);
    e.sets[0].done = true;
    e.sets[1].done = true;
    e.sets[1].rpe = '8';
    const run: Run = { planId: 'p', workoutId: 'w', name: 'A', planName: '', weekName: '', date: '2026-10-13', startedAt: 0, idx: 0, ex: [e, { ...e, name: 'Nic', sets: e.sets.map((s) => ({ ...s, done: false })) }] };
    const out = runToExercises(run);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: 'Przysiad', sets: '1', reps: '5', load: '100', rpe: '8' });
    expect(out[0].setsLog).toEqual([
      { load: 60, reps: 5, rpe: undefined, warmup: true, label: 'Rozgrzewka' },
      { load: 100, reps: 5, rpe: 8, warmup: undefined, label: 'Robocze' },
    ]);
  });
});

describe('blocks (superseries / circuits)', () => {
  const plain = (name: string, linked = false, rest = '2:00'): PlanExercise => ({ id: name, name, rest, linked, groups: [g({ load: '50' }), g({ load: '50' }), g({ load: '50' })] });
  it('labels single exercises and blocks', async () => {
    const { exerciseLabels } = await import('./plan');
    expect(exerciseLabels([{}, {}, { linked: true }, { linked: true }, {}])).toEqual(['A', 'B1', 'B2', 'B3', 'C']);
    expect(exerciseLabels([{ linked: true }, {}])).toEqual(['A', 'B']);
  });
  it('rest only after the round closes', async () => {
    const { buildRun, blockRest } = await import('./run');
    const run = buildRun({ id: 'p', name: 'P' }, 'T1', { id: 'w', name: 'W', exercises: [plain('Przysiad'), plain('Podciąganie', false, ''), plain('Pompki', true, '90')] }, [], {}, '2026-10-13');
    expect(run.ex.map((e) => e.label)).toEqual(['A', 'B1', 'B2']);
    expect(blockRest(run, 0, 0)).toEqual({ rest: 120 });
    // B1 seria 1 → od razu B2
    expect(blockRest(run, 1, 0)).toEqual({ rest: null, next: 2 });
    run.ex[1].sets[0].done = true;
    run.ex[2].sets[0].done = true;
    // B2 seria 1 zamyka rundę → przerwa z ostatniego ćwiczenia bloku (90 s)
    expect(blockRest(run, 2, 0)).toEqual({ rest: 90 });
  });
});

describe('ad hoc exercises (trainer live session)', () => {
  it('appends to an empty run with labels and focus', async () => {
    const { emptyRun, appendExercise, adHocExercise, runToExercises } = await import('./run');
    let run = emptyRun('Trening', '2026-10-13', 0);
    run = appendExercise(run, adHocExercise('Przysiad', 3, '5', '100'));
    run = appendExercise(run, adHocExercise('Pompki', 2, '12', ''));
    expect(run.ex.map((e) => e.label)).toEqual(['A', 'B']);
    expect(run.idx).toBe(1);
    expect(run.ex[0].sets).toHaveLength(3);
    run.ex[0].sets[0].done = true;
    expect(runToExercises(run)).toEqual([{ name: 'Przysiad', label: 'A', sets: '1', reps: '5', load: '100', rpe: '', rest: '2:00', setsLog: [{ load: 100, reps: 5, rpe: undefined, warmup: undefined, label: undefined }] }]);
  });
});

describe('live layout editing', () => {
  const mk = async () => {
    const { emptyRun, appendExercise, adHocExercise } = await import('./run');
    let run = emptyRun('T', '2026-10-13', 0);
    for (const n of ['Przysiad', 'Podciąganie', 'Pompki', 'Plank']) run = appendExercise(run, adHocExercise(n, 2, '8', ''));
    return run;
  };
  it('links, moves and unlinks into supersets / circuits', async () => {
    const { toggleLink, moveExercise } = await import('./run');
    let run = await mk();
    run = toggleLink(run, 2);
    run = toggleLink(run, 3);
    expect(run.ex.map((e) => e.label)).toEqual(['A', 'B1', 'B2', 'B3']);
    run = toggleLink(run, 2);
    expect(run.ex.map((e) => e.label)).toEqual(['A', 'B', 'C1', 'C2']);
    run = moveExercise(run, 3, -1);
    expect(run.ex.map((e) => e.name)).toEqual(['Przysiad', 'Podciąganie', 'Plank', 'Pompki']);
    expect(run.idx).toBe(2);
  });
  it('removing a block head keeps the rest of the block together', async () => {
    const { toggleLink, removeExercise } = await import('./run');
    let run = await mk();
    run = toggleLink(toggleLink(run, 2), 3); // A, B1 B2 B3
    run = removeExercise(run, 1);
    expect(run.ex.map((e) => `${e.label}:${e.name}`)).toEqual(['A:Przysiad', 'B1:Pompki', 'B2:Plank']);
  });
  it('applies the layout back to the plan, keeping planned sets', async () => {
    const { applyRunLayout, toggleLink, renameExercise } = await import('./run');
    let run = await mk();
    run = toggleLink(run, 3);
    run = renameExercise(run, 3, { rest: '90' });
    const workout = { id: 'w', name: 'W', exercises: [{ id: 'p1', name: 'Przysiad', rest: '3:00', groups: [g({ type: 'Top set', load: '100' })] }] };
    const out = applyRunLayout(workout, run, () => 'new');
    expect(out.exercises.map((e) => [e.name, e.linked ?? false, e.rest])).toEqual([
      ['Przysiad', false, '2:00'],
      ['Podciąganie', false, '2:00'],
      ['Pompki', false, '2:00'],
      ['Plank', true, '90'],
    ]);
    expect(out.exercises[0].id).toBe('p1');
    expect(out.exercises[0].groups[0].type).toBe('Top set');
    expect(out.exercises[1].groups).toHaveLength(2);
  });
});
