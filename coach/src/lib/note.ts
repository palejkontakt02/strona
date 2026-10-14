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
const SET = /^\s*(?:(\d+)\s*[x×*]\s*)?(\d+(?:\s*\+\s*\d+)*)\s*[x×*]\s*(\d+(?:[.,]\d+)?)?\s*(kg)?\s*(?:@\s*|rpe\s*)?(\d+(?:[.,]\d+)?)?\s*(?:rpe)?\s*$/i;

/** Linia serii → liczba serii, powtórzenia (tekst i suma), ciężar, RPE; null gdy to nie seria. */
export function parseSetLine(line: string): { count: number; repsText: string; reps: number; load?: number; rpe?: number } | null {
  const t = line.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const m = t.match(SET);
  if (!m) return null;
  const [, setsA, repsRaw, loadRaw, , rpeRaw] = m;
  const repsText = repsRaw.replace(/\s/g, '');
  const reps = repsText.split('+').reduce((a, x) => a + parseInt(x, 10), 0);
  const rpe = rpeRaw != null && /rpe|@/i.test(t) ? n(rpeRaw) : undefined;
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
  const flush = () => {
    if (!cur) return;
    if (cur.setsLog.length) {
      const first = cur.setsLog[0];
      cur.sets = String(cur.setsLog.length);
      cur.reps = complex || (first.reps != null ? String(first.reps) : '');
      cur.load = first.load != null ? String(first.load) : '';
      cur.rpe = '';
      if (complex) cur.notes = [cur.notes, `Kompleks ${complex} (seria = ${first.reps} powt.)`].filter(Boolean).join(' · ');
      out.exercises.push(cur);
    } else out.skipped.push(cur.name);
    cur = null;
    complex = '';
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const d = line.match(DATE);
    if (d) {
      if (!out.date) out.date = `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`;
      continue;
    }
    const s = parseSetLine(line);
    if (s) {
      if (!cur) {
        out.skipped.push(line);
        continue;
      }
      if (s.repsText.includes('+') && !complex) complex = s.repsText;
      for (let i = 0; i < Math.min(s.count, 20); i++) cur.setsLog.push({ load: s.load, reps: s.reps, rpe: s.rpe });
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
