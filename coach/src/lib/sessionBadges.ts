import type { PainSpot, PlanWorkout, RunProfile, SetGroup, SetLog, TrainingSession } from '../domain';
import { painLabel } from './painMap';
import { fmtDur, fmtKm, parseDur, parseKm, planRunTotals, runTotals } from './running';
import { cardioByName } from './run';

/**
 * Wspólne opisy i progi dla list treningów (Treningi u trenera, podgląd treningu, arkusz historii, nagrania).
 * Czyste funkcje — bez Reacta i bazy.
 */

/** Jeden próg kolorów bólu wszędzie: bursztyn 4–5, czerwony ≥ 6 (DESIGN.md: ból = czerwony). */
export type PainTone = 'danger' | 'warn' | 'muted';
export function painTone(level: number | null | undefined): PainTone {
  if (level == null) return 'muted';
  return level >= 6 ? 'danger' : level >= 4 ? 'warn' : 'muted';
}
/** Klasa tekstu dla poziomu bólu (style w styles/listy.css). */
export const painTextClass = (level: number | null | undefined): string => {
  const t = painTone(level);
  return t === 'muted' ? '' : `pain-${t}`;
};

/** Tonaż jednolicie w tonach: „7,1 t” (twarda spacja). */
export function fmtTon(kg: number): string {
  return `${(kg / 1000).toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} t`;
}

/** Bieg / cardio w wierszu: „9 km · 5:12/km” (albo sam czas). Null, gdy trening bez cardio. */
export function runRowText(s: TrainingSession): string | null {
  const t = runTotals(s);
  if (!t || (!t.km && !t.min)) return null;
  const km = t.km >= 1 ? `${t.km.toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}\u00a0km` : t.km ? fmtKm(t.km) : '';
  return [km || (t.min ? fmtDur(t.min) : ''), t.pace].filter(Boolean).join(' · ');
}

/** Miejsca bólu od najmocniejszego: „Kolano P 7, Odcinek lędźwiowy 4”. */
export function spotsText(spots: PainSpot[] | undefined): string {
  return [...(spots ?? [])]
    .filter((x) => x.level > 0)
    .sort((a, b) => b.level - a.level)
    .map((x) => `${painLabel(x)} ${x.level}`)
    .join(', ');
}

/** Najmocniej bolące miejsce przerwanego treningu (z przerwania albo z mapy bólu treningu). */
export function stoppedSpot(s: Pick<TrainingSession, 'stoppedForPain' | 'painMap'>): string {
  const spots = s.stoppedForPain?.spots?.length ? s.stoppedForPain.spots : s.painMap;
  const top = [...(spots ?? [])].filter((x) => x.level > 0).sort((a, b) => b.level - a.level)[0];
  return top ? `${top.area}${top.side ? ` ${top.side}` : ''}` : '';
}

/** „przerwany — ból 7/10 · kolano P” (null, gdy trening nie był przerwany). */
export function stoppedLabel(s: Pick<TrainingSession, 'stoppedForPain' | 'painMap'>): string | null {
  const st = s.stoppedForPain;
  if (!st) return null;
  const where = stoppedSpot(s);
  return `przerwany — ból ${st.level}/10${where ? ` · ${where}` : ''}`;
}

/** Czas serii: „45 s”, „1:30”, „3 min”. */
function timeOf(v: number, unit: 's' | 'min'): string {
  if (unit === 'min') return `${String(v).replace('.', ',')} min`;
  return v >= 60 ? `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, '0')}` : `${v} s`;
}

/**
 * Powtórzenia / czas serii jednolicie: „5”, „5/str.”, „5/5 L/P”, „45 s”, „1:30/str.”, „15/10 s L/P”, „1:30/1:20 L/P”.
 * Bez ciężaru.
 */
export function repsLabel(x: Pick<SetLog, 'reps' | 'repsR' | 'unit'>, perSide?: boolean): string {
  if (x.reps == null) return '?';
  const n = (v: number) => String(v).replace('.', ',');
  if (x.unit) {
    if (x.repsR != null) {
      const sec = x.unit === 's' && (x.reps >= 60 || x.repsR >= 60);
      return sec ? `${timeOf(x.reps, 's')}/${timeOf(x.repsR, 's')} L/P` : `${n(x.reps)}/${n(x.repsR)} ${x.unit} L/P`;
    }
    const t = timeOf(x.reps, x.unit);
    return perSide ? `${t}/str.` : t;
  }
  if (x.repsR != null) return `${n(x.reps)}/${n(x.repsR)} L/P`;
  return perSide ? `${n(x.reps)}/str.` : n(x.reps);
}

/** Różny wynik lewej i prawej strony (np. 3/5) — do wyróżnienia bursztynem. */
export const isAsym = (x: Pick<SetLog, 'reps' | 'repsR'>) => x.reps != null && x.repsR != null && x.reps !== x.repsR;

/** Ćwiczenie w zapisie ma wykonaną pracę (serie robocze albo podsumowanie). */
const hasWork = (e: TrainingSession['exercises'][number]) =>
  e.setsLog?.length ? e.setsLog.some((x) => !x.warmup) : !!(e.sets || e.reps || e.load);

/**
 * Pokrycie planu: ile ćwiczeń jednostki zrobiono. Zwraca { done, total } tylko gdy czegoś brakuje
 * (ćwiczenia pominięte), inaczej null.
 */
export function planCoverage(s: TrainingSession, w: PlanWorkout | undefined): { done: number; total: number } | null {
  if (!w) return null;
  const planned = w.exercises.filter((e) => e.name.trim());
  if (!planned.length) return null;
  const doneNames = new Set(s.exercises.filter(hasWork).map((e) => e.name.trim().toLowerCase()));
  const done = planned.filter((e) => doneNames.has(e.name.trim().toLowerCase())).length;
  return done < planned.length ? { done, total: planned.length } : null;
}

/** Główny odcinek biegu z planu: „6 × 800 m Z5”, „45 min Z2”. */
function mainRunPart(groups: SetGroup[]): string {
  const work = groups.filter((g) => !['Rozgrzewka', 'Schłodzenie', 'Przerwa'].includes(g.type));
  if (!work.length) return '';
  // najdłuższy blok (seria × odcinek)
  const g = [...work].sort((a, b) => (parseInt(b.sets || '1', 10) || 1) - (parseInt(a.sets || '1', 10) || 1))[0];
  const n = Math.max(1, parseInt(g.sets || '1', 10) || 1);
  const km = parseKm(g.load);
  const d = parseDur(g.reps);
  const what = km != null ? fmtKm(km) : d != null ? fmtDur(d) : '';
  if (!what) return '';
  return [n > 1 ? `${n} × ${what}` : what, (g.pace || '').trim()].filter(Boolean).join(' ');
}

/** Opis jednostki planu do listy: bieg „6 × 800 m Z5 · ~9 km · ~50 min”, inaczej „5 ćwiczeń”. */
export function planWorkoutSummary(k: PlanWorkout, run?: RunProfile): string {
  const ex = k.exercises.filter((e) => e.name.trim());
  if (!ex.length) return 'brak ćwiczeń — dodaj je w edycji';
  if (ex.every((e) => e.cardio ?? cardioByName(e.name))) {
    const groups = ex.flatMap((e) => e.groups);
    const t = planRunTotals(groups, run);
    const ap = t.approx ? '~' : '';
    const km = t.km > 0 ? `${ap}${t.km >= 1 ? `${Math.round(t.km).toLocaleString('pl-PL')} km` : fmtKm(t.km)}` : '';
    const min = t.min > 0 ? `${ap}${Math.round(t.min)} min` : '';
    const parts = [ex.length === 1 ? mainRunPart(ex[0].groups) : '', km, min].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'bieg';
  }
  const n = ex.length;
  const d = n % 10;
  const t = n % 100;
  return `${n} ${n === 1 ? 'ćwiczenie' : d >= 2 && d <= 4 && (t < 12 || t > 14) ? 'ćwiczenia' : 'ćwiczeń'}`;
}

/** Filtry listy zapisanych treningów. */
export type SessionFilter = 'all' | 'coach' | 'solo' | 'pain' | 'video' | 'stopped';
export const SESSION_FILTERS: { id: SessionFilter; label: string }[] = [
  { id: 'all', label: 'Wszystkie' },
  { id: 'coach', label: 'Z trenerem' },
  { id: 'solo', label: 'Samodzielne' },
  { id: 'pain', label: 'Z bólem' },
  { id: 'video', label: 'Z nagraniem' },
  { id: 'stopped', label: 'Przerwane' },
];

/** Czy trening pasuje do filtra. `solo` — wynik isSolo(db, s) (liczony poza tą funkcją). Ból = od 4/10 albo przerwany. */
export function matchesFilter(s: TrainingSession, f: SessionFilter, solo: boolean): boolean {
  switch (f) {
    case 'coach':
      return !solo;
    case 'solo':
      return solo;
    case 'pain':
      return !!s.stoppedForPain || (s.pain ?? 0) >= 4 || !!s.painMap?.some((x) => x.level >= 4);
    case 'video':
      return s.exercises.some((e) => e.setsLog?.some((x) => x.video));
    case 'stopped':
      return !!s.stoppedForPain;
    default:
      return true;
  }
}
