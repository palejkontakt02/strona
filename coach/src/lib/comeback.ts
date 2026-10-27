/**
 * Powrót po przerwie: pierwszy trening po ≥ N dniach bez treningu (domyślnie 14) ma podpowiedzi
 * ciężaru obniżone o X% (domyślnie 15%). Zgłoszona nieobecność liczy się tak samo jak przerwa.
 * Próg i obniżkę ustawia trener w profilu klienta (`client.comeback`). Testy: comeback.test.ts.
 */
import type { Absence, ComebackRule, ISODate, TrainingSession } from '../domain';
import { daysBetween } from './dates';
import { validAbsences } from './absence';
import { loadPerOf, type Run } from './run';
import { num } from './parse';

export const COMEBACK_DEFAULT: ComebackRule = { days: 14, pct: 15 };

/** Reguła klienta z domyślnymi wartościami i bezpiecznymi granicami (7–90 dni, 5–40%). */
export function comebackRule(r: ComebackRule | undefined): ComebackRule {
  const days = Math.round(Math.min(90, Math.max(7, Number(r?.days) || COMEBACK_DEFAULT.days)));
  const pct = Math.round(Math.min(40, Math.max(5, Number(r?.pct) || COMEBACK_DEFAULT.pct)));
  return { days, pct, ...(r?.off ? { off: true } : {}) };
}

export interface Comeback {
  /** Dni przerwy (od ostatniego treningu albo długość nieobecności). */
  days: number;
  pct: number;
}

/**
 * Czy trening w dniu `today` to pierwszy po przerwie. Przerwa = dni od ostatniego treningu
 * (przed `today`); zgłoszona nieobecność, która skończyła się najwyżej 3 dni temu i trwała ≥ progu,
 * liczy się tak samo — także gdy w jej trakcie był pojedynczy trening (np. na urlopie). Bez historii treningów — nie (nowy podopieczny).
 * Trening już zrobiony dziś = to nie pierwszy po przerwie.
 */
export function comebackFor(sessions: Pick<TrainingSession, 'date'>[], today: ISODate, rule: ComebackRule | undefined, absences?: Absence[]): Comeback | null {
  const r = comebackRule(rule);
  if (r.off) return null;
  const past = sessions.map((s) => s.date).filter((d) => d && d <= today);
  if (!past.length) return null;
  if (past.includes(today)) return null;
  const last = past.reduce((a, d) => (d > a ? d : a), '');
  let gap = daysBetween(last, today);
  // zgłoszona nieobecność: liczy się jej długość, jeśli po jej końcu nie było jeszcze treningu
  for (const a of validAbsences(absences)) {
    if (a.to >= today || daysBetween(a.to, today) > 3) continue;
    if (past.some((d) => d > a.to)) continue;
    gap = Math.max(gap, daysBetween(a.from, a.to) + 1);
  }
  return gap >= r.days ? { days: gap, pct: r.pct } : null;
}

/** Obniżony ciężar: sztanga / maszyna co 2,5 kg, hantle i kettle co 1 kg; nigdy poniżej 0. */
export function reducedLoad(kg: number, pct: number, dumbbell: boolean): number {
  const step = dumbbell ? 1 : 2.5;
  const v = Math.round((kg * (1 - pct / 100)) / step) * step;
  return Math.max(0, Math.round(v * 100) / 100);
}

/** Pełne ciężary do przywrócenia: klucz „ćwiczenie-seria” → ciężar przed obniżeniem. */
export type ComebackOrig = Record<string, string>;

/**
 * Obniża podpowiedzi ciężaru w treningu (serie niezaliczone, niezmienione ręcznie, z liczbą kg).
 * Cardio i serie bez ciężaru bez zmian. Zwraca nowy trening i pełne wartości do „Użyj pełnych ciężarów”.
 */
export function applyComeback(run: Run, pct: number): { run: Run; orig: ComebackOrig } {
  const next = structuredClone(run);
  const orig: ComebackOrig = {};
  next.ex.forEach((e, k) => {
    if (e.cardio) return;
    const db = loadPerOf(e) != null;
    e.sets.forEach((s, i) => {
      const kg = num(s.load);
      if (s.done || s.edited || kg == null || kg <= 0) return;
      const nl = reducedLoad(kg, pct, db);
      if (nl === kg) return;
      orig[`${k}-${i}`] = s.load;
      s.load = String(nl);
    });
  });
  return { run: next, orig };
}

/** „Użyj pełnych ciężarów”: przywraca ciężary serii jeszcze niezaliczonych i niezmienionych ręcznie. */
export function restoreFull(run: Run, orig: ComebackOrig): Run {
  const next = structuredClone(run);
  for (const [key, load] of Object.entries(orig)) {
    const [k, i] = key.split('-').map(Number);
    const s = next.ex[k]?.sets[i];
    if (s && !s.done && !s.edited) s.load = load;
  }
  return next;
}

/** „Wracamy spokojnie: ciężary −15% po 18 dniach przerwy”. */
export function comebackText(c: Comeback): string {
  return `Wracamy spokojnie: ciężary −${c.pct}% po ${c.days} dniach przerwy`;
}
