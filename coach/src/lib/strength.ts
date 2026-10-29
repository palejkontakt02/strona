import type { SessionExercise, SetLog, TrainingSession } from '../domain';
import { num, repsN } from './parse';

export const round25 = (v: number) => Math.round(v / 2.5) * 2.5;
const defaultRound = round25;

/** RIR = 10 − RPE (min. 0). Brak RPE → `fallback`. */
function rirOf(rpe: unknown, fallback: number): number {
  const r = num(rpe);
  return r != null ? Math.max(0, 10 - r) : fallback;
}

/**
 * e1RM wg Epleya z uwzględnieniem RIR: kg × (1 + (powt + RIR)/30).
 * powt + RIR = 1 → kg; powt + RIR > 15 → null (zbyt niepewne).
 */
export function e1rmRPE(load: unknown, reps: unknown, rpe: unknown, fallbackRir = 0): number | null {
  const l = num(load);
  const r = repsN(reps);
  if (!l || !r) return null;
  const rir = rirOf(rpe, fallbackRir);
  if (r + rir > 15) return null;
  return r + rir === 1 ? l : l * (1 + (r + rir) / 30);
}

/** Ciężar pod cel: e1RM / (1 + (powt + RIR_cel)/30), zaokrąglony do 2,5 kg (albo `round`). Brak RPE → RIR 2. */
export function loadFor(e1: number, reps: unknown, rpe: unknown, round: (v: number) => number = round25): number {
  const r = repsN(reps) || 1;
  const rir = rirOf(rpe, 2);
  return round(r + rir === 1 ? e1 : e1 / (1 + (r + rir) / 30));
}

function workSets(e: SessionExercise): SetLog[] {
  return (e.setsLog || []).filter((s) => !s.warmup && s.done !== false && !s.complex && !s.unit); // serie na czas nie liczą się do siły
}

/** Najlepszy e1RM ćwiczenia w sesji: max z serii roboczych, a bez serii — z podsumowania. */
export function exerciseE1(e: SessionExercise): number | null {
  const sets = workSets(e);
  if (sets.length === 0) return e.setsLog?.length || String(e.reps ?? '').includes('+') ? null : e1rmRPE(e.load, e.reps, e.rpe);
  let best: number | null = null;
  for (const s of sets) {
    const v = e1rmRPE(s.load, s.reps, s.rpe);
    if (v != null && (best == null || v > best)) best = v;
  }
  return best;
}

/** Seria z najwyższym e1RM (do wyświetlenia rekordu). */
export function bestSet(e: SessionExercise): { load: unknown; reps: unknown } {
  const sets = (e.setsLog || []).filter((s) => !s.warmup);
  if (sets.length === 0) return { load: e.load, reps: e.reps };
  let best = sets[0];
  let bv = -1;
  for (const s of sets) {
    const v = e1rmRPE(s.load, s.reps, s.rpe) || 0;
    if (v > bv) {
      bv = v;
      best = s;
    }
  }
  return { load: best.load, reps: best.reps };
}

export interface ResolvedLoad {
  load: number | null;
  why: string;
}

/**
 * Zapis ciężaru w serii planu:
 * „100” = kg · „75%” = % e1RM · „-10%”/„+4%” = względem poprzedniej serii · puste = dobór z RPE (jeśli jest historia).
 */
export function resolveLoad(
  spec: string | undefined,
  e1: number | null,
  reps: unknown,
  rpe: unknown,
  prev: number | null,
  /** `round` — zaokrąglenie do dostępnych ciężarów (domyślnie 2,5 kg); `maxLabel` — skąd maks. przy „75%” (domyślnie „szac. 1RM”). */
  opts: { round?: (v: number) => number; maxLabel?: string } = {},
): ResolvedLoad {
  const round25 = opts.round ?? defaultRound;
  const sp = String(spec || '').replace(',', '.').trim();
  const rel = sp.match(/^([+-])\s*(\d+(?:\.\d+)?)\s*%/);
  if (rel) {
    const p = (rel[1] === '-' ? -1 : 1) * Number(rel[2]);
    return prev != null
      ? { load: round25(prev * (1 + p / 100)), why: `${p > 0 ? '+' : ''}${p}% od poprzedniej serii` }
      : { load: null, why: `${rel[0]} od poprzedniej serii` };
  }
  const pc = sp.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pc) {
    return e1
      ? { load: round25((e1 * Number(pc[1])) / 100), why: `${pc[1]}% ${opts.maxLabel ?? 'szac. 1RM'}` }
      : { load: null, why: `${pc[1]}% 1RM – brak historii, dobierz ciężar` };
  }
  const kg = num(sp);
  if (kg != null) return { load: kg, why: '' };
  if (e1 && repsN(reps)) {
    const target = rpe || 8;
    return { load: loadFor(e1, reps, target, round25), why: `dobrane z historii do RPE ${String(target)}` };
  }
  return { load: null, why: '' };
}

export interface PersonalRecord {
  date: string;
  name: string;
  load: unknown;
  reps: unknown;
  e1: number;
  gain: number;
}

/**
 * Rekordy: chronologicznie per ćwiczenie; rekord = e1RM > dotychczasowe max + 0,05.
 * Pierwszy wynik ćwiczenia ustala punkt odniesienia (nie jest rekordem). Wynik: od najnowszych.
 */
export function records(sessions: TrainingSession[]): PersonalRecord[] {
  const asc = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
  const best: Record<string, number> = {};
  const out: PersonalRecord[] = [];
  for (const s of asc) {
    for (const e of s.exercises) {
      const v = exerciseE1(e);
      if (v == null) continue;
      const b = best[e.name];
      if (b != null && v > b + 0.05) {
        const bs = bestSet(e);
        out.push({ date: s.date, name: e.name, load: bs.load, reps: bs.reps, e1: v, gain: v - b });
      }
      if (b == null || v > b) best[e.name] = v;
    }
  }
  return out.reverse();
}

/** Przebieg e1RM ćwiczenia w czasie (max dzienny, 0,1 kg). */
export function e1Series(sessions: TrainingSession[], name: string): { x: string; y: number }[] {
  const by: Record<string, number> = {};
  for (const s of sessions) {
    for (const e of s.exercises) {
      if (e.name !== name) continue;
      const v = exerciseE1(e);
      if (v != null) by[s.date] = Math.max(by[s.date] || 0, Math.round(v * 10) / 10);
    }
  }
  return Object.entries(by)
    .map(([x, y]) => ({ x, y }))
    .sort((a, b) => a.x.localeCompare(b.x));
}

/** Najlepszy dotychczasowy e1RM ćwiczenia (do podpowiedzi ciężaru). */
export function bestE1(sessions: TrainingSession[], name: string): number | null {
  let best: number | null = null;
  for (const s of sessions)
    for (const e of s.exercises) {
      if (e.name !== name) continue;
      const v = exerciseE1(e);
      if (v != null && (best == null || v > best)) best = v;
    }
  return best;
}

/**
 * e1RM do podpowiedzi ciężaru: najlepszy wynik z ostatnich `weeks` tygodni (licząc od ostatniego
 * treningu tego ćwiczenia), serie bez RPE z zapasem 2 powtórzeń — lekki dzień techniczny nie zaniża podpowiedzi.
 */
export function recentE1(sessions: TrainingSession[], name: string, weeks = 6): number | null {
  const withEx = sessions.filter((s) => s.exercises.some((e) => e.name === name));
  if (!withEx.length) return null;
  const last = withEx.reduce((a, s) => (s.date > a ? s.date : a), withEx[0].date);
  const from = new Date(new Date(`${last}T12:00:00`).getTime() - weeks * 7 * 864e5).toISOString().slice(0, 10);
  let best: number | null = null;
  for (const s of withEx) {
    if (s.date < from) continue;
    for (const e of s.exercises) {
      if (e.name !== name) continue;
      const sets = workSets(e);
      const vals = sets.length ? sets.map((x) => e1rmRPE(x.load, x.reps, x.rpe, 2)) : [String(e.reps ?? '').includes('+') ? null : e1rmRPE(e.load, e.reps, e.rpe, 2)];
      for (const v of vals) if (v != null && (best == null || v > best)) best = v;
    }
  }
  return best ?? bestE1(sessions, name);
}

/**
 * Maks. z testu („1RM przysiad”, „Back Squat 1RM”, „max wyciskanie”) dla ćwiczenia z planu:
 * najnowszy wynik testu, którego nazwa (bez „1RM/max/kg”) zawiera się w nazwie ćwiczenia.
 */
export function testedMax(tests: { name: string; date: string; value?: number | string }[], exercise: string): { value: number; date: string } | null {
  // porównanie słów bez sprzętu i ozdobników: „1RM przysiad” = „Przysiad ze sztangą”, ale ≠ „Przysiad bułgarski”
  const STOP = new Set(['z', 'ze', 'na', 'sztangą', 'sztanga', 'sztangi', 'barbell', 'bb', 'klasyczny', 'klasyczne', 'klasyczna', 'tylny', 'test', 'kg', '1rm', 'rm', 'max', 'maks', 'maksymalny']);
  const words = (t: string) => new Set(t.toLowerCase().replace(/\(.*?\)|[^a-ząćęłńóśźż0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w)));
  const ex = words(exercise);
  let best: { value: number; date: string } | null = null;
  for (const t of tests) {
    if (!/\b(1\s*rm|rm|max|maks)/i.test(t.name)) continue;
    const key = words(t.name.replace(/1\s*rm/i, ''));
    const v = typeof t.value === 'number' ? t.value : parseFloat(String(t.value ?? '').replace(',', '.'));
    if (!key.size || !Number.isFinite(v) || v <= 0) continue;
    if (key.size !== ex.size || [...key].some((w) => !ex.has(w))) continue;
    if (!best || t.date > best.date) best = { value: v, date: t.date };
  }
  return best;
}

/* ===================== rekordy, % maksa, talerze ===================== */

const fmtKg = (v: number) => String(Math.round(v * 100) / 100).replace('.', ',');
/** „2026-10-12” → „12.10”. */
const fmtDM = (iso: string) => {
  const m = iso.match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${m[2]}.${m[1]}` : iso;
};

/** Ćwiczenia z hantlami / kettlebell — przy nich ważne, czy ciężar to 1 hantel, czy suma. */
export function dumbbellByName(name: string): boolean {
  return /hantl|hantel|kettlebell|kettla|odważnik|dumbbell|\bdb\b|\bkb\b/i.test(name);
}

/** Ćwiczenia ze sztangą (talerze na gryfie) — przy nich przycisk kalkulatora talerzy. */
export function barbellByName(name: string): boolean {
  if (dumbbellByName(name) || /maszyn|wyciąg|linka|wyciskark|suwnic|leg press|gumą|guma|taśm|trx|kettl|goblet|bułgar|pompk|podciąg|dip|plank|desk/i.test(name)) return false;
  return /sztang|gryf|barbell|\bbb\b|trap ?bar|przysiad|martwy|wyciskanie (leżąc|żołnierskie|nad głow|stojąc)|bench|squat|deadlift|hip thrust|wznosy bioder|\bohp\b|rwanie|zarzut|podrzut|good morning|wiosłowanie (sztang|w opadzie)|landmine/i.test(name);
}

/**
 * Zaokrąglenie do ciężaru, który da się założyć: sztanga / maszyna co 2,5 kg; hantle co 1 kg
 * (do 10 kg na hantel) albo 2 kg (powyżej). `loadPer: 'sum'` — ciężar to suma dwóch hantli.
 */
export function roundLoad(v: number, exerciseName: string, loadPer?: 'one' | 'sum'): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  if (!dumbbellByName(exerciseName)) return round25(v);
  const per = loadPer === 'sum' ? v / 2 : v;
  const step = per < 10 ? 1 : 2;
  const r = Math.max(step === 1 ? 1 : 2, Math.round(per / step) * step);
  return loadPer === 'sum' ? r * 2 : r;
}

/** Funkcja zaokrąglania dla ćwiczenia (do resolveLoad / loadFor). */
export const rounderFor = (exerciseName: string, loadPer?: 'one' | 'sum') => (v: number) => roundLoad(v, exerciseName, loadPer);

/**
 * Procent maksa → kg do założenia, np. `percentToKg(75, 140, 'Przysiad ze sztangą')` = 105.
 * Zaokrąglenie wg sprzętu (sztanga 2,5 kg, hantle 1 / 2 kg) — patrz `roundLoad`.
 */
export function percentToKg(pct: number, max: number, exerciseName: string, loadPer?: 'one' | 'sum'): number {
  if (!Number.isFinite(pct) || !Number.isFinite(max) || pct <= 0 || max <= 0) return 0;
  return roundLoad((max * pct) / 100, exerciseName, loadPer);
}

export interface MaxSource {
  value: number;
  source: 'test' | 'e1';
  /** Data testu (dla `test`). */
  date?: string;
  /** Do podpowiedzi: „z testu 140 kg (12.10)” albo „szac. max 123 kg”. */
  label: string;
}

/** Maks. do wyliczania „75%”: najnowszy test 1RM, a bez testu szacowane maks. z ostatnich treningów. */
export function currentMax(sessions: TrainingSession[], tests: { name: string; date: string; value?: number | string }[], exerciseName: string): MaxSource | null {
  const t = testedMax(tests, exerciseName);
  if (t) return { value: t.value, source: 'test', date: t.date, label: `z testu ${fmtKg(t.value)} kg (${fmtDM(t.date)})` };
  const e = recentE1(sessions, exerciseName);
  return e ? { value: e, source: 'e1', label: `szac. max ${Math.round(e)} kg` } : null;
}

/* ---------- rekordy ---------- */

export const RECORD_REPS = [1, 3, 5] as const;
export type RecordReps = (typeof RECORD_REPS)[number];

export interface LiftRecord {
  load: number;
  reps: number;
  rpe?: number;
  /** Szacowane maks. tej serii (Epley z RIR). */
  e1: number;
  date: string;
}

export interface ExerciseRecords {
  /** Najcięższa seria na co najmniej 1 / 3 / 5 powtórzeń (1RM, 3RM, 5RM); pierwsza data osiągnięcia. */
  rm: Record<RecordReps, LiftRecord | null>;
  /** Seria z najwyższym szacowanym maks. (e1RM). */
  e1: LiftRecord | null;
}

export interface LiftSet {
  load: unknown;
  reps: unknown;
  rpe?: unknown;
}

/** Serie robocze ćwiczenia z historii (z zapisu serii albo z podsumowania), od najstarszych. */
function liftSets(sessions: TrainingSession[], name: string): (LiftSet & { date: string })[] {
  const out: (LiftSet & { date: string })[] = [];
  for (const s of [...sessions].sort((a, b) => a.date.localeCompare(b.date)))
    for (const e of s.exercises) {
      if (e.name !== name || e.cardio || e.timed) continue;
      if (e.setsLog?.length) for (const x of workSets(e)) out.push({ load: x.load, reps: x.reps, rpe: x.rpe, date: s.date });
      else if (!String(e.reps ?? '').includes('+') && !/\d\s*s\b|min/.test(String(e.reps ?? ''))) out.push({ load: e.load, reps: e.reps, rpe: e.rpe, date: s.date });
    }
  return out;
}

function liftOf(x: LiftSet, date: string): LiftRecord | null {
  const load = num(x.load);
  const reps = repsN(x.reps);
  if (!load || load <= 0 || !reps || reps <= 0) return null;
  const rpe = num(x.rpe) ?? undefined;
  const e1 = e1rmRPE(load, reps, rpe) ?? e1rmRPE(load, Math.min(reps, 15), undefined) ?? load;
  return { load, reps, rpe, e1: Math.round(e1 * 10) / 10, date };
}

const emptyRecords = (): ExerciseRecords => ({ rm: { 1: null, 3: null, 5: null }, e1: null });

/** Dokłada serię do rekordów (bez zmiany wejścia). */
export function addToRecords(rec: ExerciseRecords, set: LiftSet, date: string): ExerciseRecords {
  const l = liftOf(set, date);
  if (!l) return rec;
  const rm = { ...rec.rm };
  for (const n of RECORD_REPS) if (l.reps >= n && (!rm[n] || l.load > rm[n]!.load)) rm[n] = l;
  return { rm, e1: !rec.e1 || l.e1 > rec.e1.e1 ? l : rec.e1 };
}

/**
 * Rekordy ćwiczenia z historii treningów: 1RM, 3RM, 5RM (najcięższy ciężar na ≥ N powtórzeń)
 * i najlepsze szacowane maks. (e1RM), każde z datą i serią. Rozgrzewki, serie na czas i kompleksy pomijane.
 */
export function exerciseRecords(sessions: TrainingSession[], name: string): ExerciseRecords {
  return liftSets(sessions, name).reduce((r, x) => addToRecords(r, x, x.date), emptyRecords());
}

/**
 * Przebieg szacowanego maks. (e1RM) ćwiczenia: jeden punkt na dzień (najlepsza seria), od najstarszego.
 * `e1` w kg z dokładnością 0,1; `load` × `reps` — seria, z której wynika.
 */
export function e1rmHistory(sessions: TrainingSession[], name: string): { date: string; e1: number; load: number; reps: number }[] {
  const by = new Map<string, LiftRecord>();
  for (const x of liftSets(sessions, name)) {
    const l = liftOf(x, x.date);
    if (l && (!by.has(x.date) || l.e1 > by.get(x.date)!.e1)) by.set(x.date, l);
  }
  return [...by.values()].map((l) => ({ date: l.date, e1: l.e1, load: l.load, reps: l.reps }));
}

export interface RecordHit {
  /** Pobity rekord: 1RM / 3RM / 5RM albo tylko szacowane maks. */
  kind: RecordReps | 'e1';
  /** Czy pobite też szacowane maks. */
  e1Record: boolean;
  load: number;
  reps: number;
  e1: number;
  /** „Nowy rekord: 5 × 100 kg (szac. max 117 kg)”. */
  text: string;
}

/**
 * Czy seria bije dotychczasowe rekordy (`before`)? Pierwszy wynik ćwiczenia (brak historii) nie jest rekordem.
 * Rekord na N powtórzeń liczy się tylko, gdy wcześniej była seria na ≥ N powtórzeń.
 */
export function newRecord(before: ExerciseRecords, set: LiftSet): RecordHit | null {
  if (!before.e1) return null;
  const l = liftOf(set, '');
  if (!l) return null;
  let kind: RecordHit['kind'] | null = null;
  for (const n of [5, 3, 1] as const) {
    const r = before.rm[n];
    if (l.reps >= n && r && l.load > r.load + 0.01) {
      kind = n;
      break;
    }
  }
  const e1Record = l.e1 > before.e1.e1 + 0.05;
  if (!kind && !e1Record) return null;
  return { kind: kind ?? 'e1', e1Record, load: l.load, reps: l.reps, e1: l.e1, text: `Nowy rekord: ${l.reps} × ${fmtKg(l.load)} kg (szac. max ${Math.round(l.e1)} kg)` };
}

/** Rekord dla właśnie zaliczonej serii: historia + wcześniejsze serie tego ćwiczenia z dzisiejszego treningu. */
export function checkRecord(history: TrainingSession[], name: string, earlierToday: LiftSet[], set: LiftSet): RecordHit | null {
  const base = exerciseRecords(history, name);
  if (!base.e1) return null; // pierwszy raz — jeszcze nie ma czego bić
  return newRecord(earlierToday.reduce((r, x) => addToRecords(r, x, '~'), base), set);
}

/** Rekordy pobite w treningu (najlepszy per ćwiczenie) — do podsumowania. */
export function sessionRecords(history: TrainingSession[], exercises: { name: string; sets: (LiftSet & { warmup?: boolean; done?: boolean; unit?: unknown; complex?: unknown })[]; cardio?: boolean; timed?: boolean }[]): { name: string; hit: RecordHit }[] {
  const out: { name: string; hit: RecordHit }[] = [];
  const seen = new Map<string, ExerciseRecords>();
  for (const e of exercises) {
    if (e.cardio || e.timed) continue;
    let rec = seen.get(e.name) ?? exerciseRecords(history, e.name);
    if (!rec.e1 && !seen.has(e.name)) continue; // bez historii nie ma rekordu do pobicia
    let best: RecordHit | null = null;
    for (const s of e.sets) {
      if (s.warmup || s.done === false || s.unit || s.complex) continue;
      if (/\+/.test(String(s.reps ?? ''))) continue;
      const hit = newRecord(rec, s);
      if (hit && (!best || hit.e1 > best.e1)) best = hit;
      rec = addToRecords(rec, s, '~');
    }
    seen.set(e.name, rec);
    if (best) {
      const i = out.findIndex((x) => x.name === e.name);
      if (i < 0) out.push({ name: e.name, hit: best });
      else if (best.e1 > out[i].hit.e1) out[i] = { name: e.name, hit: best };
    }
  }
  return out;
}

/* ---------- talerze ---------- */

export const PLATES = [25, 20, 15, 10, 5, 2.5, 1.25] as const;

export interface PlateLoad {
  /** Talerze na jedną stronę, od najcięższego. */
  perSide: number[];
  /** Ciężar, który wychodzi z gryfem i talerzami. */
  achieved: number;
  /** Docelowy − wychodzący (0 = dokładnie; < 0 = mniej niż sam gryf). */
  diff: number;
}

/** Talerze na stronę dla ciężaru całkowitego (gryf 20 kg albo 15 kg); reszta, której nie da się założyć, w `diff`. */
export function platesFor(total: number, bar = 20, plates: readonly number[] = PLATES): PlateLoad {
  const t = Math.round(total * 100);
  const b = Math.round(bar * 100);
  if (!Number.isFinite(total) || t <= b) return { perSide: [], achieved: bar, diff: Math.round(t - b) / 100 };
  let side = Math.floor((t - b) / 2);
  const perSide: number[] = [];
  for (const p of plates) {
    const c = Math.round(p * 100);
    while (side >= c) {
      perSide.push(p);
      side -= c;
    }
  }
  const achieved = (b + 2 * perSide.reduce((a, p) => a + Math.round(p * 100), 0)) / 100;
  return { perSide, achieved, diff: Math.round(t - achieved * 100) / 100 };
}

/** „20 + 15 + 2,5 na stronę”; bez talerzy — „sam gryf”. */
export const platesText = (perSide: number[]) => (perSide.length ? `${perSide.map(fmtKg).join(' + ')} na stronę` : 'sam gryf');

/**
 * Najmniejszy realny krok ciężaru: hantle / kettle 1 kg (do 10 kg na rękę) albo 2 kg (przy `sum` — razy dwa);
 * małe ciężary < 20 kg poza sztangą (linka, talerz, maszyna z małym krokiem) 1 kg; sztanga / maszyna 2,5 kg.
 */
export function loadStep(v: number, exerciseName: string, loadPer?: 'one' | 'sum'): number {
  if (dumbbellByName(exerciseName)) {
    const per = loadPer === 'sum' ? v / 2 : v;
    const s = per < 10 ? 1 : 2;
    return loadPer === 'sum' ? s * 2 : s;
  }
  if (!barbellByName(exerciseName) && v < 20) return 1;
  return 2.5;
}

/** Zaokrąglenie do ciężaru do założenia: jak `roundLoad`, a małe ciężary (< 20 kg, nie hantle i nie sztanga) co 0,5 kg. */
export function roundReal(v: number, exerciseName: string, loadPer?: 'one' | 'sum'): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  if (!dumbbellByName(exerciseName) && !barbellByName(exerciseName) && v < 20) return Math.round(v * 2) / 2;
  return roundLoad(v, exerciseName, loadPer);
}

/** Ciężar o `n` realnych kroków wyżej (n < 0 — niżej): sztanga 100 → 102,5; hantel 8 → 9, 12 → 14. */
export function stepLoad(v: number, exerciseName: string, loadPer?: 'one' | 'sum', n = 1): number {
  let x = v;
  const sign = Math.sign(n);
  for (let i = 0; i < Math.abs(n); i++) {
    const s = loadStep(sign > 0 ? x : x - 0.001, exerciseName, loadPer);
    const cand = x + sign * s;
    const r = roundReal(cand, exerciseName, loadPer);
    x = (sign > 0 ? r > x : r < x) ? r : cand;
  }
  return Math.max(0, Math.round(x * 100) / 100);
}

/** Ciężar po zmianie o ułamek (`+0.025`, `-0.1`) w realnych krokach; przy wzroście co najmniej jeden krok, bez wymuszania +2,5 kg. */
export function scaleLoad(v: number, f: number, exerciseName: string, loadPer?: 'one' | 'sum'): number {
  if (!Number.isFinite(v) || v <= 0) return v;
  const r = roundReal(v * (1 + f), exerciseName, loadPer);
  if (f > 0 && r <= v) return stepLoad(v, exerciseName, loadPer, 1);
  if (f < 0 && r >= v) return stepLoad(v, exerciseName, loadPer, -1);
  return r;
}
