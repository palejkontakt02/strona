import type { PlanExercise, PlanWorkout, SetType, TrainingSession } from '../domain';
import { num, parseRest, parseTempo, repsN } from './parse';
import { exerciseBlocks, exerciseLabels, mergeGroups } from './plan';
import { e1rmRPE, e1Series, loadFor, resolveLoad } from './strength';

/** Seria w trakcie treningu (tryb zawodnika). Pola tekstowe — to wartości z inputów. */
export interface RunSet {
  load: string;
  reps: string;
  rpe: string;
  done: boolean;
  warmup: boolean;
  /** Podpowiedź doboru ciężaru. */
  sug: string;
  /** Zawodnik ręcznie zmienił ciężar — autoregulacja go nie nadpisuje. */
  edited: boolean;
  /** Typ serii z planu i numer bloku (scalonych identycznych wierszy). */
  label?: SetType;
  gi?: number;
  first?: boolean;
  /** Opis bloku do nagłówka, np. „Back-off 3 × 5 @7”. */
  gdesc?: string;
  /** Docelowe RPE i zapis ciężaru z planu. */
  tRpe: string;
  spec: string;
  rest: string;
}

export interface RunExercise {
  name: string;
  /** Oznaczenie z planu: „A” albo „B2” w bloku. */
  label?: string;
  /** Połączone z poprzednim w blok (superseria / obwód). */
  linked?: boolean;
  rest: string;
  tempo: [number, number, number, number] | null;
  tempoStr: string;
  notes: string;
  video?: string;
  sets: RunSet[];
}

export interface Run {
  planId: string;
  workoutId: string;
  name: string;
  planName: string;
  weekName: string;
  date: string;
  startedAt: number;
  idx: number;
  ex: RunExercise[];
}

const TEMPO_RE = /[0-9xX]\s*-\s*[0-9xX]\s*-\s*[0-9xX]\s*-\s*[0-9xX]/;

/** Ostatnie e1RM ćwiczenia z historii (jak w prototypie: ostatni punkt przebiegu). */
function lastE1(history: TrainingSession[], name: string): number | null {
  const s = e1Series(history, name);
  return s.length ? s[s.length - 1].y : null;
}

/**
 * Serie do wykonania dla ćwiczenia z planu: bloki scalonych wierszy, ciężar rozwiązywany
 * wg zapisu (kg / % e1RM / ±% od poprzedniego bloku / z RPE). Back-off/Robocze liczone
 * od ostatniej serii poprzedniego bloku; Drop set kaskadowo seria po serii.
 */
export function buildRunExercise(e: PlanExercise, history: TrainingSession[], video?: string): RunExercise {
  const e1 = lastE1(history, e.name);
  const sets: RunSet[] = [];
  let prev: number | null = null;
  mergeGroups(e.groups).forEach((g, gi) => {
    const cnt = repsN(g.sets) || 1;
    const range = /\d\s*[-–]\s*\d/.test(String(g.sets || ''));
    const ref = prev;
    for (let i = 0; i < cnt; i++) {
      const rl = resolveLoad(g.load, e1, g.reps, g.rpe, g.type === 'Drop set' ? prev : ref);
      if (rl.load != null) prev = rl.load;
      sets.push({
        load: rl.load != null ? String(rl.load) : '',
        reps: String(repsN(g.reps) || ''),
        rpe: '',
        done: false,
        warmup: g.type === 'Rozgrzewka',
        sug: i === 0 ? rl.why : '',
        edited: false,
        label: g.type,
        gi,
        first: i === 0,
        gdesc: `${g.type} ${g.sets || ''} × ${g.reps || ''}${g.rpe ? ' @' + g.rpe : ''}${range ? ` · dokładaj serie, dopóki RPE ≤ ${g.rpe || 'cel'}` : ''}`,
        tRpe: g.rpe || '',
        spec: g.load || '',
        rest: g.rest || '',
      });
    }
  });
  const notes = String(e.notes || '');
  return {
    name: e.name,
    linked: e.linked || undefined,
    rest: e.rest || '',
    tempo: parseTempo(notes),
    tempoStr: (notes.match(TEMPO_RE)?.[0] ?? '').replace(/\s/g, ''),
    notes: notes.replace(/tempo/i, '').replace(TEMPO_RE, '').replace(/^[\s,;·-]+|[\s,;·-]+$/g, ''),
    video,
    sets,
  };
}

export function buildRun(
  plan: { id: string; name: string },
  weekName: string,
  workout: PlanWorkout,
  history: TrainingSession[],
  videos: Record<string, string | undefined>,
  today: string,
  now = Date.now(),
): Run {
  return {
    planId: plan.id,
    workoutId: workout.id,
    name: workout.name || 'Trening',
    planName: plan.name,
    weekName,
    date: today,
    startedAt: now,
    idx: 0,
    ex: withLabels(workout.exercises.filter((e) => e.name).map((e) => buildRunExercise(e, history, videos[e.name]))),
  };
}

/** Nowe ćwiczenie dodane w trakcie treningu (poza planem). */
export function adHocExercise(name: string, sets: number, reps: string, load: string, rest = '2:00'): RunExercise {
  return {
    name,
    rest,
    tempo: null,
    tempoStr: '',
    notes: '',
    sets: Array.from({ length: Math.max(1, sets) }, () => ({
      load,
      reps,
      rpe: '',
      done: false,
      warmup: false,
      sug: '',
      edited: !!load,
      tRpe: '',
      spec: load,
      rest: '',
    })),
  };
}

/** Pusty trening (bez planu) — ćwiczenia dodaje się w trakcie. */
export function emptyRun(name: string, today: string, now = Date.now()): Run {
  return { planId: '', workoutId: '', name, planName: '', weekName: '', date: today, startedAt: now, idx: 0, ex: [] };
}

/** Dodaje ćwiczenie na końcu treningu i przelicza oznaczenia (A, B, C1…). */
export function appendExercise(run: Run, e: RunExercise): Run {
  return { ...run, ex: withLabels([...run.ex, e]), idx: run.ex.length };
}

function withLabels(ex: RunExercise[]): RunExercise[] {
  const labels = exerciseLabels(ex);
  return ex.map((e, i) => ({ ...e, label: labels[i] }));
}

/** Bloki biegu (indeksy ćwiczeń); pojedyncze ćwiczenie to blok jednoelementowy. */
export function runBlocks(run: Run): number[][] {
  return exerciseBlocks(run.ex);
}

/** Numer serii roboczej (bez rozgrzewek) w ćwiczeniu. */
function workIndex(e: RunExercise, setIdx: number): number {
  return e.sets.slice(0, setIdx).filter((s) => !s.warmup).length;
}

/**
 * Po zaliczeniu serii w bloku (superseria / obwód): jeśli w tej rundzie zostało jeszcze inne
 * ćwiczenie bloku — przejście bez pełnej przerwy (czas przejścia = przerwa tego ćwiczenia, puste = od razu)
 * i wskazanie następnego; gdy runda zamknięta — przerwa z ostatniego ćwiczenia bloku (domyślnie 120 s).
 */
export function blockRest(run: Run, exIdx: number, setIdx: number): { rest: number | null; next?: number } {
  const block = runBlocks(run).find((b) => b.includes(exIdx)) ?? [exIdx];
  const e = run.ex[exIdx];
  if (e.sets[setIdx]?.warmup) return { rest: null };
  if (block.length === 1) return { rest: parseRest(e.sets[setIdx]?.rest || e.rest) || 120 };
  const w = workIndex(e, setIdx);
  const pos = block.indexOf(exIdx);
  const order = [...block.slice(pos + 1), ...block.slice(0, pos)];
  const next = order.find((k) => {
    const sets = run.ex[k].sets.filter((s) => !s.warmup);
    return sets[w] && !sets[w].done;
  });
  if (next != null) {
    const t = parseRest(e.rest);
    return { rest: t > 0 && pos < block.length - 1 ? t : null, next };
  }
  return { rest: parseRest(run.ex[block[block.length - 1]].rest) || 120 };
}

/**
 * Zaliczenie serii `i` (lub cofnięcie). Zwraca nowe serie i czas przerwy (s) do odliczenia.
 * Autoregulacja następnej niezaliczonej serii roboczej (jeśli nie edytowana ręcznie):
 * - względna (±%) w tym samym bloku (nie Drop set) → ten sam ciężar, co faktycznie wykonany,
 * - względna z innego bloku / Drop set → przelicz od faktycznego ciężaru,
 * - stała (kg / %) → bez zmian,
 * - pusta → dobór z e1RM tej serii do docelowego RPE, z podpowiedzią „±X% vs poprzednia seria”.
 */
export function completeSet(ex: RunExercise, i: number): { sets: RunSet[]; rest: number | null } {
  const sets = ex.sets.map((x) => ({ ...x }));
  const s = sets[i];
  if (s.done) {
    s.done = false;
    return { sets, rest: null };
  }
  const myR = s.tRpe;
  s.done = true;
  if (!s.rpe && myR && !s.warmup) s.rpe = myR;
  if (s.warmup) return { sets, rest: null };

  const e1 = e1rmRPE(s.load, s.reps, s.rpe || myR || 8);
  const j = sets.findIndex((x, k) => k > i && !x.done && !x.warmup);
  if (j > -1 && !sets[j].edited) {
    const nxt = sets[j];
    const spec = nxt.spec;
    const prev = num(s.load);
    if (/^[+-]\s*\d/.test(spec) && prev && nxt.gi === s.gi && nxt.label !== 'Drop set') {
      nxt.load = s.load;
      nxt.sug = '';
    } else if (/^[+-]\s*\d/.test(spec) && prev) {
      const rl = resolveLoad(spec, e1, nxt.reps, nxt.tRpe, prev);
      nxt.load = String(rl.load);
      nxt.sug = `${rl.why} (${String(prev).replace('.', ',')} kg)`;
    } else if (spec && (num(spec) != null || /%/.test(spec))) {
      // stały ciężar z planu — bez zmian
    } else if (e1) {
      const tr = nxt.tRpe || s.rpe || '8';
      const nl = loadFor(e1, nxt.reps || s.reps, tr);
      const base = prev || nl;
      const diff = base ? Math.round(((nl - base) / base) * 100) : 0;
      nxt.load = String(nl);
      const cmp = num(s.rpe)! < num(tr)! ? 'niżej' : num(s.rpe)! > num(tr)! ? 'wyżej' : 'zgodne';
      nxt.sug = diff === 0 ? 'Utrzymaj ciężar – RPE zgodne z celem' : `${diff > 0 ? '+' : ''}${diff}% vs poprzednia seria (RPE ${cmp} / cel ${tr})`;
    }
  }
  return { sets, rest: parseRest(s.rest || ex.rest) || 120 };
}

/** Zamienia serie z biegu na zapis treningu (`setsLog`) + podsumowanie. */
export function runToExercises(run: Run) {
  return run.ex.map((e) => {
    const log = e.sets
      .filter((s) => s.done)
      .map((s) => ({ load: num(s.load) ?? undefined, reps: num(s.reps) ?? undefined, rpe: num(s.rpe) ?? undefined, warmup: s.warmup || undefined, label: s.label }));
    const work = log.filter((s) => !s.warmup);
    const top = work[0];
    return {
      name: e.name,
      label: e.label,
      sets: String(work.length),
      reps: top?.reps != null ? String(top.reps) : '',
      load: top?.load != null ? String(top.load) : '',
      rpe: top?.rpe != null ? String(top.rpe) : '',
      rest: e.rest || undefined,
      setsLog: log,
    };
  }).filter((e) => e.setsLog.length > 0);
}
