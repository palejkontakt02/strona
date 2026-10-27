/**
 * Nieobecności podopiecznego („Wypadam z planu”): urlop, choroba, kontuzja, inne.
 * Czyste funkcje — zakresy dat, karta na Dziś, wiadomość do trenera i seria tygodni,
 * której nie przerywa tydzień w całości objęty nieobecnością. Testy: absence.test.ts.
 */
import type { Absence, AbsenceReason, ISODate, TrainingSession } from '../domain';
import { addDays, daysBetween, weekStart } from './dates';

export const ABSENCE_REASONS: [AbsenceReason, string][] = [
  ['urlop', 'Urlop'],
  ['choroba', 'Choroba'],
  ['kontuzja', 'Kontuzja'],
  ['inne', 'Inne'],
];

const reasonLabel = (r: AbsenceReason) => ABSENCE_REASONS.find(([k]) => k === r)?.[1] ?? 'Nieobecność';

/** Domyślny zakres w formularzu: od dziś przez 7 dni (dziś + 7). */
export function defaultAbsenceRange(today: ISODate): { from: ISODate; to: ISODate } {
  return { from: today, to: addDays(today, 7) };
}

/** Odwołana („Wracam wcześniej” w dniu startu) albo uszkodzona — nie liczy się. */
export const isVoid = (a: Absence) => !a.from || !a.to || a.to < a.from;

/** Ważne nieobecności (bez odwołanych). */
export const validAbsences = (list: Absence[] | undefined): Absence[] => (list ?? []).filter((a) => !isVoid(a));

/** Czy dzień `d` jest objęty nieobecnością. */
export function isAbsent(list: Absence[] | undefined, d: ISODate): boolean {
  return validAbsences(list).some((a) => a.from <= d && d <= a.to);
}

/** Nieobecność trwająca w dniu `today` (najpóźniej kończąca się, gdy nachodzą na siebie). */
export function activeAbsence(list: Absence[] | undefined, today: ISODate): Absence | null {
  const cur = validAbsences(list).filter((a) => a.from <= today && today <= a.to);
  return cur.sort((a, b) => b.to.localeCompare(a.to))[0] ?? null;
}

/** Zaplanowana nieobecność (zaczyna się po dziś) — najbliższa. */
export function upcomingAbsence(list: Absence[] | undefined, today: ISODate): Absence | null {
  return validAbsences(list).filter((a) => a.from > today).sort((a, b) => a.from.localeCompare(b.from))[0] ?? null;
}

/** Sprawdzenie formularza; zwraca komunikat błędu albo null. */
export function absenceProblem(from: string, to: string, today: ISODate): string | null {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from) || !re.test(to)) return 'Wybierz daty od i do.';
  if (to < from) return 'Data „do” jest przed datą „od”.';
  if (to < today) return 'Ta nieobecność już minęła — wybierz dzisiejszą albo przyszłą datę „do”.';
  if (from < addDays(today, -60)) return 'Data „od” najwyżej 60 dni wstecz.';
  if (daysBetween(from, to) > 365) return 'Najwyżej rok naraz.';
  return null;
}

const dm = (d: ISODate) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
const WEEKDAY = ['w niedzielę', 'w poniedziałek', 'we wtorek', 'w środę', 'w czwartek', 'w piątek', 'w sobotę'];
const weekdayOf = (d: ISODate) => new Date(`${d}T12:00:00Z`).getUTCDay();

/** Kiedy wraca (dzień po `to`): „jutro”, „w sobotę”, „08.11”. */
export function returnWord(a: Absence, today: ISODate): string {
  const back = addDays(a.to, 1);
  if (back === addDays(today, 1)) return 'jutro';
  if (back === today) return 'dziś';
  return daysBetween(today, back) <= 6 ? WEEKDAY[weekdayOf(back)] : dm(back);
}

/** Tekst wiadomości do trenera: „Nieobecność: urlop 01.11–07.11 — notatka”. */
export function absenceMessage(a: Absence): string {
  const range = a.from === a.to ? dm(a.from) : `${dm(a.from)}–${dm(a.to)}`;
  return `Nieobecność: ${reasonLabel(a.reason).toLowerCase()} ${range}${a.note?.trim() ? ` — ${a.note.trim()}` : ''}`;
}

/** Wiadomość do trenera po skróceniu („Wracam wcześniej”). */
export function returnMessage(a: Absence, today: ISODate): string {
  return `Wracam wcześniej — ${reasonLabel(a.reason).toLowerCase()} skończony(-a) ${dm(addDays(today, -1))} (było do ${dm(a.to)}). Od dziś trenuję.`;
}

/** Karta na Dziś w czasie nieobecności: tytuł i podtytuł. */
export function absenceCard(a: Absence, today: ISODate): { title: string; text: string } {
  const back = returnWord(a, today);
  const title = `${reasonLabel(a.reason)} do ${dm(a.to)}`;
  const rest = a.reason === 'choroba' ? 'wracaj do zdrowia' : a.reason === 'kontuzja' ? 'oszczędzaj się' : 'odpocznij';
  return { title, text: `${title} — ${rest}. Wracasz ${back}.` };
}

/** „Wracam wcześniej”: nieobecność kończy się wczoraj (start dziś → odwołana: to < from). */
export function endEarly(a: Absence, today: ISODate): Absence {
  return { ...a, to: addDays(today, -1) };
}

/** Czy cały tydzień (pn–nd) od `monday` jest objęty nieobecnością (łącznie z kilkoma nachodzącymi). */
export function weekFullyAbsent(list: Absence[] | undefined, monday: ISODate): boolean {
  for (let i = 0; i < 7; i++) if (!isAbsent(list, addDays(monday, i))) return false;
  return true;
}

/**
 * Seria tygodni z ≥1 treningiem (jak `streak` w lib/load.ts), w której tydzień w całości objęty
 * nieobecnością nie przerywa serii (ani się do niej nie dolicza). Bieżący pusty tydzień też nie przerywa.
 */
export function streakWithAbsences(sessions: Pick<TrainingSession, 'date'>[], today: ISODate, absences: Absence[] | undefined): { weeks: number; sessions: number } {
  const byWeek = new Map<ISODate, number>();
  for (const s of sessions) if (s.date && s.date <= today) byWeek.set(weekStart(s.date), (byWeek.get(weekStart(s.date)) ?? 0) + 1);
  let w = weekStart(today);
  if (!byWeek.has(w)) w = addDays(w, -7);
  let n = 0;
  let cnt = 0;
  const first = [...byWeek.keys()].sort()[0];
  while (first && w >= first) {
    if (byWeek.has(w)) {
      n++;
      cnt += byWeek.get(w)!;
    } else if (!weekFullyAbsent(absences, w)) break;
    w = addDays(w, -7);
  }
  return { weeks: n, sessions: cnt };
}

/** Czy tydzień (poniedziałek) jest „przezroczysty” dla serii — dla kamieni milowych w lib/progress.ts. */
export const absentWeek = (absences: Absence[] | undefined) => (monday: ISODate) => weekFullyAbsent(absences, monday);
