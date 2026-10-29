import { fnum, plural } from '../format';
import { NOT_RUN, parseKm } from './running';

/**
 * Gdzie wstawić bieg z zegarka w formularzu treningu (trener).
 * Odcinki wczytane z jednostki planu mają wartości planu (`planned`), nie wykonanie — import je ZASTĘPUJE,
 * zamiast dopisywać drugi „Bieg” (inaczej kilometraż liczyłby się dwa razy).
 */
export interface DraftSeg {
  reps?: string;
  dist?: string;
  hr?: string;
  /** Wartości wczytane z planu, nieruszone przez trenera. */
  planned?: boolean;
  label?: string;
  warmup?: boolean;
  tPace?: string;
}
export interface DraftRow {
  name: string;
  cardio?: boolean;
  series?: DraftSeg[];
}

const filled = (x: DraftSeg) => !!((x.reps ?? '').trim() || (x.dist ?? '').trim() || (x.hr ?? '').trim());

/** Wiersz cardio, który można nadpisać: pusty (bez km / tętna) albo tylko z wartościami planu. */
function replaceable(r: DraftRow, sport: string): 'empty' | 'plan' | null {
  if (!r.cardio || !r.name.trim()) return null;
  if (NOT_RUN.test(r.name) !== NOT_RUN.test(sport)) return null; // bieg nie zastąpi roweru z rozgrzewki
  const s = r.series ?? [];
  if (s.some((x) => (x.hr ?? '').trim())) return null;
  const vals = s.filter(filled);
  if (vals.length && vals.every((x) => x.planned)) return 'plan';
  if (!s.some((x) => (x.dist ?? '').trim())) return 'empty';
  return null;
}

const isHead = (x: DraftSeg) => !!x.warmup || x.label === 'Rozgrzewka';
const isTail = (x: DraftSeg) => x.label === 'Schłodzenie';

/**
 * Okrążenia z zegarka na odcinki planu: rozgrzewka → pierwsze okrążenie, schłodzenie → ostatnie,
 * środek 1:1 albo „odcinek, przerwa, odcinek…” (okrążenia truchtu oznaczone jako przerwa).
 * Zwraca odcinki z etykietami i celami planu, a gdy układ się nie zgadza — null (zwykłe zastąpienie).
 */
export function mapLaps<S extends DraftSeg>(plan: DraftSeg[], laps: S[]): { segs: S[]; text: string } | null {
  const p = plan.filter(filled);
  if (!p.length || !laps.length) return null;
  const head = isHead(p[0]) ? 1 : 0;
  const tail = p.length > head && isTail(p[p.length - 1]) ? 1 : 0;
  const mid = p.slice(head, p.length - tail);
  const lmid = laps.slice(head, laps.length - tail);
  if (!mid.length || !lmid.length) return null;
  const keep = (x: S, q: DraftSeg): S => ({ ...x, label: q.label, warmup: q.warmup, tPace: q.tPace, planned: undefined });
  const ends = (out: S[]) => [...(head ? [keep(laps[0], p[0])] : []), ...out, ...(tail ? [keep(laps[laps.length - 1], p[p.length - 1])] : [])];
  const parts = [head && 'rozgrzewka', '', tail && 'schłodzenie'];
  const say = (m: string) => [parts[0], m, parts[2]].filter(Boolean).join(', ');
  if (lmid.length === mid.length) return { segs: ends(lmid.map((x, k) => keep(x, mid[k]))), text: say(`${mid.length} ${plural(mid.length, 'odcinek', 'odcinki', 'odcinków')} po kolei`) };
  if (!mid.some((x) => x.label === 'Przerwa') && lmid.length === 2 * mid.length - 1)
    return {
      segs: ends(lmid.map((x, k) => (k % 2 ? { ...x, label: 'Przerwa', warmup: undefined, planned: undefined } : keep(x, mid[k / 2])))),
      text: say(`${mid.length} ${plural(mid.length, 'odcinek', 'odcinki', 'odcinków')} z przerwami (trucht)`),
    };
  return null;
}

export interface ImportTarget {
  /** Indeks (wśród wierszy z nazwą) ćwiczenia, które dostanie odcinki; −1 → nowe ćwiczenie. */
  fill: number;
  /** Pozostałe ćwiczenia cardio z samymi wartościami planu — usuwane (bieg z zegarka obejmuje cały trening). */
  drop: number[];
  /** Odcinki planu wypełnione kolejnymi okrążeniami — zostają etykiety (rozgrzewka, przerwa…) i cele. */
  oneToOne: boolean;
}

export function importTarget(rows: DraftRow[], sport: string, segs: number | DraftSeg[]): ImportTarget {
  const kept = rows.filter((r) => r.name.trim());
  const kinds = kept.map((r) => replaceable(r, sport));
  const plan = kinds.flatMap((k, i) => (k === 'plan' ? [i] : []));
  const fill = plan.length ? plan[0] : kinds.indexOf('empty');
  const drop = plan.slice(1);
  const laps = typeof segs === 'number' ? Array.from({ length: segs }, () => ({}) as DraftSeg) : segs;
  const oneToOne = plan.length === 1 && !!mapLaps(kept[fill].series ?? [], laps);
  return { fill, drop, oneToOne };
}

/** Wstawia zaimportowane ćwiczenie cardio do formularza (patrz `importTarget`). Puste wiersze bez nazwy znikają. */
export function fillCardioRows<T extends DraftRow>(rows: T[], imported: T): T[] {
  const kept = rows.filter((r) => r.name.trim());
  const segs = imported.series ?? [];
  const t = importTarget(kept, imported.name, segs);
  if (t.fill < 0) return [...kept, imported];
  return kept.flatMap((r, j) => {
    if (t.drop.includes(j)) return [];
    if (j !== t.fill) return [r];
    const series = (t.oneToOne && mapLaps(r.series ?? [], segs)?.segs) || segs;
    return [{ ...r, series }];
  });
}

/** Opis do podglądu importu: co zostanie zastąpione albo dodane. */
export function importTargetText(rows: DraftRow[], sport: string, segs: number): string {
  const kept = rows.filter((r) => r.name.trim());
  const t = importTarget(kept, sport, segs);
  const n = (k: number) => `${k} ${plural(k, 'odcinek', 'odcinki', 'odcinków')}`;
  if (t.fill < 0) return `Doda ćwiczenie „${sport}” (${n(segs)}).`;
  const replaced = [t.fill, ...t.drop].map((i) => kept[i]);
  const planned = replaced.flatMap((r) => (r.series ?? []).filter(filled));
  if (!planned.length) return `Wypełni „${kept[t.fill].name}” (${n(segs)}).`;
  const km = planned.reduce((a, x) => a + (parseKm(x.dist) ?? 0), 0);
  const what = replaced.map((r) => `„${r.name}”`).join(', ');
  if (t.oneToOne) {
    const m = mapLaps(kept[t.fill].series ?? [], Array.from({ length: segs }, () => ({}) as DraftSeg));
    return `Zastąpi wartości planu w ${what} kolejnymi okrążeniami (${n(segs)}): ${m?.text}.`;
  }
  return `Zastąpi odcinki z planu: ${what} (${n(planned.length)}${km ? `, ${fnum(km, 2)} km` : ''}) — ${n(segs)} z pliku.`;
}
