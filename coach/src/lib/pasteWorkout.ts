import type { PlanExercise } from '../domain';
import { sessionToWorkout } from '../data/ops';
import { uid } from '../format';
import { parseWorkoutNote } from './note';
import { detectColumns, parseTable, sheetToPlan } from './sheetImport';
import { normalizeLayout } from './sheetLayouts';

/**
 * Trening wklejony przy „Zadaj trening”: notatka z telefonu („Przysiad / 6x45 / 6x50…”)
 * albo zakres skopiowany z Excela / Arkuszy Google (z nagłówkami: Ćwiczenie, Serie, Powt., Ciężar, RPE…).
 */
export interface PastedWorkout {
  name?: string;
  exercises: PlanExercise[];
  /** Linie, których nie udało się odczytać. */
  skipped: string[];
  warnings: string[];
  from: 'note' | 'sheet';
}

export function pastedWorkout(text: string, today: string): PastedWorkout | null {
  if (!text.trim()) return null;
  // zakres z arkusza: kolumny rozdzielone tabulatorem i rozpoznany nagłówek „Ćwiczenie”
  if (text.includes('\t')) {
    const raw = parseTable(text);
    const rows = normalizeLayout([{ name: '', rows: raw }])?.rows ?? raw;
    const c = detectColumns(rows);
    if (c.map.includes('exercise') && c.headerRow >= 0) {
      const r = sheetToPlan(rows, c.map, c.headerRow, { clientId: '', startDate: today, today });
      const k = r.plan.weeks.flatMap((w) => w.workouts).find((x) => x.exercises.some((e) => e.name.trim()));
      if (k) {
        const more = r.plan.weeks.flatMap((w) => w.workouts).filter((x) => x.exercises.some((e) => e.name.trim())).length - 1;
        return {
          name: k.name && !/^trening\s*\d*$/i.test(k.name) ? k.name : undefined,
          exercises: k.exercises.filter((e) => e.name.trim()).map((e) => ({ ...e, id: uid() })),
          skipped: [],
          warnings: [...r.warnings.filter((w) => !/dni tygodnia/i.test(w)), ...(more > 0 ? [`W zakresie jest więcej treningów (${more + 1}) — wzięty pierwszy. Cały plan wczytasz przez „Import z arkusza”.`] : [])],
          from: 'sheet',
        };
      }
    }
  }
  const n = parseWorkoutNote(text, { plan: true });
  if (!n.exercises.length) return { exercises: [], skipped: n.skipped, warnings: n.warnings, from: 'note' };
  const wo = sessionToWorkout({ id: uid(), clientId: '', date: n.date ?? today, exercises: n.exercises } as never);
  // superseria („SUPERSERIA – …”, „+”) — zapis treningu jej nie przenosi, więc z notatki po kolei
  const linked = n.exercises.filter((e) => e.name.trim()).map((e) => !!(e as { linked?: boolean }).linked);
  return { exercises: wo.exercises.map((e, i) => ({ ...e, name: tidy(e.name), ...(linked[i] ? { linked: true } : {}) })), skipped: n.skipped, warnings: n.warnings, from: 'note' };
}

/** „hiptrust” → „Hiptrust”, „DL” zostaje. */
const tidy = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
