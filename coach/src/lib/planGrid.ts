import type { Plan, PlanExercise, PlanWeek, PlanWorkout } from '../domain';
import { exerciseLabels, expandSets, mergeGroups, WEEKDAYS, workoutDate } from './plan';
import { cardioByName, isTimed, LOAD_PER_TEXT, loadPerOf, perSideByName } from './run';
import { fmtDur, fmtKm, parseDur, parseKm } from './running';
import { fmtSec, secOf } from './parse';

const kg = (load: string) => (/^\d+([.,]\d+)?$/.test(load.trim()) ? `${load.trim().replace('.', ',')} kg` : load.trim());
const PREFIX: Record<string, string> = { Rozgrzewka: 'R', 'Top set': 'Top', 'Back-off': 'B-off', 'Drop set': 'Drop', AMRAP: 'AMRAP', Schłodzenie: 'S', Przerwa: 'trucht' };

/** Komórka serii rozbita na kolumny: powtórzenia (lub czas / dystans), ciężar (lub cel biegu), RPE. */
export interface GridCell {
  reps: string;
  load: string;
  rpe: string;
  warm: boolean;
}

/** Bieg / cardio: odcinki po kolei (rozgrzewka, „5 × 1 km”, trucht, schłodzenie). */
function cardioCells(e: PlanExercise, perRep = false): (GridCell & { no: string })[] {
  let n = 0;
  // perRep: każde powtórzenie osobno (porównanie z wykonaniem, które jest zapisane powtórzenie po powtórzeniu)
  const groups = perRep ? e.groups.flatMap((g) => Array.from({ length: Math.max(1, Number(g.sets) || 1) }, () => ({ ...g, sets: '1', rest: Number(g.sets) > 1 ? g.rest : undefined }))) : mergeGroups(e.groups);
  return groups.map((g) => {
    const reps = Number(g.sets) || 1;
    const warm = g.type === 'Rozgrzewka' || g.type === 'Schłodzenie' || g.type === 'Przerwa';
    if (!warm) n++;
    const d = parseDur(g.reps);
    const km = parseKm(g.load);
    const what = [km != null ? fmtKm(km) : g.load.trim(), d != null ? fmtDur(d) : g.reps.trim()].filter(Boolean).join(' / ') || '?';
    const pre = PREFIX[g.type] ? `${PREFIX[g.type]} ` : '';
    return {
      no: warm ? (PREFIX[g.type] ?? '') : String(n),
      warm,
      reps: `${pre}${reps > 1 ? `${reps} × ` : ''}${what}`,
      load: [g.pace, g.rest && (reps > 1 || perRep) ? `p. ${g.rest}` : ''].filter(Boolean).join(' · '),
      rpe: g.rpe || '',
    };
  });
}

/** Serie ćwiczenia po kolei (każda osobno): numer („R”, „1”, „2”…), powtórzenia, ciężar, RPE. */
export function setCells(e: PlanExercise, perRep = false): (GridCell & { no: string })[] {
  if (e.cardio ?? cardioByName(e.name)) return cardioCells(e, perRep);
  const timed = isTimed(e);
  const side = (e.perSide ?? perSideByName(e.name)) ? '/str.' : '';
  // „8/str.” wpisane ręcznie — bez drugiego „/str.”
  const hasSide = (r: string) => /\/\s*str|na\s+str|\bstr\.?\s*$|\/\s*stron/i.test(r);
  let n = 0;
  return expandSets(e.groups).map((g) => {
    const warm = g.type === 'Rozgrzewka';
    if (!warm) n++;
    const reps = timed && secOf(g.reps) != null ? fmtSec(secOf(g.reps)!) : g.reps.trim() || '?';
    const kind = !warm && g.type !== 'Robocze' && PREFIX[g.type] ? ` (${PREFIX[g.type]})` : '';
    return { no: warm ? 'R' : String(n), warm, reps: `${reps}${hasSide(reps) ? '' : side}${kind}`, load: g.load.trim() ? kg(g.load) : '', rpe: g.rpe.trim() };
  });
}

export interface GridRow {
  name: string;
  /** Oznaczenie w tygodniu odniesienia; gdy w innych tygodniach ćwiczenie ma inną literę — wszystkie po kolei („A/B”). */
  label: string;
  /** Oznaczenie w każdym tygodniu (kolumnie) — undefined, gdy ćwiczenia w tym tygodniu nie ma. */
  labels: (string | undefined)[];
  /** Notatka: wspólna albo z tygodniami („T1: … · T3: …”), gdy różne. */
  notes?: string;
  /** Notatka ćwiczenia w każdym tygodniu (kolumnie). */
  weekNotes: (string | undefined)[];
  rest?: string;
  linked: boolean;
  /** Bieg / cardio: kolumny to odcinek | cel | RPE. */
  cardio: boolean;
  /** Hantle: „1 hantel” / „2 hantle (suma)” — jak czytać ciężar. */
  loadPer?: string;
  /** Wiersze serii: numer („R”, „1”…) i komórka w każdym tygodniu (null — brak tej serii, 'none' — brak ćwiczenia w tygodniu). */
  lines: { no: string; cells: (GridCell | null | 'none')[] }[];
}
export interface GridSlot {
  name: string;
  cols: { week: PlanWeek; k: PlanWorkout; /** Data z dnia tygodnia / daty jednostki. */ date?: string }[];
  rows: GridRow[];
  hasWarm: boolean;
  /** Kolejność ćwiczeń różni się między tygodniami (wiersze są w kolejności tygodnia odniesienia). */
  orderVaries: boolean;
}

export interface GridOpts {
  /** Indeks tygodnia, którego kolejność ćwiczeń wyznacza wiersze (np. bieżący / najbliższy). Domyślnie pierwszy tydzień. */
  refWeek?: number;
}

/**
 * Plan jako arkusz: treningi łączone po nazwie (Trening A w każdym tygodniu); wiersz na serię, kolumny = tygodnie.
 * Serie wyrównane po numerze (rozgrzewki R, potem 1, 2, 3…); bieg — odcinki po kolei. `warm` — czy pokazać rozgrzewki.
 */
export function planGrid(plan: Plan, warm: (slot: string) => boolean, perRep = false, opts: GridOpts = {}): GridSlot[] {
  const names: string[] = [];
  for (const w of plan.weeks) for (const k of w.workouts) if (!names.includes(k.name)) names.push(k.name);
  const refWeekId = plan.weeks[Math.min(Math.max(0, opts.refWeek ?? 0), Math.max(0, plan.weeks.length - 1))]?.id;
  return names.map((slot) => {
    const cols = plan.weeks.flatMap((w, wi) => {
      const k = w.workouts.find((x) => x.name === slot);
      return k ? [{ week: w, k, date: workoutDate(plan, wi, k) }] : [];
    });
    // Kolejność wierszy: najpierw tydzień odniesienia, potem ćwiczenia, których w nim nie ma (z dalszych tygodni).
    const ordered = [...cols.filter((c) => c.week.id === refWeekId), ...cols.filter((c) => c.week.id !== refWeekId)];
    const base: { name: string; first: PlanExercise }[] = [];
    for (const c of ordered) {
      c.k.exercises.forEach((e) => {
        if (e.name.trim() && !base.some((r) => r.name === e.name)) base.push({ name: e.name, first: e });
      });
    }
    const colLabels = cols.map(({ k }) => {
      const labels = exerciseLabels(k.exercises);
      const m = new Map<string, string>();
      k.exercises.forEach((e, i) => { if (e.name.trim() && !m.has(e.name)) m.set(e.name, labels[i]); });
      return m;
    });
    const seqOf = (c: (typeof cols)[number]) => base.map((r) => r.name).filter((n) => c.k.exercises.some((e) => e.name === n));
    const orderVaries = cols.some((c) => {
      const mine = c.k.exercises.map((e) => e.name).filter((n, i, a) => n.trim() && a.indexOf(n) === i);
      const ref = seqOf(c);
      return mine.join('\u0000') !== ref.join('\u0000');
    });
    const hasWarm = cols.some((c) => c.k.exercises.some((e) => !(e.cardio ?? cardioByName(e.name)) && e.groups.some((g) => g.type === 'Rozgrzewka')));
    const showWarm = warm(slot);
    const rows: GridRow[] = base.map((r) => {
      const isCardio = r.first.cardio ?? cardioByName(r.name);
      const keyed = cols.map(({ k }) => {
        const e = k.exercises.find((x) => x.name === r.name);
        if (!e) return null;
        const cells = setCells(e, perRep);
        if (isCardio) return new Map(cells.map((c, idx) => [`x${idx + 1}`, c] as const));
        let w = 0;
        return new Map(cells.map((c) => [c.warm && c.no !== '' ? `R${++w}` : c.no || `x${++w}`, c] as const));
      });
      const count = (f: (k: string) => boolean) => Math.max(0, ...keyed.map((m) => (m ? [...m.keys()].filter(f).length : 0)));
      const warmN = count((k) => k.startsWith('R'));
      const workN = count((k) => /^\d+$/.test(k));
      const otherN = count((k) => k.startsWith('x'));
      const keys = [...Array.from({ length: showWarm ? warmN : 0 }, (_, i) => `R${i + 1}`), ...Array.from({ length: workN }, (_, i) => String(i + 1)), ...Array.from({ length: otherN }, (_, i) => `x${i + 1}`)];
      const no = (key: string) => (key.startsWith('R') ? (warmN > 1 ? key : 'R') : key.startsWith('x') ? (isCardio ? key.slice(1) : '') : key);
      const lines = (keys.length ? keys : ['']).map((key, i) => ({
        no: key ? no(key) : '',
        cells: keyed.map((m) => (m == null ? (i === 0 ? ('none' as const) : null) : (m.get(key) ?? null))),
      }));
      const labels = colLabels.map((m) => m.get(r.name));
      const refIdx = cols.findIndex((c) => c.week.id === refWeekId && labels[cols.indexOf(c)]);
      const refLabel = labels[refIdx >= 0 ? refIdx : labels.findIndex(Boolean)] ?? '';
      const uniq = [refLabel, ...labels.filter((l): l is string => !!l && l !== refLabel)].filter((l, i, a) => a.indexOf(l) === i);
      const label = uniq.join('/');
      const weekNotes = cols.map(({ k }) => k.exercises.find((x) => x.name === r.name)?.notes?.trim() || undefined);
      const uNotes = [...new Set(weekNotes.filter(Boolean))];
      const notes = uNotes.length <= 1 ? uNotes[0] : cols.map((c, i) => (weekNotes[i] ? `${c.week.name}: ${weekNotes[i]}` : '')).filter(Boolean).join(' · ');
      return { name: r.name, label, labels, notes, weekNotes, linked: /\d$/.test(refLabel) && !refLabel.endsWith('1'), rest: r.first.rest || undefined, cardio: !!isCardio, loadPer: !isCardio && !isTimed(r.first) && loadPerOf(r.first) ? LOAD_PER_TEXT[loadPerOf(r.first)!] : undefined, lines };
    });
    return { name: slot, cols, rows, hasWarm, orderVaries };
  });
}

/** „pon. 20.10” */
export function fmtWeekdayDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return `${WEEKDAYS[(d.getDay() + 6) % 7]} ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}
