import type { ISODate, Plan, PlanExercise, SessionExercise, SetGroup, TrainingSession } from '../domain';
import { daysBetween } from './dates';
import { num } from './parse';
import { expandSets } from './plan';
import { cardioByName, isTimed, loadPerOf } from './run';
import { recentE1, resolveLoad, rounderFor, roundLoad } from './strength';

/** add — dołóż ciężar, hold — utrzymaj, cut — zmniejsz o 5%. */
export type SuggestKind = 'add' | 'hold' | 'cut';

export interface LoadSuggestion {
  exercise: string;
  kind: SuggestKind;
  /** Ciężar roboczy z ostatniego treningu (najwyższy w seriach roboczych). */
  last: number;
  /** Ciężar w planie na tydzień docelowy (kg wpisane albo dobrane z historii); null — nie da się ustalić (np. % bez maksa). */
  planned: number | null;
  /** Proponowany ciężar. */
  next: number;
  /** Jednozdaniowe uzasadnienie. */
  why: string;
  /** Data ostatniego treningu z tym ćwiczeniem. */
  date: ISODate;
  /** Da się wpisać w plan (w tygodniu docelowym jest seria z kg albo bez ciężaru). */
  applicable: boolean;
  /** Plan na ten tydzień już zakłada taki ruch (np. wyższy ciężar) — domyślnie bez zaznaczenia. */
  already: boolean;
}

const MAIN = new Set(['Robocze', 'Top set', 'AMRAP']);
const ABS = /^\s*\d+(?:[.,]\d+)?\s*(kg)?\s*$/i;
const fmt = (v: number) => String(Math.round(v * 100) / 100).replace('.', ',');

/** „8–10” → [8, 10]; „5” → [5, 5]; „8/str.” → [8, 8]; AMRAP, czas, kompleks, puste → null. */
export function repRange(reps: string | undefined): [number, number] | null {
  const t = String(reps ?? '').trim();
  if (!t || /\+|amrap|max|s\b|min|sek/i.test(t)) return null;
  const m = t.match(/^(\d+)\s*(?:[-–—]\s*(\d+))?/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  return [Math.min(a, b), Math.max(a, b)];
}

interface DoneSet {
  load: number;
  reps: number;
  rpe: number | null;
  /** Z podsumowania (serie × powt. × kg), nie seria po serii — porównujemy z pierwszą serią roboczą planu. */
  summary?: boolean;
}

/** Serie robocze z zapisu (bez rozgrzewek, niezaliczonych, kompleksów i serii na czas). */
function doneSets(e: SessionExercise): DoneSet[] {
  if (e.setsLog?.length) {
    return e.setsLog
      .filter((s) => !s.warmup && s.done !== false && !s.complex && !s.unit && (s.load ?? 0) > 0 && s.reps != null)
      .map((s) => ({ load: s.load!, reps: s.repsR != null ? Math.min(s.reps!, s.repsR) : s.reps!, rpe: s.rpe ?? null }));
  }
  const n = num(e.sets) ?? 1;
  const load = num(e.load);
  const reps = num(e.reps);
  if (!load || reps == null || String(e.reps ?? '').includes('+')) return [];
  return Array.from({ length: Math.max(1, Math.min(10, n)) }, () => ({ load, reps, rpe: num(e.rpe), summary: true }));
}

interface Verdict {
  missed: { reps: number; min: number } | null;
  top: boolean;
  rpeOver: { rpe: number; target: number } | null;
  rpeHigh: { rpe: number; target: number } | null;
  maxRpe: number | null;
  topRange: [number, number] | null;
}

/** Porównanie serii z celem planu: seria n ↔ n-ta seria robocza planu (ostatnia, gdy zrobiono więcej). */
function judge(sets: DoneSet[], groups: SetGroup[]): Verdict {
  const work = expandSets(groups.filter((g) => g.type !== 'Rozgrzewka'));
  // podsumowanie (np. „3 × 5 · 150 kg”) opisuje serie główne — cel z pierwszej serii roboczej planu
  const main = work.find((g) => MAIN.has(g.type)) ?? work[0];
  const plan = sets.some((s) => s.summary) && main ? [main] : work;
  const rpeAll = num(plan.find((g) => num(g.rpe) != null)?.rpe);
  const v: Verdict = { missed: null, top: true, rpeOver: null, rpeHigh: null, maxRpe: null, topRange: null };
  let compared = 0;
  sets.forEach((s, i) => {
    const g = plan[Math.min(i, plan.length - 1)];
    const range = g ? repRange(g.reps) : null;
    const tRpe = (g && num(g.rpe)) ?? rpeAll;
    if (range) {
      compared++;
      if (!v.topRange) v.topRange = range;
      if (s.reps < range[0] && !v.missed) v.missed = { reps: s.reps, min: range[0] };
      if (s.reps < range[1]) v.top = false;
    }
    if (s.rpe != null) {
      v.maxRpe = Math.max(v.maxRpe ?? 0, s.rpe);
      if (tRpe != null && s.rpe > tRpe && (!v.rpeOver || s.rpe - tRpe > v.rpeOver.rpe - v.rpeOver.target)) v.rpeOver = { rpe: s.rpe, target: tRpe };
      if (tRpe != null && s.rpe > tRpe + 1 && !v.rpeHigh) v.rpeHigh = { rpe: s.rpe, target: tRpe };
    }
  });
  if (!compared) v.top = false;
  return v;
}

/**
 * Tydzień do sugestii: następny po tygodniu ostatnio wykonanej jednostki planu; po ostatnim tygodniu — pierwszy
 * (plan idzie w kółko, jak „następny trening”). Brak historii → null.
 */
export function targetWeekIndex(plan: Plan, sessions: TrainingSession[]): number | null {
  let last: { date: string; wi: number } | null = null;
  for (const s of sessions) {
    if (s.planId !== plan.id || !s.workoutId) continue;
    const wi = plan.weeks.findIndex((w) => w.workouts.some((k) => k.id === s.workoutId));
    if (wi < 0) continue;
    if (!last || s.date > last.date || (s.date === last.date && wi > last.wi)) last = { date: s.date, wi };
  }
  if (!last) return null;
  return (last.wi + 1) % plan.weeks.length;
}

const strengthEx = (e: PlanExercise) => !!e.name.trim() && !(e.cardio ?? cardioByName(e.name)) && !isTimed(e);

/** Cel planu dla treningu: ćwiczenie z jednostki, z której pochodzi zapis; inaczej z tygodnia docelowego. */
function targetGroups(plan: Plan, s: TrainingSession, name: string, fallback: SetGroup[]): SetGroup[] {
  if (s.planId === plan.id && s.workoutId) {
    for (const w of plan.weeks) {
      const k = w.workouts.find((x) => x.id === s.workoutId);
      const e = k?.exercises.find((x) => x.name === name);
      if (e) return e.groups;
    }
  }
  return fallback;
}

/**
 * Sugestie ciężaru na kolejny tydzień planu dla ćwiczeń siłowych:
 * „dodaj” (+2,5 kg) — wszystkie serie z górnym zakresem powtórzeń przy RPE ≤ cel;
 * „zmniejsz” (−5%) — niedobrane powtórzenia albo RPE > cel + 1 dwa treningi z rzędu; inaczej „utrzymaj”.
 * Bierze pod uwagę treningi z ostatnich 6 tygodni (od `today`).
 */
export function suggestLoads(plan: Plan, sessions: TrainingSession[], today: ISODate, weekIndex = targetWeekIndex(plan, sessions)): { weekIndex: number; items: LoadSuggestion[] } | null {
  if (weekIndex == null || !plan.weeks[weekIndex]) return null;
  const week = plan.weeks[weekIndex];
  const seen = new Set<string>();
  const items: LoadSuggestion[] = [];
  const sorted = [...sessions].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
  for (const k of week.workouts)
    for (const pe of k.exercises) {
      if (!strengthEx(pe) || seen.has(pe.name)) continue;
      seen.add(pe.name);
      const hist = sorted
        .filter((s) => daysBetween(s.date, today) <= 42)
        .flatMap((s) => {
          const e = s.exercises.find((x) => x.name === pe.name);
          const sets = e ? doneSets(e) : [];
          return sets.length ? [{ s, sets }] : [];
        });
      if (!hist.length) continue;
      const [cur, prev] = hist;
      const vc = judge(cur.sets, targetGroups(plan, cur.s, pe.name, pe.groups));
      const vp = prev ? judge(prev.sets, targetGroups(plan, prev.s, pe.name, pe.groups)) : null;
      const last = Math.max(...cur.sets.map((x) => x.load));
      const per = loadPerOf(pe);
      const round = rounderFor(pe.name, per);
      let kind: SuggestKind = 'hold';
      let next = last;
      let why: string;
      if (vc.missed && vp?.missed) {
        kind = 'cut';
        why = `Dwa treningi z rzędu niedobrane powtórzenia (ostatnio ${vc.missed.reps} z ${vc.missed.min}).`;
      } else if (vc.rpeHigh && vp?.rpeHigh) {
        kind = 'cut';
        why = `Dwa treningi z rzędu RPE powyżej celu o więcej niż 1 (ostatnio ${fmt(vc.rpeHigh.rpe)} przy celu ${fmt(vc.rpeHigh.target)}).`;
      } else if (vc.top && !vc.missed && !vc.rpeOver) {
        kind = 'add';
        const r = vc.topRange!;
        why = `Wszystkie serie z górnym zakresem (${r[1]} powt.)${vc.maxRpe != null ? ` przy RPE do ${fmt(vc.maxRpe)}` : ''} — czas na więcej.`;
      } else if (vc.missed) {
        why = `Raz zabrakło powtórzeń (${vc.missed.reps} z ${vc.missed.min}) — jeszcze tydzień na tym ciężarze.`;
      } else if (vc.rpeOver) {
        why = `RPE ${fmt(vc.rpeOver.rpe)} przy celu ${fmt(vc.rpeOver.target)} — utrzymaj, aż będzie lżej.`;
      } else {
        why = vc.topRange ? `Powtórzenia w zakresie, jeszcze nie górna granica (${vc.topRange[1]}) — utrzymaj.` : 'Brak celu powtórzeń w planie — utrzymaj.';
      }
      if (kind === 'add') {
        next = roundLoad(last + 2.5, pe.name, per);
        if (next <= last) next = last + 2.5;
      }
      if (kind === 'cut') {
        next = round(last * 0.95);
        if (next >= last) next = Math.max(0, round(last - 2.5));
      }
      const main = pe.groups.find((g) => MAIN.has(g.type)) ?? pe.groups.find((g) => g.type !== 'Rozgrzewka');
      const planned = main ? resolveLoad(main.load, recentE1(sessions, pe.name), main.reps, main.rpe, null, { round }).load : null;
      const applicable = pe.groups.some((g) => MAIN.has(g.type) && (ABS.test(g.load) || !g.load.trim()));
      const already = planned != null && ((kind === 'add' && planned >= next) || (kind === 'cut' && planned <= next) || (kind === 'hold' && planned === next));
      items.push({ exercise: pe.name, kind, last, planned, next, why, date: cur.s.date, applicable, already });
    }
  return { weekIndex, items };
}

/**
 * Wpisuje ciężary w tygodniu `weekIndex`: serie robocze / top / AMRAP (z kg albo bez ciężaru) → nowy ciężar;
 * back-off i drop z kg — o tyle samo kg co seria główna. Zapis względny („-10%”, „75%”) zostaje.
 */
export function applySuggestions(plan: Plan, weekIndex: number, items: Pick<LoadSuggestion, 'exercise' | 'next' | 'planned' | 'last'>[]): Plan {
  const out: Plan = structuredClone(plan);
  const week = out.weeks[weekIndex];
  if (!week) return out;
  for (const it of items)
    for (const k of week.workouts)
      for (const e of k.exercises) {
        if (e.name !== it.exercise) continue;
        const base = it.planned ?? it.last;
        const delta = it.next - base;
        const round = rounderFor(e.name, loadPerOf(e));
        e.groups = e.groups.map((g) => {
          if (g.type === 'Rozgrzewka') return g;
          if (MAIN.has(g.type) && (ABS.test(g.load) || !g.load.trim())) return { ...g, load: String(it.next) };
          if (!MAIN.has(g.type) && ABS.test(g.load)) return { ...g, load: String(Math.max(0, round((num(g.load) ?? 0) + delta))) };
          return g;
        });
      }
  return out;
}
