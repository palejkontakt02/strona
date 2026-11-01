import type { Appointment, ISODate } from "../domain";
import { DEFAULT_APPT_MIN } from "./calendar";
import { addDays, toMinutes, weekStart } from "./dates";

/* Godziny pracy trenera i wolne okienka w kalendarzu (widok Dzień, Pulpit „Ten tydzień”). */

/** Godziny pracy z profilu trenera (days: 1 = pon … 7 = niedz.). */
export interface WorkHours {
  from: string;
  to: string;
  days: number[];
}

/** Przedział w minutach od północy [from, to). */
export interface Span {
  from: number;
  to: number;
}

/** Najkrótsze okienko, które warto pokazać jako wolne. */
export const MIN_FREE = 60;

/** 1 = pon … 7 = niedz. */
export const dow = (iso: ISODate) => {
  const [y, m, d] = iso.split("-").map(Number);
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
};

/** Godziny pracy danego dnia; bez profilu: pn–pt 7–21, sob 8–14, niedziela wolna. */
export function hoursOn(date: ISODate, wh?: WorkHours | null): Span | null {
  const d = dow(date);
  if (wh && wh.from && wh.to && Array.isArray(wh.days)) {
    if (!wh.days.includes(d)) return null;
    const from = toMinutes(wh.from);
    const to = toMinutes(wh.to);
    return to > from ? { from, to } : null;
  }
  if (d <= 5) return { from: 7 * 60, to: 21 * 60 };
  if (d === 6) return { from: 8 * 60, to: 14 * 60 };
  return null;
}

/** Zajęte przedziały dnia (bez odwołanych), scalone i posortowane. */
export function busyOn(
  appts: Pick<Appointment, "date" | "time" | "duration" | "status">[],
  date: ISODate,
): Span[] {
  const spans = appts
    .filter((a) => a.date === date && a.status !== "cancel" && a.time)
    .map((a) => ({
      from: toMinutes(a.time),
      to: toMinutes(a.time) + (a.duration || DEFAULT_APPT_MIN),
    }))
    .sort((a, b) => a.from - b.from);
  const out: Span[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s.from <= last.to) last.to = Math.max(last.to, s.to);
    else out.push({ ...s });
  }
  return out;
}

/**
 * Wolne okienka ≥ `min` minut w godzinach pracy. `notBefore` — dziś: nie wcześniej niż teraz
 * (zaokrąglone w górę do pełnych 15 min). Urlop (`off`) — brak okienek.
 */
export function freeSlots(
  appts: Pick<Appointment, "date" | "time" | "duration" | "status">[],
  date: ISODate,
  wh?: WorkHours | null,
  opts: {
    min?: number;
    notBefore?: number;
    off?: { from: ISODate; to: ISODate } | null;
  } = {},
): Span[] {
  const h = hoursOn(date, wh);
  if (!h) return [];
  if (
    opts.off &&
    opts.off.from &&
    opts.off.to &&
    date >= opts.off.from &&
    date <= opts.off.to
  )
    return [];
  const min = opts.min ?? MIN_FREE;
  const start =
    opts.notBefore != null
      ? Math.max(h.from, Math.ceil(opts.notBefore / 15) * 15)
      : h.from;
  const out: Span[] = [];
  let cur = start;
  for (const b of busyOn(appts, date)) {
    if (b.to <= cur) continue;
    if (b.from >= h.to) break;
    if (b.from - cur >= min) out.push({ from: cur, to: b.from });
    cur = Math.max(cur, b.to);
  }
  if (h.to - cur >= min) out.push({ from: cur, to: h.to });
  return out;
}

const DOW_SHORT = ["pn", "wt", "śr", "czw", "pt", "sob", "nd"];
export const dowShort = (date: ISODate) => DOW_SHORT[dow(date) - 1];

/** 840 → „14”, 870 → „14:30”. */
export const hourLabel = (m: number) =>
  m % 60
    ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`
    : String(Math.floor(m / 60));
/** 840 → „14:00”. */
export const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** „wt 14–16” */
export const slotLabel = (date: ISODate, s: Span) =>
  `${dowShort(date)} ${hourLabel(s.from)}–${hourLabel(s.to)}`;

/** Najbliższe wolne okienka od teraz do końca `days` dni (domyślnie do niedzieli bieżącego tygodnia). */
export function nextFree(
  appts: Pick<Appointment, "date" | "time" | "duration" | "status">[],
  today: ISODate,
  nowMin: number,
  wh?: WorkHours | null,
  opts: {
    limit?: number;
    until?: ISODate;
    off?: { from: ISODate; to: ISODate } | null;
  } = {},
): { date: ISODate; slot: Span }[] {
  const until = opts.until ?? addDays(weekStart(today), 6);
  const out: { date: ISODate; slot: Span }[] = [];
  for (
    let d = today;
    d <= until && out.length < (opts.limit ?? 3);
    d = addDays(d, 1)
  ) {
    for (const slot of freeSlots(appts, d, wh, {
      notBefore: d === today ? nowMin : undefined,
      off: opts.off,
    })) {
      out.push({ date: d, slot });
      if (out.length >= (opts.limit ?? 3)) break;
    }
  }
  return out;
}

/** Podsumowanie tygodnia na Pulpit: liczba wizyt (pon–nd, bez odwołanych) i najbliższe wolne okienka. */
export function weekSummary(
  appts: Pick<Appointment, "date" | "time" | "duration" | "status">[],
  today: ISODate,
  nowMin: number,
  wh?: WorkHours | null,
  off?: { from: ISODate; to: ISODate } | null,
): {
  visits: number;
  free: { date: ISODate; slot: Span }[];
  nextWeek: boolean;
  label: string;
} {
  const ws = weekStart(today);
  const we = addDays(ws, 6);
  const visits = appts.filter(
    (a) => a.date >= ws && a.date <= we && a.status !== "cancel",
  ).length;
  // pod koniec tygodnia (brak okienek) — najbliższe z następnego tygodnia
  let free = nextFree(appts, today, nowMin, wh, { off });
  let nextWeek = false;
  if (!free.length) {
    free = nextFree(appts, addDays(we, 1), 0, wh, {
      off,
      until: addDays(we, 7),
    });
    nextWeek = free.length > 0;
  }
  const n =
    visits === 1
      ? "wizyta"
      : visits % 10 >= 2 &&
          visits % 10 <= 4 &&
          (visits % 100 < 10 || visits % 100 >= 20)
        ? "wizyty"
        : "wizyt";
  const label = `Ten tydzień: ${visits} ${n}${free.length ? `, wolne${nextWeek ? " w przyszłym tygodniu" : ""}: ${free.map((f) => slotLabel(f.date, f.slot)).join(", ")}` : ""}`;
  return { visits, free, nextWeek, label };
}

/** Zakres osi godzin widoku Dzień: godziny pracy, poszerzone (do pełnych godzin) o wizyty spoza nich. */
export function axisRange(
  appts: Pick<Appointment, "date" | "time" | "duration" | "status">[],
  date: ISODate,
  wh?: WorkHours | null,
): Span {
  const h = hoursOn(date, wh) ?? { from: 8 * 60, to: 18 * 60 };
  let from = h.from;
  let to = h.to;
  for (const a of appts) {
    if (a.date !== date || !a.time) continue;
    const s = toMinutes(a.time);
    from = Math.min(from, s);
    to = Math.max(to, s + (a.duration || DEFAULT_APPT_MIN));
  }
  return {
    from: Math.floor(from / 60) * 60,
    to: Math.min(24 * 60, Math.ceil(to / 60) * 60),
  };
}

/** Rozkład nakładających się wizyt na kolumny (kolizje obok siebie): lane i liczba kolumn w grupie. */
export function lanes<T extends { time: string; duration?: number }>(
  items: T[],
): { item: T; from: number; to: number; lane: number; of: number }[] {
  const sorted = items
    .map((item) => ({
      item,
      from: toMinutes(item.time),
      to: toMinutes(item.time) + (item.duration || DEFAULT_APPT_MIN),
      lane: 0,
      of: 1,
    }))
    .sort((a, b) => a.from - b.from || b.to - a.to);
  let group: typeof sorted = [];
  let groupEnd = -1;
  const close = () => {
    const of = Math.max(1, ...group.map((g) => g.lane + 1));
    group.forEach((g) => (g.of = of));
  };
  for (const x of sorted) {
    if (x.from >= groupEnd && group.length) {
      close();
      group = [];
    }
    const used = new Set(group.filter((g) => g.to > x.from).map((g) => g.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    x.lane = lane;
    group.push(x);
    groupEnd = Math.max(groupEnd, x.to);
  }
  if (group.length) close();
  return sorted;
}
