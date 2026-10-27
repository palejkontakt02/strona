/**
 * Automatyczne wiadomości od trenera do podopiecznego (wyzwalane zdarzeniem).
 * Czysta logika „co należy dziś wysłać” — tę samą regułę liczy baza (hardening.sql, sekcja 25,
 * funkcja auto_messages_run, codziennie o 9:00 czasu polskiego). Tu: podgląd w aplikacji i testy.
 *
 * Zasady wspólne (TS i SQL):
 * - tylko podopieczni z e-mailem (konto w aplikacji); status „zakończony” — nic, „pauza” — tylko urodziny;
 * - zdarzenia jednorazowe (pierwszy trening, N-ty trening, rekord) liczą się, gdy wypadły w ciągu ostatnich
 *   2 dni (OKNO_DNI) — włączenie reguły nie wysyła zaległych gratulacji sprzed miesięcy;
 * - każde zdarzenie (klient + reguła + klucz) wysyłane raz (dziennik wysłanych);
 * - najwyżej jedna automatyczna wiadomość na podopiecznego dziennie (kolejność: PRIORYTET);
 *   pozostałe, jeśli wciąż aktualne, pójdą kolejnego dnia.
 */
import type { Client, ISODate, TrainingSession } from '../domain';
import { packageStatus } from './billing';
import { validAbsences } from './absence';
import { addDays, daysBetween, todayISO } from './dates';
import { records } from './strength';
import { plural } from '../format';

export type AutoKind = 'first' | 'inactive' | 'record' | 'package' | 'birthday' | 'milestone';

export interface AutoRule {
  on: boolean;
  text: string;
  /** inactive: liczba dni bez treningu (domyślnie 7). */
  days?: number;
  /** package: wysyłka, gdy w pakiecie zostało ≤ N treningów (domyślnie 2). */
  left?: number;
  /** milestone: które treningi z kolei (domyślnie 10, 25, 50, 100). */
  counts?: number[];
}

export type AutoRules = Record<AutoKind, AutoRule>;

/** Wpis dziennika wysłanych (tabela auto_message_log). */
export interface AutoSent {
  clientId: string;
  kind: AutoKind;
  key: string;
  at: string;
  text?: string;
}

export interface AutoDue {
  clientId: string;
  kind: AutoKind;
  /** Klucz zdarzenia (deduplikacja): np. data ostatniego treningu, id pakietu, rok urodzin. */
  key: string;
  text: string;
}

export const AUTO_KINDS: AutoKind[] = ['first', 'inactive', 'record', 'package', 'birthday', 'milestone'];

/** Kolejność, gdy jednego dnia pasuje kilka reguł (wysyłamy jedną). */
export const PRIORITY: AutoKind[] = ['birthday', 'first', 'milestone', 'record', 'package', 'inactive'];

export const OKNO_DNI = 2;
/** „X dni bez treningu” wysyłamy, gdy przerwa ma od X do X + 30 dni (dawno nieaktywni — bez wiadomości). */
export const INACTIVE_SPAN = 30;
/** Rekord: nie częściej niż co tyle dni u jednego podopiecznego. */
export const RECORD_GAP_DAYS = 2;

export const AUTO_META: Record<AutoKind, { title: string; when: string; fields: string[] }> = {
  first: { title: 'Pierwszy trening', when: 'Po pierwszym zapisanym treningu podopiecznego.', fields: ['imię'] },
  inactive: { title: 'Przerwa w treningach', when: 'Po X dniach bez treningu. Nie idzie przy pauzie, zakończonej współpracy ani gdy w tym czasie była zgłoszona nieobecność.', fields: ['imię', 'dni'] },
  record: { title: 'Nowy rekord', when: 'Po treningu z rekordem (szacowany 1RM wyższy niż dotąd).', fields: ['imię', 'ćwiczenie', 'wynik'] },
  package: { title: 'Kończy się pakiet', when: 'Gdy w pakiecie zostało N treningów lub mniej — raz na pakiet.', fields: ['imię', 'zostało'] },
  birthday: { title: 'Urodziny', when: 'Rano w dniu urodzin (data urodzenia w profilu).', fields: ['imię'] },
  milestone: { title: 'Okrągła liczba treningów', when: 'Po 10., 25., 50., 100. treningu (liczby do zmiany).', fields: ['imię', 'liczba'] },
};

export const DEFAULT_TEXT: Record<AutoKind, string> = {
  first: '{imię}, pierwszy trening za Tobą. Dobra robota! Daj znać, jak się czujesz i czy coś było niejasne.',
  inactive: '{imię}, minęło {dni} dni od ostatniego treningu. Wszystko w porządku? Napisz, jeśli coś się zmieniło — razem ustalimy, jak wrócić do rytmu.',
  record: '{imię}, nowy rekord: {ćwiczenie} — {wynik}. Świetna robota, tak trzymaj.',
  package: '{imię}, w pakiecie masz jeszcze {zostało}. Jeśli chcesz trenować dalej bez przerwy, daj znać — przygotuję kolejny.',
  birthday: '{imię}, wszystkiego najlepszego z okazji urodzin! Dużo zdrowia i siły — na treningu i poza nim.',
  milestone: '{imię}, to był Twój {liczba}. trening. Kawał solidnej pracy — tak trzymaj.',
};

export const DEFAULT_RULES: AutoRules = {
  first: { on: false, text: DEFAULT_TEXT.first },
  inactive: { on: false, text: DEFAULT_TEXT.inactive, days: 7 },
  record: { on: false, text: DEFAULT_TEXT.record },
  package: { on: false, text: DEFAULT_TEXT.package, left: 2 },
  birthday: { on: false, text: DEFAULT_TEXT.birthday },
  milestone: { on: false, text: DEFAULT_TEXT.milestone, counts: [10, 25, 50, 100] },
};

const intIn = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : d);

/** Liczby kolejnych treningów z tekstu („10, 25, 50”) — rosnąco, bez powtórzeń, 2–1000. */
export function parseCounts(v: unknown): number[] {
  const list = Array.isArray(v) ? v : String(v ?? '').split(/[^\d]+/);
  return [...new Set(list.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n >= 2 && n <= 1000))].sort((a, b) => a - b).slice(0, 20);
}

/** Reguły z bazy / localStorage uzupełnione domyślnymi (brak albo zły zapis = reguła wyłączona). */
export function normalizeRules(raw: unknown): AutoRules {
  const r = (raw && typeof raw === 'object' ? (raw as { rules?: unknown }).rules ?? raw : {}) as Record<string, Partial<AutoRule> | undefined>;
  const out = {} as AutoRules;
  for (const k of AUTO_KINDS) {
    const x = r[k] && typeof r[k] === 'object' ? r[k]! : {};
    const text = typeof x.text === 'string' && x.text.trim() ? x.text.slice(0, 1000) : DEFAULT_TEXT[k];
    out[k] = { ...DEFAULT_RULES[k], on: x.on === true, text };
    if (k === 'inactive') out[k].days = intIn(x.days, 3, 90, 7);
    if (k === 'package') out[k].left = intIn(x.left, 1, 10, 2);
    if (k === 'milestone') {
      const c = parseCounts(x.counts);
      out[k].counts = c.length ? c : DEFAULT_RULES.milestone.counts;
    }
  }
  return out;
}

/** Zapis reguł (to samo trafia do bazy, kolumna data tabeli auto_message_rules). */
export const rulesPayload = (rules: AutoRules) => ({ v: 1, rules });

export type AutoVars = Partial<Record<'imię' | 'dni' | 'ćwiczenie' | 'wynik' | 'zostało' | 'liczba', string | number>>;

const ALIASES: Record<string, keyof AutoVars> = { imie: 'imię', cwiczenie: 'ćwiczenie', zostalo: 'zostało' };

/** Wstawia pola {imię}, {dni}… (także bez polskich znaków: {imie}, {cwiczenie}, {zostalo}). Nieznane pola zostają. */
export function fillTemplate(text: string, vars: AutoVars): string {
  return text.replace(/\{([^{}]{1,20})\}/g, (all, name: string) => {
    const k = (ALIASES[name.trim().toLowerCase()] ?? name.trim().toLowerCase()) as keyof AutoVars;
    const v = vars[k];
    return v == null ? all : String(v);
  }).trim();
}

/** Liczba po polsku: „102,5”, „100”. */
export const fmtNum = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

/** „2 treningi”, „1 trening”, „5 treningów”. */
export const treningi = (n: number) => `${n} ${plural(n, 'trening', 'treningi', 'treningów')}`;

export const firstName = (c: Pick<Client, 'name'>) => c.name.trim().split(/\s+/)[0] || 'Cześć';

/**
 * Zgłoszona nieobecność (client.absences, „Wypadam z planu”) w ostatnich `days` dniach (do dziś włącznie) —
 * przerwa jest wyjaśniona, bez wiadomości. Odwołane nieobecności (to < from) się nie liczą.
 */
export function absentRecently(c: Pick<Client, 'absences'>, today: ISODate, days = 1): boolean {
  const since = addDays(today, -Math.max(1, days) + 1);
  return validAbsences(c.absences).some((a) => a.from <= today && a.to >= since);
}

/** Urodziny dziś (29 lutego — 28 lutego w latach nieprzestępnych). */
export function isBirthday(dob: string | undefined, today: ISODate): boolean {
  if (!dob || !/^\d{4}-\d{2}-\d{2}/.test(dob)) return false;
  const md = dob.slice(5, 10);
  const t = today.slice(5, 10);
  if (md === t) return true;
  const y = Number(today.slice(0, 4));
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return md === '02-29' && t === '02-28' && !leap;
}

const inWindow = (d: string, today: ISODate) => d <= today && d >= addDays(today, -OKNO_DNI);

/** Zdarzenia, które pasują dziś dla jednego podopiecznego (bez deduplikacji), w kolejności PRIORYTET. */
export function clientEvents(c: Client, sessions: TrainingSession[], rules: AutoRules, today: ISODate, sent: AutoSent[] = [], now = new Date()): AutoDue[] {
  if (c.status === 'zakończony' || !c.email?.trim()) return [];
  const paused = c.status === 'pauza';
  const name = firstName(c);
  const asc = sessions.filter((s) => s.clientId === c.id && /^\d{4}-\d{2}-\d{2}/.test(s.date) && s.date <= today).sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  const out: AutoDue[] = [];
  const add = (kind: AutoKind, key: string, vars: AutoVars) => out.push({ clientId: c.id, kind, key, text: fillTemplate(rules[kind].text, { imię: name, ...vars }) });

  if (rules.birthday.on && isBirthday(c.dob, today)) add('birthday', today.slice(0, 4), {});
  if (paused) return out;

  if (rules.first.on && asc.length >= 1 && inWindow(asc[0].date, today)) add('first', 'first', {});

  if (rules.milestone.on) {
    const m = [...(rules.milestone.counts ?? [])].reverse().find((n) => asc.length >= n && inWindow(asc[n - 1].date, today));
    if (m) add('milestone', String(m), { liczba: m });
  }

  if (rules.record.on) {
    const recent = sent.some((x) => x.clientId === c.id && x.kind === 'record' && now.getTime() - new Date(x.at).getTime() < RECORD_GAP_DAYS * 86_400_000);
    if (!recent) {
      // rekordy z ostatnich dni — najnowszy trening; w nim rekord o największym przyroście
      const hits = records(asc).filter((r) => inWindow(r.date, today));
      if (hits.length) {
        const day = hits[0].date;
        const best = hits.filter((r) => r.date === day).sort((a, b) => b.gain - a.gain)[0];
        const sid = [...asc].reverse().find((s) => s.date === day && s.exercises.some((e) => e.name === best.name))?.id ?? day;
        const load = typeof best.load === 'number' ? best.load : Number(String(best.load ?? '').replace(',', '.'));
        const reps = typeof best.reps === 'number' ? best.reps : parseInt(String(best.reps ?? ''), 10);
        const wynik = Number.isFinite(load) && load > 0 ? `${fmtNum(load)} kg${Number.isFinite(reps) && reps > 0 ? ` × ${reps}` : ''}` : `szac. 1RM ${fmtNum(Math.round(best.e1 * 10) / 10)} kg`;
        add('record', sid, { ćwiczenie: best.name, wynik });
      }
    }
  }

  if (rules.package.on) {
    const pk = packageStatus(c, sessions.filter((s) => s.clientId === c.id));
    const last = [...c.payments.filter((p) => p.type === 'pakiet')].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
    if (pk && last && pk.left >= 1 && pk.left <= (rules.package.left ?? 2)) add('package', last.id || last.date, { zostało: treningi(pk.left) });
  }

  if (rules.inactive.on && asc.length && !absentRecently(c, today, rules.inactive.days ?? 7)) {
    const X = rules.inactive.days ?? 7;
    const lastDate = asc[asc.length - 1].date.slice(0, 10);
    const d = daysBetween(lastDate, today);
    if (d >= X && d <= X + INACTIVE_SPAN) add('inactive', lastDate, { dni: d });
  }

  return out.sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind));
}

/**
 * Co wysłać dziś: dla każdego podopiecznego pierwsze (wg PRIORYTET) zdarzenie, którego jeszcze nie wysłano
 * (klient + reguła + klucz). Najwyżej jedna wiadomość na podopiecznego.
 */
export function dueMessages(db: { clients: Client[]; sessions: TrainingSession[] }, rules: AutoRules, today: ISODate, sent: AutoSent[] = [], now = new Date()): AutoDue[] {
  const done = new Set(sent.map((s) => `${s.clientId}|${s.kind}|${s.key}`));
  // dziś już coś poszło (np. drugie „Sprawdź teraz”) — kolejna wiadomość dopiero jutro
  const today_ = new Set(sent.filter((s) => s.at && todayISO(new Date(s.at)) === today).map((s) => s.clientId));
  const out: AutoDue[] = [];
  for (const c of db.clients) {
    if (today_.has(c.id)) continue;
    const ev = clientEvents(c, db.sessions, rules, today, sent, now).find((e) => !done.has(`${e.clientId}|${e.kind}|${e.key}`));
    if (ev) out.push(ev);
  }
  return out;
}

/** Przykładowe wartości pól do podglądu treści. */
export function sampleVars(kind: AutoKind, rules: AutoRules, name = 'Ania'): AutoVars {
  return {
    imię: name,
    dni: rules.inactive.days ?? 7,
    ćwiczenie: 'Przysiad ze sztangą',
    wynik: '100 kg × 5',
    zostało: treningi(Math.min(rules.package.left ?? 2, 2)),
    liczba: kind === 'milestone' ? rules.milestone.counts?.[0] ?? 10 : 10,
  };
}
