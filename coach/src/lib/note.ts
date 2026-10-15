import type { SessionExercise, SetLog } from '../domain';

/** Wynik odczytu notatki: data (jeśli była w tekście) i ćwiczenia seria po serii. */
export interface ParsedNote {
  date?: string;
  exercises: SessionExercise[];
  /** Linie, których nie udało się odczytać (do pokazania trenerowi). */
  skipped: string[];
}

const n = (s: string) => parseFloat(s.replace(',', '.'));
const DATE = /^\s*(\d{1,2})[./-](\d{1,2})[./-](\d{4})\s*$/;
// „2+1x60kg”, „4x100”, „8 x 70 kg RPE 8”, „3x5x100” (serie × powt × kg), „10x” / „3x10” bez kg przy „bw”
const SET = /^\s*(?:(\d+)\s*[x×*]\s*)?(\d+(?:\s*\+\s*\d+)*)\s*[x×*]\s*(\d+(?:[.,]\d+)?)?\s*(kg|s|sek|m)?\s*(?:@\s*|rpe\s*)?(\d+(?:[.,]\d+)?)?\s*(?:rpe)?\s*$/i;

/** Linia serii → liczba serii, powtórzenia (tekst i suma), ciężar, RPE; null gdy to nie seria. */
export function parseSetLine(line: string): { count: number; repsText: string; reps: number; load?: number; rpe?: number; timed?: boolean } | null {
  const t = line.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const m = t.match(SET);
  if (!m) return null;
  const [, setsA, repsRaw, loadRaw, unit, rpeRaw] = m;
  const repsText = repsRaw.replace(/\s/g, '');
  const hasRpe = /rpe|@/i.test(t);
  // „3x45s” / „4x30 m” — serie × czas/dystans (bez ciężaru)
  if (unit && /^(s|sek|m)$/i.test(unit) && loadRaw != null) {
    const u = /^m$/i.test(unit) ? 'm' : 's';
    return { count: parseInt(repsText, 10) || 1, repsText: `${loadRaw} ${u}`, reps: n(loadRaw), load: undefined, rpe: hasRpe && rpeRaw != null ? n(rpeRaw) : undefined, timed: true };
  }
  // „3x5 @8” — bez „kg”, mała liczba całkowita i RPE: to serie × powtórzenia, nie powtórzenia × kg
  if (!setsA && !unit && hasRpe && loadRaw != null && /^\d+$/.test(loadRaw) && n(loadRaw) <= 20 && !repsText.includes('+')) {
    return { count: parseInt(repsText, 10), repsText: loadRaw, reps: n(loadRaw), load: undefined, rpe: rpeRaw != null ? n(rpeRaw) : undefined };
  }
  const reps = repsText.split('+').reduce((a, x) => a + parseInt(x, 10), 0);
  const rpe = rpeRaw != null && hasRpe ? n(rpeRaw) : undefined;
  if (rpeRaw != null && rpe == null) return null; // liczba na końcu bez „RPE” — nieczytelne
  return { count: setsA ? parseInt(setsA, 10) : 1, repsText, reps, load: loadRaw != null ? n(loadRaw) : undefined, rpe: rpe != null && rpe >= 0 && rpe <= 10 ? rpe : undefined };
}

/**
 * Odczytuje trening zapisany w notatkach telefonu, np.
 * „Front Squat / 4x100 / 4x105 / 8x90” — nazwa ćwiczenia, pod nią serie (powtórzenia × kg, opcjonalnie RPE).
 * Kompleksy „2+1x60kg” zapisuje jako 3 powtórzenia z opisem w uwagach.
 */
export function parseWorkoutNote(text: string): ParsedNote {
  const out: ParsedNote = { exercises: [], skipped: [] };
  let cur: (SessionExercise & { setsLog: SetLog[] }) | null = null;
  let complex = '';
  let timed = '';
  const flush = () => {
    if (!cur) return;
    if (cur.setsLog.length) {
      const first = cur.setsLog[0];
      cur.sets = String(cur.setsLog.length);
      cur.reps = complex || timed || (first.reps != null ? String(first.reps) : '');
      cur.load = first.load != null ? String(first.load) : '';
      cur.rpe = '';
      if (complex) cur.notes = [cur.notes, `Kompleks ${complex} (seria = ${first.reps} powt.)`].filter(Boolean).join(' · ');
      out.exercises.push(cur);
    } else out.skipped.push(cur.name);
    cur = null;
    complex = '';
    timed = '';
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const d = line.match(DATE);
    if (d) {
      if (!out.date) out.date = `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`;
      continue;
    }
    // „Podciąganie 4x6”, „Przysiad 5x3x100” — nazwa i serie w jednej linii
    const inline = line.match(/^(.*?[^\d\s@x×*+.,])\s+(\d+\s*[x×*].*)$/i);
    if (inline && !parseSetLine(line) && parseSetLine(inline[2])) {
      flush();
      cur = { name: inline[1].replace(/[:–-]\s*$/, '').trim(), setsLog: [] };
    }
    const isInline = !!inline && cur?.name === inline[1].replace(/[:–-]\s*$/, '').trim() && cur.setsLog.length === 0;
    let s = parseSetLine(isInline ? inline![2] : line);
    // w jednej linii z nazwą „4x6” (bez kg, mała liczba) czyta się jak serie × powtórzenia
    if (s && isInline && !/kg/i.test(inline![2]) && s.count === 1 && s.load != null && Number.isInteger(s.load) && s.load <= 30 && !s.repsText.includes('+'))
      s = { count: s.reps, repsText: String(s.load), reps: s.load, load: undefined, rpe: s.rpe };
    if (s) {
      if (!cur) {
        out.skipped.push(line);
        continue;
      }
      if (s.repsText.includes('+') && !complex) complex = s.repsText;
      if (s.timed && !timed) timed = s.repsText;
      for (let i = 0; i < Math.min(s.count, 20); i++) cur.setsLog.push({ load: s.load, reps: s.reps, rpe: s.rpe, complex: s.repsText.includes('+') ? s.repsText : undefined });
      continue;
    }
    flush();
    cur = { name: line.replace(/[:–-]\s*$/, '').trim(), setsLog: [] };
  }
  flush();
  // bez pustych pól w seriach
  out.exercises = out.exercises.map((e) => ({ ...e, setsLog: e.setsLog!.map((x) => Object.fromEntries(Object.entries(x).filter(([, v]) => v != null)) as SetLog) }));
  return out;
}
