import { perSideByName } from './run';
import type { SessionExercise, SetLog } from '../domain';

/** Wynik odczytu notatki: data (jeśli była w tekście) i ćwiczenia seria po serii. */
export interface ParsedNote {
  date?: string;
  exercises: SessionExercise[];
  /** Linie, których nie udało się odczytać (do pokazania trenerowi). */
  skipped: string[];
  /** Zapisy odczytane, ale podejrzane (np. 18 serii) — do sprawdzenia przez trenera. */
  warnings: string[];
}

/** Jedna linia serii po odczycie. */
export interface SetSpec {
  count: number;
  repsText: string;
  reps: number;
  /** Prawa strona przy zapisie L/P „5/3”. */
  repsR?: number;
  load?: number;
  rpe?: number;
  timed?: boolean;
  /**
   * „3x10” bez „kg” czytamy jako serie × powtórzenia; gdy w tym samym ćwiczeniu są serie z kilogramami
   * („8x70kg”), wracamy do odczytu powtórzenia × kg (`alt`).
   */
  alt?: SetSpec;
}

const n = (s: string) => parseFloat(s.replace(',', '.'));
const DATE = /^\s*(\d{1,2})[./-](\d{1,2})[./-](\d{4})\s*$/;
// „2+1x60kg”, „4x100”, „8 x 70 kg RPE 8”, „3x5x100” (serie × powt × kg), „10x” / „3x10” bez kg przy „bw”
const SET = /^\s*(?:(\d+)\s*[x×*]\s*)?(\d+(?:\s*\+\s*\d+)*)\s*[x×*]\s*(\d+(?:[.,]\d+)?)?\s*(kg|s|sek|m)?\s*(?:@\s*|rpe\s*)?(\d+(?:[.,]\d+)?)?\s*(?:rpe)?\s*$/i;
// „5/3”, „3x5/4”, „3x5/4 @7” — powtórzenia lewa / prawa
const LR = /^\s*(?:(\d+)\s*[x×*]\s*)?(\d+)\s*\/\s*(\d+)\s*(?:(?:@|rpe)\s*(\d+(?:[.,]\d+)?))?\s*$/i;
// ciężar osobno: „102,5 kg 3x5”, „3x10 8kg” (nie „8x70kg” — tam kg należy do zapisu serii)
const KG = /(^|\s)(\d+(?:[.,]\d+)?)\s*kg(?=\s|$)/i;

function core(t: string): SetSpec | null {
  const m = t.match(SET);
  if (!m) return null;
  const [, setsA, repsRaw, loadRaw, unit, rpeRaw] = m;
  const repsText = repsRaw.replace(/\s/g, '');
  const hasRpe = /rpe|@/i.test(t);
  const complex = repsText.includes('+');
  // „3x45s” / „4x30 m” — serie × czas/dystans (bez ciężaru)
  if (unit && /^(s|sek|m)$/i.test(unit) && loadRaw != null) {
    const u = /^m$/i.test(unit) ? 'm' : 's';
    return { count: parseInt(repsText, 10) || 1, repsText: `${loadRaw} ${u}`, reps: n(loadRaw), load: undefined, rpe: hasRpe && rpeRaw != null ? n(rpeRaw) : undefined, timed: true };
  }
  // „3x5 @8” — bez „kg”, mała liczba całkowita i RPE: to serie × powtórzenia, nie powtórzenia × kg
  if (!setsA && !unit && hasRpe && loadRaw != null && /^\d+$/.test(loadRaw) && n(loadRaw) <= 20 && !complex) {
    return { count: parseInt(repsText, 10), repsText: loadRaw, reps: n(loadRaw), load: undefined, rpe: rpeRaw != null ? n(rpeRaw) : undefined };
  }
  const reps = repsText.split('+').reduce((a, x) => a + parseInt(x, 10), 0);
  const rpe = rpeRaw != null && hasRpe ? n(rpeRaw) : undefined;
  if (rpeRaw != null && rpe == null) return null; // liczba na końcu bez „RPE” — nieczytelne
  const rpeOk = rpe != null && rpe >= 0 && rpe <= 10 ? rpe : undefined;
  const kg = /kg/i.test(unit ?? '');
  // „140x5x3” — pierwsza liczba duża, ostatnia mała: kg × powtórzenia × serie
  if (setsA && !complex && loadRaw != null && !kg && +setsA > 20 && n(loadRaw) <= 10 && Number.isInteger(n(loadRaw))) {
    return { count: n(loadRaw), repsText, reps, load: +setsA, rpe: rpeOk };
  }
  // „180x3” — kg × powtórzenia (180 powtórzeń po 3 kg nie ma sensu)
  if (!setsA && !complex && loadRaw != null && !kg && reps > 20 && n(loadRaw) <= 12 && Number.isInteger(n(loadRaw))) {
    return { count: 1, repsText: loadRaw, reps: n(loadRaw), load: reps, rpe: rpeOk };
  }
  const base: SetSpec = { count: setsA ? parseInt(setsA, 10) : 1, repsText, reps, load: loadRaw != null ? n(loadRaw) : undefined, rpe: rpeOk };
  // „3x10” bez kg: serie × powtórzenia (z odwrotem do powtórzenia × kg — patrz `alt`)
  if (!setsA && !complex && !kg && loadRaw != null && /^\d+$/.test(loadRaw) && reps <= 6 && n(loadRaw) <= 15) {
    return { count: reps, repsText: loadRaw, reps: n(loadRaw), load: undefined, rpe: rpeOk, alt: base };
  }
  return base;
}

/** Linia serii → liczba serii, powtórzenia (tekst i suma), ciężar, RPE; null gdy to nie seria. */
export function parseSetLine(line: string): SetSpec | null {
  const t = line.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const lr = t.match(LR);
  if (lr) {
    const [, a, l, r, rpeRaw] = lr;
    const rpe = rpeRaw != null ? n(rpeRaw) : undefined;
    return { count: a ? +a : 1, repsText: `${l}/${r}`, reps: +l, repsR: +r, rpe: rpe != null && rpe <= 10 ? rpe : undefined };
  }
  const k = t.match(KG);
  if (k && k.index != null) {
    const before = t.slice(0, k.index + k[1].length);
    if (!/[x×*]\s*$/i.test(before)) {
      const rest = (before + t.slice(k.index + k[0].length)).replace(/\s+/g, ' ').trim();
      const load = n(k[2]);
      if (!rest) return null;
      const s = parseSetLine(rest);
      if (!s || s.timed) return null;
      if (s.load == null) return { ...s, load, alt: undefined };
      // „3x10 8kg”: „3x10” to serie × powtórzenia, kilogramy obok
      const a = s.alt ?? s;
      if (a.count === 1 && a.load != null && Number.isInteger(a.load) && !a.repsText.includes('+') && !a.repsR) return { count: a.reps, repsText: String(a.load), reps: a.load, load, rpe: a.rpe };
      return null;
    }
  }
  return core(t);
}

/** Kilka serii w jednej linii: „180x3, 190x2”, „100x5; 110x3”. */
export function parseSetList(line: string): SetSpec[] | null {
  const t = line.replace(/(\d\s*[x×*]\s*\d+(?:[.,]\d+)?\s*(?:kg)?),(?=\s*\d+\s*[x×*])/gi, '$1; ');
  const parts = t.split(/\s*;\s*|,\s+/).filter((x) => x.trim());
  if (!parts.length) return null;
  const out: SetSpec[] = [];
  for (const p of parts) {
    const s = parseSetLine(p);
    if (!s) return null;
    out.push(s);
  }
  return out;
}

// „3x6/str”, „3x30s na stronę” — ćwiczenie na każdą stronę
const SIDE = /\s*(\/\s*str(?:onę|\.)?|na\s+(?:każdą\s+)?str(?:onę|\.)?|\/\s*nog[ęa]|na\s+nogę)\s*/i;

/** Część z seriami (z dopiskiem „na stronę”); `inline` — w jednej linii z nazwą ćwiczenia. */
function readSets(text: string, inline: boolean): { specs: SetSpec[]; sided: boolean } | null {
  const sided = SIDE.test(text);
  const part = sided ? text.replace(SIDE, ' ').trim() : text;
  const specs = parseSetList(part);
  if (!specs) return null;
  // w jednej linii z nazwą „4x6” (bez kg, mała liczba) czyta się jak serie × powtórzenia — na pewno
  const fixed = specs.map((s) => {
    const a = s.alt ?? s;
    if ((inline || sided) && !/kg/i.test(part) && a.count === 1 && a.load != null && Number.isInteger(a.load) && a.load <= 30 && !a.repsText.includes('+') && !a.repsR)
      return { count: a.reps, repsText: String(a.load), reps: a.load, load: undefined, rpe: a.rpe } as SetSpec;
    return s;
  });
  return { specs: fixed, sided };
}

const cleanName = (s: string) => s.replace(/[\s:–\-/|]+$/, '').trim();

/**
 * Odczytuje trening zapisany w notatkach telefonu, np.
 * „Front Squat / 4x100 / 4x105 / 8x90” — nazwa ćwiczenia, pod nią serie (powtórzenia × kg, opcjonalnie RPE).
 * Rozumie też: „Przysiad 140x5x3” (kg × powt × serie), „Wyciskanie 102,5 kg 3x5 @8”, „180x3, 190x2”,
 * „3x10 8kg”, „8kg 3x10”, „5/3” i „3x5/4” (lewa / prawa), „Plank 3x45s”.
 * Kompleksy „2+1x60kg” zapisuje jako 3 powtórzenia z opisem w uwagach.
 */
export function parseWorkoutNote(text: string): ParsedNote {
  const out: ParsedNote = { exercises: [], skipped: [], warnings: [] };
  let cur: (SessionExercise & { specs: SetSpec[] }) | null = null;
  const flush = () => {
    if (!cur) return;
    const { specs, ...ex } = cur;
    cur = null;
    if (!specs.length) return void out.skipped.push(ex.name);
    // ćwiczenie zapisane w kg („8x70kg”) — niejednoznaczne „3x10” to też powtórzenia × kg
    const withKg = specs.some((s) => !s.alt && s.load != null);
    const list = specs.map((s) => (withKg && s.alt ? s.alt : s));
    const setsLog: SetLog[] = [];
    let complex = '';
    let timed = '';
    for (const s of list) {
      if (s.repsText.includes('+') && !complex) complex = s.repsText;
      if (s.timed && !timed) timed = s.repsText;
      if (s.count > 15) out.warnings.push(`„${ex.name}”: ${s.count} serii — sprawdź zapis${s.count > 20 ? ' (wczytano 20)' : ''}.`);
      if (!s.timed && s.reps > 60) out.warnings.push(`„${ex.name}”: ${s.reps} powtórzeń w serii — sprawdź zapis.`);
      if (s.load != null && s.load > 400) out.warnings.push(`„${ex.name}”: ${String(s.load).replace('.', ',')} kg — sprawdź zapis.`);
      const unit = s.timed ? (/\bm$/.test(s.repsText) ? 'min' : 's') : undefined;
      for (let i = 0; i < Math.min(s.count, 20); i++)
        setsLog.push({ load: s.load, reps: s.reps, repsR: s.repsR != null && s.repsR !== s.reps ? s.repsR : undefined, rpe: s.rpe, unit, complex: s.repsText.includes('+') ? s.repsText : undefined });
    }
    if (!setsLog.length) return void out.skipped.push(ex.name);
    const first = setsLog[0];
    const e: SessionExercise = {
      ...ex,
      setsLog,
      sets: String(setsLog.length),
      reps: complex || timed || (first.reps != null ? `${first.reps}${first.repsR != null ? `/${first.repsR}` : ''}` : ''),
      load: first.load != null ? String(first.load) : '',
      rpe: '',
    };
    if (list.some((s) => s.repsR != null)) e.perSide = true;
    if (complex) e.notes = [e.notes, `Kompleks ${complex} (seria = ${first.reps} powt.)`].filter(Boolean).join(' · ');
    out.exercises.push(e);
  };
  const start = (name: string) => {
    flush();
    cur = { name: cleanName(name), specs: [] };
    if (perSideByName(cur.name)) cur.perSide = true;
  };
  const add = (r: { specs: SetSpec[]; sided: boolean }) => {
    cur!.specs.push(...r.specs);
    if (r.sided) cur!.perSide = true;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const d = line.match(DATE);
    if (d) {
      const iso = `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`;
      const t = new Date(`${iso}T12:00:00`);
      // tylko istniejąca data (31.02 odrzucamy)
      if (!out.date && !Number.isNaN(+t) && t.getDate() === +d[1] && t.getMonth() + 1 === +d[2]) out.date = iso;
      else if (!out.date) out.skipped.push(line);
      continue;
    }
    // cała linia to serie
    const whole = readSets(line, false);
    if (whole) {
      if (!cur) out.skipped.push(line);
      else add(whole);
      continue;
    }
    // „Podciąganie 4x6”, „Przysiad 140x5x3”, „Wyciskanie leżąc 102,5 kg 3x5 @8”, „Step down / 3x10” — nazwa i serie w jednej linii
    const tokens = line.split(/\s+/);
    let done = false;
    for (let i = 1; i < tokens.length && !done; i++) {
      if (!/^\d/.test(tokens[i])) continue;
      const name = cleanName(tokens.slice(0, i).join(' '));
      if (!/\p{L}/u.test(name)) continue;
      const r = readSets(tokens.slice(i).join(' '), true);
      if (!r) continue;
      start(name);
      add(r);
      done = true;
    }
    if (!done) start(line);
  }
  flush();
  // bez pustych pól w seriach
  out.exercises = out.exercises.map((e) => ({ ...e, setsLog: e.setsLog!.map((x) => Object.fromEntries(Object.entries(x).filter(([, v]) => v != null)) as SetLog) }));
  return out;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Jednostka planu pasująca do notatki: nazwa treningu w notatce (linia bez serii) albo większość ćwiczeń
 * o tych samych nazwach. Zwraca id jednostki i to, po czym ją rozpoznano.
 */
export function matchNoteWorkout(note: ParsedNote, workouts: { id: string; name: string; exercises: { name: string }[] }[]): { id: string; by: 'name' | 'exercises'; line?: string } | null {
  for (const line of note.skipped) {
    const w = workouts.find((x) => norm(x.name) && norm(x.name) === norm(line));
    if (w) return { id: w.id, by: 'name', line };
  }
  const names = new Set(note.exercises.map((e) => norm(e.name)));
  if (!names.size) return null;
  let best: { id: string; score: number } | null = null;
  for (const w of workouts) {
    const score = w.exercises.filter((e) => names.has(norm(e.name))).length;
    if (score && (!best || score > best.score)) best = { id: w.id, score };
  }
  return best && best.score >= Math.max(2, Math.ceil(names.size / 2)) ? { id: best.id, by: 'exercises' } : null;
}
