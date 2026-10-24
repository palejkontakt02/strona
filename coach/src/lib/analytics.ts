/**
 * Analiza dla trenera: historia bólu z mapy ciała, szablony planów, zadawanie wielu osobom.
 * Czyste funkcje (bez bazy i Reacta) — testowane w analytics.test.ts.
 */
import type { ISODate, PainSpot, Plan, PlanExercise, TrainingSession } from '../domain';
import { uid } from '../format';
import { addDays, daysBetween, weekStart } from './dates';

/* ---------- mapa bólu w czasie ---------- */

export interface PainRow {
  area: string;
  side?: 'L' | 'P';
  /** Ile treningów z bólem w tym miejscu. */
  count: number;
  max: number;
  last: ISODate;
  /** Poziom przy ostatnim zgłoszeniu. */
  lastLevel: number;
}

const painKey = (p: PainSpot) => `${p.area}|${p.side ?? ''}`;

/**
 * Zgłoszenia bólu z `painMap` treningów z ostatnich `weeks` tygodni (do `today` włącznie),
 * zgrupowane po miejscu i stronie. Poziom 0 się nie liczy. Kolejność: najczęściej, potem najmocniej, potem najnowsze.
 */
export function painHistory(sessions: TrainingSession[], today: ISODate, weeks = 8): PainRow[] {
  const from = addDays(today, -7 * weeks);
  const by = new Map<string, PainRow>();
  for (const s of sessions) {
    if (s.date < from || s.date > today || !s.painMap?.length) continue;
    // to samo miejsce dwa razy w jednym treningu liczy się raz (najwyższy poziom)
    const once = new Map<string, PainSpot>();
    for (const p of s.painMap) {
      if (!p?.area || !(p.level > 0)) continue;
      const k = painKey(p);
      const prev = once.get(k);
      if (!prev || p.level > prev.level) once.set(k, p);
    }
    for (const [k, p] of once) {
      const r = by.get(k);
      if (!r) by.set(k, { area: p.area, side: p.side, count: 1, max: p.level, last: s.date, lastLevel: p.level });
      else {
        r.count++;
        r.max = Math.max(r.max, p.level);
        if (s.date >= r.last) {
          r.last = s.date;
          r.lastLevel = p.level;
        }
      }
    }
  }
  return [...by.values()].sort((a, b) => b.count - a.count || b.max - a.max || b.last.localeCompare(a.last));
}

/** Punkty do mapy (tylko do odczytu): każde miejsce z najwyższym poziomem z okresu. */
export function painSpotsOf(rows: PainRow[]): PainSpot[] {
  return rows.map((r) => ({ area: r.area, side: r.side, level: r.max }));
}

/* ---------- szablony planów ---------- */

/** `clientId` szablonu planu — nie jest id żadnego podopiecznego, więc szablon nie trafia do `plansOf`, kalendarza ani aplikacji podopiecznego. */
export const TEMPLATE_CLIENT = '__template__';

export function isTemplate(p: Pick<Plan, 'clientId' | 'template'>): boolean {
  return p.clientId === TEMPLATE_CLIENT || !!p.template;
}

export function templatesOf<T extends Pick<Plan, 'clientId' | 'template' | 'name'>>(plans: T[]): T[] {
  return plans.filter(isTemplate).sort((a, b) => a.name.localeCompare(b.name, 'pl'));
}

/** Najbliższy poniedziałek po dziś (w poniedziałek — za tydzień). */
export function nextMonday(today: ISODate): ISODate {
  return addDays(weekStart(today), 7);
}

/** Głęboka kopia tygodni z nowymi id; daty jednostek przesunięte o `shift` dni. */
function cloneWeeks(weeks: Plan['weeks'], shift: number): Plan['weeks'] {
  return weeks.map((w) => ({
    ...w,
    id: uid(),
    workouts: w.workouts.map((k) => ({
      ...structuredClone(k),
      id: uid(),
      date: k.date ? addDays(k.date, shift) : undefined,
      assignedAt: undefined,
      exercises: k.exercises.map((e) => ({ ...structuredClone(e), id: uid() })),
    })),
  }));
}

/** Szablon z planu podopiecznego (kopia; oryginał bez zmian). Data startu zostaje jako punkt odniesienia dla jednostek z datą. */
export function templateFromPlan(plan: Plan, name = plan.name): Plan {
  return {
    id: uid(),
    clientId: TEMPLATE_CLIENT,
    template: true,
    name,
    notes: plan.notes,
    startDate: plan.startDate,
    active: false,
    updatedAt: new Date().toISOString(),
    weeks: cloneWeeks(plan.weeks, 0),
  };
}

/**
 * Plan dla podopiecznego z szablonu albo planu innej osoby: start od najbliższego poniedziałku,
 * jednostki z datą przesunięte o tyle samo. Bez znacznika szablonu.
 */
export function planFromTemplate(src: Plan, clientId: string, today: ISODate, active: boolean): Plan {
  const start = nextMonday(today);
  const shift = src.startDate ? daysBetween(src.startDate, start) : 0;
  return {
    id: uid(),
    clientId,
    name: src.name,
    notes: src.notes,
    startDate: start,
    active,
    updatedAt: new Date().toISOString(),
    weeks: cloneWeeks(src.weeks, shift),
  };
}

/* ---------- zadanie treningu wielu osobom ---------- */

/**
 * Kopia ćwiczeń dla innej osoby: nowe id, bez kilogramów (odtwarzacz podpowie z historii tej osoby).
 * Zapis względny („75%”, „-10%”) zostaje — liczy się od maksów tej osoby. W biegu dystans zostaje.
 */
export function exercisesFor(ex: PlanExercise[], keepLoads: boolean): PlanExercise[] {
  return structuredClone(ex).map((e) => ({
    ...e,
    id: uid(),
    groups: keepLoads || e.cardio ? e.groups : e.groups.map((g) => (/%/.test(g.load) ? g : { ...g, load: '' })),
  }));
}

/** Filtr listy osób po fragmencie imienia/nazwiska (bez polskich znaków i wielkości liter). */
export function matchName(name: string, q: string): boolean {
  const n = (s: string) => s.toLocaleLowerCase('pl').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
  const t = n(q.trim());
  return !t || n(name).includes(t);
}

/* ---------- % maksa w planie ---------- */

/** „75%” / „72,5 %” → 75; inny zapis (kg, „-10%”, „+4%”) → null. */
export function pctOf(load: string): number | null {
  const m = String(load ?? '').match(/^\s*(\d+(?:[.,]\d+)?)\s*%\s*$/);
  if (!m) return null;
  const v = parseFloat(m[1].replace(',', '.'));
  return v > 0 && v <= 150 ? v : null;
}
