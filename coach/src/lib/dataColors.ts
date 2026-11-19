import { cardioByName } from './run';

/**
 * Paleta danych (tokeny w src/styles/tokens-data.css). Kolor danych jest zawsze obok liczby albo słowa,
 * nigdy zamiast nich. Te funkcje mówią tylko, który krok / rodzaj pokazać.
 */

/** Poziom RPE w pięciu krokach: 1 = RPE ≤ 6, 2 = 7, 3 = 8, 4 = 9, 5 = 10. Tokeny: --rpe-1 … --rpe-5. */
export type RpeLevel = 1 | 2 | 3 | 4 | 5;

/**
 * Krok RPE z zapisu w planie: „8”, „8,5”, „@8”, „RPE 9”, „7-8” / „7–8” (bierzemy górną wartość zakresu).
 * Połówki idą w górę („7,5” = krok RPE 8). Pusto, RIR, tekst albo liczba spoza 1–10: null (bez koloru).
 */
export function rpeLevel(rpe: string | number | null | undefined): RpeLevel | null {
  if (rpe == null) return null;
  let v: number;
  if (typeof rpe === 'number') v = rpe;
  else {
    const t = rpe.trim().toLowerCase();
    if (!t || /rir/.test(t)) return null;
    const m = t.replace(/^(rpe\s*|@\s*)/, '').match(/^(\d+(?:[.,]\d+)?)(?:\s*[-–—/]\s*(\d+(?:[.,]\d+)?))?$/);
    if (!m) return null;
    v = parseFloat((m[2] ?? m[1]).replace(',', '.'));
  }
  if (!Number.isFinite(v) || v <= 0 || v > 10) return null;
  const c = Math.ceil(v - 1e-9);
  return c <= 6 ? 1 : ((c - 5) as RpeLevel);
}

/** Rodzaj jednostki do paska typu (tokeny --kind-*): siła, dwubój (rwanie / podrzut), bieg, rehabilitacja i mobilność, inne. */
export type SessionKind = 'sila' | 'dwuboj' | 'bieg' | 'rehab' | 'inne';

export const SESSION_KIND_LABEL: Record<SessionKind, string> = {
  sila: 'Siła',
  dwuboj: 'Dwubój',
  bieg: 'Bieg',
  rehab: 'Rehab i mobilność',
  inne: 'Inne',
};

const OLY = /rwani|podrzut|zarzut|snatch|clean|jerk|dwub[oó]j|olimp/i;
const REHAB = /rehab|mobiln|mobiliz|rozci[aą]g|stretch|\bjoga|\byoga|fizjo|rolowan|roller|oddech|\bmobility/i;
const RUN_NAME = /\bbieg|bieganie|\brun\b|interwa[lł]y biegowe|przebie[zż]k/i;

type ExLike = { name: string; cardio?: boolean };
type WorkoutLike = { name?: string; exercises?: ExLike[] };

/**
 * Rodzaj jednostki z nazwy treningu i nazw ćwiczeń. Przyjmuje trening ({ name, exercises }), listę ćwiczeń
 * albo samą listę nazw. Nazwa treningu wygrywa („Mobilność”, „Bieg Z2”), potem większość ćwiczeń;
 * jeden ruch olimpijski na każde dwa siłowe wystarczy na „dwubój”.
 */
export function sessionKind(input: WorkoutLike | ExLike[] | string[] | null | undefined): SessionKind {
  if (!input) return 'inne';
  const w: WorkoutLike = Array.isArray(input) ? { exercises: input.map((x) => (typeof x === 'string' ? { name: x } : x)) } : input;
  const title = (w.name ?? '').trim();
  if (title) {
    if (REHAB.test(title)) return 'rehab';
    if (OLY.test(title)) return 'dwuboj';
    if (RUN_NAME.test(title)) return 'bieg';
  }
  let sila = 0;
  let oly = 0;
  let run = 0;
  let rehab = 0;
  for (const e of w.exercises ?? []) {
    const n = e.name.trim();
    if (!n) continue;
    if (e.cardio ?? cardioByName(n)) run++;
    else if (OLY.test(n)) oly++;
    else if (REHAB.test(n)) rehab++;
    else sila++;
  }
  const all = sila + oly + run + rehab;
  if (!all) return 'inne';
  if (run * 2 > all) return 'bieg';
  if (oly && oly * 2 >= sila) return 'dwuboj';
  if (rehab * 2 > all) return 'rehab';
  if (sila + oly) return 'sila';
  return run >= rehab ? 'bieg' : 'rehab';
}
