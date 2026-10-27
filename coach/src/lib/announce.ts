/**
 * Zapowiedź następnej serii w odtwarzaczu: duży napis po końcu przerwy („Seria 3 — przysiad 60 kg × 8”)
 * i tekst do syntezy mowy („Następna seria: przysiad, 60 kilogramów, 8 powtórzeń”). Testy: announce.test.ts.
 */
import { plural } from '../format';
import { num, sidesOf } from './parse';
import { runBlocks, type Run } from './run';

export interface NextSetInfo {
  k: number;
  i: number;
  /** Numer serii roboczej (1…) albo null dla rozgrzewki. */
  n: number | null;
  name: string;
  load: number | null;
  reps: string;
  unit?: 's' | 'min';
  cardio?: boolean;
}

/** Następna niezaliczona seria: wskazana (obwód) albo pierwsza w bieżącym bloku, a gdy blok zrobiony — w kolejnym. */
export function nextSetInfo(run: Run, prefer?: { k: number; i: number } | null): NextSetInfo | null {
  const pick = (k: number, i: number): NextSetInfo | null => {
    const e = run.ex[k];
    const s = e?.sets[i];
    if (!e || !s || s.done) return null;
    const n = s.warmup ? null : e.sets.slice(0, i + 1).filter((x) => !x.warmup).length;
    return { k, i, n, name: e.name, load: num(s.load), reps: s.reps.trim(), unit: s.unit, cardio: e.cardio };
  };
  if (prefer) {
    const p = pick(prefer.k, prefer.i);
    if (p) return p;
  }
  const blocks = runBlocks(run);
  const bi = Math.max(0, blocks.findIndex((b) => b.includes(run.idx)));
  for (const b of [...blocks.slice(bi), ...blocks.slice(0, bi)])
    for (const k of b) {
      const i = run.ex[k].sets.findIndex((x) => !x.done);
      if (i >= 0) return pick(k, i);
    }
  return null;
}

const lowerFirst = (t: string) => (t && t[0] !== t[0].toLowerCase() && t[1] === t[1]?.toLowerCase() ? t[0].toLowerCase() + t.slice(1) : t);
const nf = (v: number) => v.toLocaleString('pl-PL', { maximumFractionDigits: 2 });

/** Duży napis: „Seria 3 — przysiad 60 kg × 8” (deska: „× 30 s”). */
export function flashText(x: NextSetInfo): string {
  const head = x.n == null ? 'Rozgrzewka' : `Seria ${x.n}`;
  const unit = x.unit === 's' ? ' s' : x.unit === 'min' ? ' min' : '';
  const what = [x.load != null && x.load > 0 && !x.cardio ? `${nf(x.load)} kg` : '', x.reps ? `${x.load != null && x.load > 0 && !x.cardio ? '× ' : ''}${x.reps}${unit}` : ''].filter(Boolean).join(' ');
  return `${head} — ${lowerFirst(x.name)}${what ? ` ${what}` : ''}`;
}

/** Tekst do przeczytania: „Następna seria: przysiad, 60 kilogramów, 8 powtórzeń”. */
export function speechText(x: NextSetInfo): string {
  const parts = [lowerFirst(x.name)];
  if (x.load != null && x.load > 0 && !x.cardio) {
    const int = Number.isInteger(x.load);
    parts.push(`${nf(x.load)} ${int ? plural(x.load, 'kilogram', 'kilogramy', 'kilogramów') : 'kilograma'}`);
  }
  const lr = sidesOf(x.reps);
  const r = lr ? lr[0] : num(x.reps);
  if (r != null && r > 0) {
    if (x.unit === 's') parts.push(`${nf(r)} ${plural(r, 'sekunda', 'sekundy', 'sekund')}${lr ? ' na stronę' : ''}`);
    else if (x.unit === 'min') parts.push(`${nf(r)} ${Number.isInteger(r) ? plural(r, 'minuta', 'minuty', 'minut') : 'minuty'}`);
    else parts.push(`${nf(r)} ${plural(r, 'powtórzenie', 'powtórzenia', 'powtórzeń')}${lr ? ' na stronę' : ''}`);
  }
  return `${x.n == null ? 'Rozgrzewka' : 'Następna seria'}: ${parts.join(', ')}`;
}
