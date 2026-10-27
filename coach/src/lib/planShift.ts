import type { ISODate, Plan } from '../domain';
import { uid } from '../format';
import { addDays, daysBetween, weekStart } from './dates';
import { workoutDate } from './plan';

/** Dzień tygodnia 1 (pon.) … 7 (niedz.). */
const isoDay = (iso: ISODate) => ((new Date(`${iso}T12:00:00`).getDay() + 6) % 7) + 1;

/** Daty jednostek planu (z dnia tygodnia albo wpisanej daty) — wiersz na jednostkę. */
export function planDates(plan: Plan): { wi: number; ki: number; date: ISODate }[] {
  const out: { wi: number; ki: number; date: ISODate }[] = [];
  plan.weeks.forEach((w, wi) =>
    w.workouts.forEach((k, ki) => {
      const d = workoutDate(plan, wi, k);
      if (d) out.push({ wi, ki, date: d });
    }),
  );
  return out;
}

/**
 * Przesuwa resztę planu: każda jednostka z datą ≥ `fromISO` (dzień tygodnia liczony od startu albo wpisana data)
 * przesuwa się o `days` dni; wcześniejsze zostają. Gdy przesuwa się cały plan o pełne tygodnie — zmienia się
 * tylko data startu (i wpisane daty), dni tygodnia zostają. Inaczej przesunięte jednostki dostają konkretną datę.
 * Czysta funkcja: zwraca nowy plan (te same id), oryginał bez zmian.
 */
export function shiftPlanFrom(plan: Plan, fromISO: ISODate, days: number): Plan {
  const next: Plan = structuredClone(plan);
  if (!days || plan.extra) return next;
  const dates = planDates(plan);
  const hit = dates.filter((x) => x.date >= fromISO);
  if (!hit.length) return next;
  const whole = hit.length === dates.length && days % 7 === 0 && !!plan.startDate;
  if (whole) {
    next.startDate = addDays(plan.startDate!, days);
    for (const w of next.weeks) for (const k of w.workouts) if (k.date) k.date = addDays(k.date, days);
    return next;
  }
  for (const { wi, ki, date } of hit) {
    const k = next.weeks[wi].workouts[ki];
    const to = addDays(date, days);
    k.date = to;
    if (k.day) k.day = isoDay(to);
  }
  return next;
}

export interface ShiftRow {
  /** Nazwa tygodnia planu („Tydzień 3”). */
  week: string;
  /** Pierwsza przesuwana data w tym tygodniu przed i po przesunięciu. */
  from: ISODate;
  to: ISODate;
  /** Ile jednostek tego tygodnia się przesuwa. */
  count: number;
}

/** Podgląd przesunięcia: tydzień po tygodniu „Tydzień 3: 09.11 → 16.11”. */
export function shiftPreview(plan: Plan, fromISO: ISODate, days: number): ShiftRow[] {
  if (!days || plan.extra) return [];
  const rows: ShiftRow[] = [];
  for (const { wi, date } of planDates(plan)) {
    if (date < fromISO) continue;
    const name = plan.weeks[wi].name || `Tydzień ${wi + 1}`;
    const r = rows.find((x) => x.week === name);
    if (r) {
      r.count++;
      if (date < r.from) Object.assign(r, { from: date, to: addDays(date, days) });
    } else rows.push({ week: name, from: date, to: addDays(date, days), count: 1 });
  }
  return rows;
}

/** Ostatni dzień planu: najpóźniejsza data jednostki, a bez dat — koniec ostatniego tygodnia od startu. */
export function planEnd(plan: Plan): ISODate | undefined {
  const ds = planDates(plan).map((x) => x.date).sort();
  if (ds.length) return ds[ds.length - 1];
  return plan.startDate ? addDays(weekStart(plan.startDate), plan.weeks.length * 7 - 1) : undefined;
}

/** „S&C — blok 2” → „S&C — blok 3”; inna nazwa → „<nazwa> — blok 2”. */
export function nextBlockName(name: string): string {
  const m = name.match(/^(.*?)\s*[—–-]\s*blok\s+(\d+)\s*$/i);
  return m ? `${m[1]} — blok ${Number(m[2]) + 1}` : `${name.replace(/\s*\(kopia\)\s*$/, '')} — blok 2`;
}

/**
 * Duplikat planu jako kolejny blok: nowe id, nazwa „— blok N”, start od najbliższego poniedziałku po końcu oryginału
 * (wpisane daty jednostek przesunięte o tyle samo), nieaktywny.
 */
export function nextBlock(plan: Plan): Plan {
  const end = planEnd(plan);
  const start = end ? addDays(weekStart(end), 7) : undefined;
  const shift = start && plan.startDate ? daysBetween(weekStart(plan.startDate), start) : 0;
  return {
    ...plan,
    id: uid(),
    name: nextBlockName(plan.name),
    active: false,
    startDate: start ?? plan.startDate,
    updatedAt: new Date().toISOString(),
    weeks: plan.weeks.map((w) => ({
      ...w,
      id: uid(),
      workouts: w.workouts.map((k) => ({
        ...structuredClone(k),
        id: uid(),
        date: k.date ? addDays(k.date, shift) : undefined,
        assignedAt: undefined,
        exercises: k.exercises.map((e) => ({ ...structuredClone(e), id: uid() })),
      })),
    })),
  };
}

export interface Absence {
  from: ISODate;
  to: ISODate;
  reason?: string;
}

/**
 * Nieobecność klienta, na którą wypadają jednostki aktywnego planu (od dziś): proponowane przesunięcie
 * w pełnych tygodniach (≥ długość nieobecności), od pierwszego dnia nieobecności.
 */
export function absenceShift(plan: Plan, absences: Absence[] | undefined, today: ISODate): { absence: Absence; from: ISODate; days: number } | null {
  if (!absences?.length || plan.extra) return null;
  const dates = planDates(plan).map((x) => x.date);
  for (const a of [...absences].sort((x, y) => x.from.localeCompare(y.from))) {
    if (!a.from || !a.to || a.to < today || a.to < a.from) continue;
    if (!dates.some((d) => d >= a.from && d <= a.to)) continue;
    const len = daysBetween(a.from, a.to) + 1;
    return { absence: a, from: a.from, days: Math.ceil(len / 7) * 7 };
  }
  return null;
}
