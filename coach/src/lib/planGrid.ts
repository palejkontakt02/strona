import type { Plan, PlanExercise, PlanWeek, PlanWorkout } from '../domain';
import { exerciseLabels, expandSets, mergeGroups, WEEKDAYS, workoutDate } from './plan';
import { cardioByName, isTimed, perSideByName } from './run';
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
  let n = 0;
  return expandSets(e.groups).map((g) => {
    const warm = g.type === 'Rozgrzewka';
    if (!warm) n++;
    const reps = timed && secOf(g.reps) != null ? fmtSec(secOf(g.reps)!) : g.reps.trim() || '?';
    const kind = !warm && g.type !== 'Robocze' && PREFIX[g.type] ? ` (${PREFIX[g.type]})` : '';
    return { no: warm ? 'R' : String(n), warm, reps: `${reps}${side}${kind}`, load: g.load.trim() ? kg(g.load) : '', rpe: g.rpe.trim() };
  });
}

export interface GridRow {
  name: string;
  label: string;
  notes?: string;
  rest?: string;
  linked: boolean;
  /** Bieg / cardio: kolumny to odcinek | cel | RPE. */
  cardio: boolean;
  /** Wiersze serii: numer („R”, „1”…) i komórka w każdym tygodniu (null — brak tej serii, 'none' — brak ćwiczenia w tygodniu). */
  lines: { no: string; cells: (GridCell | null | 'none')[] }[];
}
export interface GridSlot {
  name: string;
  cols: { week: PlanWeek; k: PlanWorkout; /** Data z dnia tygodnia / daty jednostki. */ date?: string }[];
  rows: GridRow[];
  hasWarm: boolean;
}

/**
 * Plan jako arkusz: treningi łączone po nazwie (Trening A w każdym tygodniu); wiersz na serię, kolumny = tygodnie.
 * Serie wyrównane po numerze (rozgrzewki R, potem 1, 2, 3…); bieg — odcinki po kolei. `warm` — czy pokazać rozgrzewki.
 */
export function planGrid(plan: Plan, warm: (slot: string) => boolean, perRep = false): GridSlot[] {
  const names: string[] = [];
  for (const w of plan.weeks) for (const k of w.workouts) if (!names.includes(k.name)) names.push(k.name);
  return names.map((slot) => {
    const cols = plan.weeks.flatMap((w, wi) => {
      const k = w.workouts.find((x) => x.name === slot);
      return k ? [{ week: w, k, date: workoutDate(plan, wi, k) }] : [];
    });
    const base: { name: string; label: string; first: PlanExercise }[] = [];
    for (const c of cols) {
      const labels = exerciseLabels(c.k.exercises);
      c.k.exercises.forEach((e, i) => {
        if (e.name.trim() && !base.some((r) => r.name === e.name)) base.push({ name: e.name, label: labels[i], first: e });
      });
    }
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
      return { name: r.name, label: r.label, notes: r.first.notes || undefined, rest: r.first.rest || undefined, linked: /\d$/.test(r.label) && !r.label.endsWith('1'), cardio: !!isCardio, lines };
    });
    return { name: slot, cols, rows, hasWarm };
  });
}

/** „pon. 20.10” */
export function fmtWeekdayDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return `${WEEKDAYS[(d.getDay() + 6) % 7]} ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}
