import type { Plan, PlanExercise, PlanWorkout, SetGroup } from '../domain';
import { mergeGroups } from './plan';

/**
 * Wczytanie zmian z arkusza do ISTNIEJĄCEGO planu (arkusz → aplikacja, w obie strony z eksportem).
 * Tygodnie łączone po kolejności, jednostki po nazwie (inaczej po kolejności), ćwiczenia po nazwie:
 * dopasowane zachowują swoje id (wykonane treningi, komentarze i notatki podopiecznego zostają przypięte),
 * a pola, których arkusz nie przenosi (np. zadany termin jednostki, „za 1 hantel”), zostają z planu.
 */

export interface PlanDiff {
  added: number;
  removed: number;
  changed: number;
  /** Opis zmian po polsku, jednostka po jednostce. */
  lines: string[];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/^[a-z]\d+\s+/i, '') // „C1 Hip thrust” → „hip thrust”
    .replace(/\s+/g, ' ')
    .trim();

/** Zapis serii do porównania i do opisu: „1×5 100 @8 + 3×5 -10% @7”. */
export function groupsText(groups: SetGroup[]): string {
  return mergeGroups(structuredClone(groups))
    .map((g) => [`${g.sets || 1}×${g.reps || '?'}`, g.load && g.load.replace('.', ','), g.rpe && `@${g.rpe.replace('.', ',')}`, g.type && g.type !== 'Robocze' ? `(${g.type})` : '', g.pace ? `tempo ${g.pace}` : '', g.rest ? `p. ${g.rest}` : ''].filter(Boolean).join(' '))
    .join(' + ');
}

/** Przerwa „90” i „1:30” to to samo. */
const restNorm = (r?: string) => {
  const t = (r ?? '').trim();
  return /^\d+$/.test(t) ? `${Math.floor(Number(t) / 60)}:${String(Number(t) % 60).padStart(2, '0')}` : t;
};
/** Do porównania: przerwa serii albo ćwiczenia (cardio trzyma ją przy odcinku, inne przy ćwiczeniu — to samo). */
const exKey = (e: PlanExercise) =>
  JSON.stringify([groupsText(e.groups.map((g) => ({ ...g, rest: restNorm(g.rest || e.rest) || undefined }))), (e.notes ?? '').trim(), !!e.perSide, !!e.linked]);

function mergeExercise(old: PlanExercise, imp: PlanExercise): PlanExercise {
  const out: PlanExercise = { ...old };
  for (const [k, v] of Object.entries(imp) as [keyof PlanExercise, unknown][]) if (v !== undefined && k !== 'id') (out as unknown as Record<string, unknown>)[k] = v;
  // pola tylko z arkusza: brak w arkuszu = brak w planie
  out.notes = (imp.notes ?? '').trim() === (old.notes ?? '').trim() ? old.notes : imp.notes;
  out.rest = restNorm(imp.rest) === restNorm(old.rest) ? old.rest : imp.rest;
  out.linked = imp.linked;
  return out;
}

function mergeWorkout(old: PlanWorkout | undefined, imp: PlanWorkout, where: string, diff: PlanDiff): PlanWorkout {
  if (!old) {
    const n = imp.exercises.filter((e) => e.name.trim()).length;
    diff.added += n;
    diff.lines.push(`${where}: nowa jednostka (${n} ćw.)`);
    return imp;
  }
  const pool = [...old.exercises];
  const add: string[] = [];
  const chg: string[] = [];
  const exercises = imp.exercises.map((e) => {
    const i = pool.findIndex((o) => norm(o.name) === norm(e.name));
    if (i < 0) {
      if (e.name.trim()) add.push(e.name);
      return e;
    }
    const o = pool.splice(i, 1)[0];
    const m = mergeExercise(o, e);
    if (exKey(o) !== exKey(m)) {
      const a = groupsText(o.groups);
      const z = groupsText(m.groups);
      chg.push(a !== z ? `${m.name} (${a} → ${z})` : `${m.name} (uwagi / przerwa)`);
    }
    return m;
  });
  const rem = pool.filter((o) => o.name.trim()).map((o) => o.name);
  diff.added += add.length;
  diff.removed += rem.length;
  diff.changed += chg.length;
  const order = old.exercises.filter((e) => e.name.trim()).map((e) => e.id).join('|') !== exercises.filter((e) => e.name.trim()).map((e) => e.id).join('|') && !add.length && !rem.length;
  const parts = [add.length ? `dodane: ${add.join(', ')}` : '', rem.length ? `usunięte: ${rem.join(', ')}` : '', chg.length ? `zmienione: ${chg.join('; ')}` : '', order ? 'zmieniona kolejność' : ''].filter(Boolean);
  if (order) diff.changed++;
  if (old.name !== imp.name) parts.unshift(`nazwa „${old.name}” → „${imp.name}”`);
  if (parts.length) diff.lines.push(`${where}: ${parts.join(' · ')}`);
  return { ...old, name: imp.name, day: imp.day ?? old.day, date: imp.date ?? old.date, exercises };
}

/** Plan po wczytaniu arkusza (to samo id, nazwa, start i status) i lista zmian. */
export function mergePlan(old: Plan, imp: Plan): { plan: Plan; diff: PlanDiff } {
  const diff: PlanDiff = { added: 0, removed: 0, changed: 0, lines: [] };
  const weeks = imp.weeks.map((w, wi) => {
    const ow = old.weeks[wi];
    const pool = [...(ow?.workouts ?? [])];
    const workouts = w.workouts.map((k, ki) => {
      let i = pool.findIndex((o) => norm(o.name) === norm(k.name));
      // jednostka przemianowana w arkuszu — ta sama pozycja w tygodniu
      if (i < 0 && ow && pool.includes(ow.workouts[ki])) i = pool.indexOf(ow.workouts[ki]);
      const o = i >= 0 ? pool.splice(i, 1)[0] : undefined;
      return mergeWorkout(o, k, `${w.name} · ${k.name}`, diff);
    });
    for (const o of pool) {
      const n = o.exercises.filter((e) => e.name.trim()).length;
      if (!n) continue;
      diff.removed += n;
      diff.lines.push(`${ow!.name} · ${o.name}: jednostka usunięta (${n} ćw.)`);
    }
    if (!ow) diff.lines.splice(diff.lines.length - w.workouts.length, 0, `${w.name}: nowy tydzień`);
    return ow ? { ...ow, name: w.name, workouts } : w;
  });
  for (const ow of old.weeks.slice(imp.weeks.length)) {
    const n = ow.workouts.reduce((a, k) => a + k.exercises.filter((e) => e.name.trim()).length, 0);
    diff.removed += n;
    diff.lines.push(`${ow.name}: tydzień usunięty (${n} ćw.)`);
  }
  return { plan: { ...old, weeks, updatedAt: new Date().toISOString() }, diff };
}
