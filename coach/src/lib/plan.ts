import type { Plan, PlanWeek, PlanWorkout, SetGroup, TrainingSession } from '../domain';
import { repsN } from './parse';

const groupKey = (g: SetGroup) => [g.type, g.reps, g.load, g.rpe, g.rest || '', g.pace || ''].join('|');
const isRange = (s: string | undefined) => /[-–]/.test(String(s || ''));

/** Łączy kolejne identyczne wiersze (type, reps, load, rpe, rest) w jeden blok z liczbą serii. Zakresy („3–4”) nie są łączone. */
export function mergeGroups(groups: SetGroup[]): SetGroup[] {
  const out: SetGroup[] = [];
  for (const g of groups) {
    const last = out[out.length - 1];
    if (last && groupKey(last) === groupKey(g) && !isRange(g.sets) && !isRange(last.sets)) {
      last.sets = String((repsN(last.sets) || 1) + (repsN(g.sets) || 1));
    } else {
      out.push({ ...g, sets: String(g.sets || 1) });
    }
  }
  return out;
}

/** Każda seria osobno: wiersz „3 serie × 5” zamienia się w trzy wiersze po jednej serii. */
export function expandSets(groups: SetGroup[]): SetGroup[] {
  return groups.flatMap((g) => Array.from({ length: Math.min(20, Math.max(1, repsN(g.sets) ?? 1)) }, () => ({ ...g, sets: '1' })));
}

/** „3 serie + 1 rozgrz.” */
export function setCountLabel(groups: SetGroup[]): string {
  const w = groups.filter((g) => g.type === 'Rozgrzewka').length;
  const r = groups.length - w;
  const pl = (n: number) => (n === 1 ? 'seria' : n >= 2 && n <= 4 ? 'serie' : 'serii');
  return `${r} ${pl(r)}${w ? ` + ${w} rozgrz.` : ''}`;
}

export interface PlanStep {
  week: PlanWeek;
  workout: PlanWorkout;
  index: number;
}

/** Jednostki planu w kolejności tydzień → jednostka. */
export function planSequence(plan: Plan): PlanStep[] {
  const out: PlanStep[] = [];
  for (const week of plan.weeks) for (const workout of week.workouts) out.push({ week, workout, index: out.length });
  return out;
}

/** Plan zawodnika: aktywny, w przeciwnym razie najnowszy. */
export function currentPlan(plans: Plan[]): Plan | null {
  return (
    plans.find((p) => p.active) ||
    [...plans].sort((a, b) => (b.updatedAt || b.startDate || '').localeCompare(a.updatedAt || a.startDate || ''))[0] ||
    null
  );
}

/**
 * Następny trening: jednostka po ostatnio wykonanej z tego planu (wg daty, w kolejności
 * tydzień → jednostka), cyklicznie — po ostatniej wraca do pierwszej. Bez historii — pierwsza.
 */
export function nextWorkout(plan: Plan | null, sessions: TrainingSession[]): (PlanStep & { total: number }) | null {
  if (!plan) return null;
  const seq = planSequence(plan);
  if (seq.length === 0) return null;
  const pos = new Map(seq.map((x, i) => [x.workout.id, i]));
  let last: { date: string; i: number } | null = null;
  for (const s of sessions) {
    if (s.planId !== plan.id || !s.workoutId || !pos.has(s.workoutId)) continue;
    const i = pos.get(s.workoutId)!;
    if (!last || s.date > last.date || (s.date === last.date && i > last.i)) last = { date: s.date, i };
  }
  const nx = seq[last ? (last.i + 1) % seq.length : 0];
  return { ...nx, total: seq.length };
}

/** Jednostki zrobione w bieżącym przejściu planu (przed „następną”) — dalsze to poprzednie przejście. */
export function doneInPass(plan: Plan | null, sessions: TrainingSession[]): Set<string> {
  const out = new Set<string>();
  if (!plan) return out;
  const nx = nextWorkout(plan, sessions);
  const seq = planSequence(plan).map((x) => x.workout.id);
  const ni = nx ? seq.indexOf(nx.workout.id) : -1;
  for (const s of sessions) {
    if (s.planId !== plan.id || !s.workoutId) continue;
    const i = seq.indexOf(s.workoutId);
    if (i >= 0 && (ni < 0 || i < ni)) out.add(s.workoutId);
  }
  return out;
}

/** Podsumowanie ćwiczenia z serii (zgodność z widokami listy): liczba serii roboczych i parametry pierwszej. */
export function exerciseSummary(groups: SetGroup[]): { sets: string; reps: string; rpe: string; load: string } {
  const work = groups.filter((g) => g.type !== 'Rozgrzewka');
  const top = work[0];
  return {
    sets: String(work.reduce((a, g) => a + (repsN(g.sets) || 1), 0)),
    reps: top?.reps || '',
    rpe: top?.rpe || '',
    load: top && top.load && !/%/.test(top.load) && !Number.isNaN(parseFloat(top.load)) ? top.load : '',
  };
}

/**
 * Oznaczenia ćwiczeń: pojedyncze „A”, „B”…; połączone w blok (superseria / obwód) „C1”, „C2”, „C3”.
 * Ćwiczenie z `linked` dołącza do bloku poprzedniego.
 */
export function exerciseLabels(exercises: { linked?: boolean }[]): string[] {
  const blocks = exerciseBlocks(exercises);
  const out: string[] = new Array(exercises.length);
  blocks.forEach((idxs, b) => {
    const letter = blockLetter(b);
    idxs.forEach((i, k) => (out[i] = idxs.length > 1 ? `${letter}${k + 1}` : letter));
  });
  return out;
}

/** Bloki jako listy indeksów kolejnych ćwiczeń. */
export function exerciseBlocks(exercises: { linked?: boolean }[]): number[][] {
  const blocks: number[][] = [];
  exercises.forEach((e, i) => {
    if (e.linked && blocks.length) blocks[blocks.length - 1].push(i);
    else blocks.push([i]);
  });
  return blocks;
}

function blockLetter(n: number): string {
  let s = '';
  n += 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Przesunięcie ćwiczenia o jedno miejsce z zachowaniem bloków (superserii / obwodów):
 * w obrębie bloku zmienia się tylko kolejność; poza blok ćwiczenie wychodzi jako samodzielne,
 * a wstawione w środek bloku — dołącza do niego.
 */
export function moveInBlocks<T extends { linked?: boolean }>(list: T[], k: number, dir: -1 | 1): T[] {
  const j = k + dir;
  if (j < 0 || j >= list.length) return list;
  const blocks = exerciseBlocks(list);
  const blockOf = (i: number) => blocks.findIndex((b) => b.includes(i));
  if (blockOf(k) === blockOf(j)) {
    const out = [...list];
    const lk = out[k].linked;
    const lj = out[j].linked;
    [out[k], out[j]] = [{ ...out[j], linked: lk }, { ...out[k], linked: lj }];
    return out;
  }
  const item = list[k];
  const rest = removeFromBlocks(list, k);
  const next = rest[j];
  const joined = !!next?.linked && j > 0;
  const out = [...rest.slice(0, j), { ...item, linked: joined ? true : undefined }, ...rest.slice(j)];
  return out.map((e, i) => (i === 0 && e.linked ? { ...e, linked: undefined } : e));
}

/** Usunięcie ćwiczenia; jeśli zaczynało blok, następne przejmuje rolę początku bloku. */
export function removeFromBlocks<T extends { linked?: boolean }>(list: T[], k: number): T[] {
  const out = list.filter((_, i) => i !== k);
  if (!list[k]?.linked && out[k]?.linked) out[k] = { ...out[k], linked: undefined };
  return out;
}
