import type { Client, Plan, PlanExercise, PlanWorkout, SessionExercise, SetGroup, TrainingSession } from '../domain';
import { fmtClock, planRunTotals, runTotals } from './running';
import { cardioByName } from './run';
import { exerciseLabels, mergeGroups } from './plan';
import { fold, parseDay } from './sheetImport';
import { colName, sheetName, type XCell, type XSheet, type XStyle } from './xlsxWrite';

/**
 * Stały szablon planu Fitowej (do pisania w Excelu / Arkuszach Google i wczytania w aplikacji):
 *
 * - zakładka = jeden dzień treningowy (jednostka), np. „Pon – góra”;
 * - na górze pola: Plan | Podopieczny | Start | Dzień tygodnia | Trening;
 * - wiersz „Tydzień 1 | Tydzień 2 | …” nad grupami kolumn, pod nim nagłówek:
 *   Ozn. | Ćwiczenie | Typ | Przerwa | Uwagi | (Serie | Powt. | % 1RM | Kg | RPE | Uwagi tyg.) × liczba tygodni;
 * - wiersz = ćwiczenie; kolejny wiersz bez nazwy = następna grupa serii tego ćwiczenia (np. back-off po top secie);
 * - Ozn. A1 / A2 — superseria (B1 / B2 / B3 — triseria), A, B, C — pojedyncze ćwiczenia;
 * - puste Serie i Powt. w tygodniu = ćwiczenia nie ma w tym tygodniu.
 */

export const TEMPLATE_FIXED = ['Ozn.', 'Ćwiczenie', 'Typ', 'Przerwa', 'Uwagi'] as const;
export const TEMPLATE_WEEK = ['Serie', 'Powt.', '% 1RM', 'Kg', 'RPE', 'Uwagi tyg.'] as const;
const KEYS = ['Plan', 'Podopieczny', 'Start', 'Dzień tygodnia', 'Trening'] as const;
const DAY_PL = ['', 'pon', 'wt', 'śr', 'czw', 'pt', 'sob', 'niedz'];

// ——— wygląd ———
const INK = '000000';
const GRID = 'A6A6A6';
const box = (fill?: string, o: Partial<XStyle> = {}): XStyle => ({ fill, color: INK, align: 'center', valign: 'center', bc: GRID, border: { l: 'thin', r: 'thin', t: 'thin', b: 'thin' }, ...o });
const S = {
  title: { bold: true, size: 14, align: 'left' } as XStyle,
  key: { bold: true, align: 'left', color: '404040' } as XStyle,
  val: box('FFF2CC', { align: 'left', indent: 1 }),
  week: box('404040', { bold: true, color: 'FFFFFF', border: { l: 'medium', r: 'medium', t: 'medium', b: 'thin' } }),
  head: box('9FC5E8', { bold: true, wrap: true }),
  fixed: box(undefined, { align: 'left', indent: 1, wrap: true }),
  ex: box(undefined, { align: 'left', indent: 1, bold: true, wrap: true }),
  cellA: box('FFFFFF'),
  cellB: box('F3F3F3'),
  note: box(undefined, { align: 'left', wrap: true, size: 9 }),
  hint: { italic: true, size: 9, color: '595959', align: 'left', wrap: true } as XStyle,
  // wykonanie: zielonkawe tło, odróżnia „co zrobione” od „co zaplanowane”
  weekDone: box('274E13', { bold: true, color: 'FFFFFF', border: { l: 'medium', r: 'medium', t: 'medium', b: 'thin' } }),
  headDone: box('B6D7A8', { bold: true, wrap: true }),
  done: box('F4FAF1', { align: 'left', wrap: true, size: 9 }),
};
const c = (v: string | number | null | undefined, st: XStyle): XCell => ({ v: v === '' ? null : v, st });

const pctOf = (load: string) => load.trim().match(/^(\d+(?:[.,]\d+)?)\s*%$/)?.[1]?.replace('.', ',') ?? '';
const numOr = (v: string): string | number => {
  const t = v.trim();
  return /^-?\d+(?:[.,]\d+)?$/.test(t) ? Number(t.replace(',', '.')) : t;
};
/** „88% 1RM. Uwagi” (zapis importu) → procent osobno, uwagi bez niego. */
function splitPctNote(notes?: string): { pct: string; notes: string } {
  const m = (notes ?? '').match(/^\s*(\d+(?:[.,]\d+)?)\s*%\s*1RM\.?\s*/i);
  return m ? { pct: m[1].replace('.', ','), notes: (notes ?? '').slice(m[0].length).trim() } : { pct: '', notes: (notes ?? '').trim() };
}

interface Unit {
  name: string;
  day?: number;
  /** Jednostka planu w każdym tygodniu (do dopasowania zapisanego treningu). */
  wk: (PlanWorkout | undefined)[];
  /** Ćwiczenia (po nazwie) → tydzień → ćwiczenie w tym tygodniu. */
  ex: { key: string; name: string; label: string; perWeek: (PlanExercise | undefined)[] }[];
}

/** Jednostki planu po nazwie (kolejność z pierwszego tygodnia), ćwiczenia po nazwie w każdym tygodniu. */
function units(plan: Plan): Unit[] {
  const out: Unit[] = [];
  plan.weeks.forEach((w, wi) =>
    w.workouts.forEach((k, ki) => {
      const key = fold(k.name) || `#${ki}`;
      let u = out.find((x) => (fold(x.name) || `#${out.indexOf(x)}`) === key);
      if (!u) {
        u = { name: k.name || `Dzień ${ki + 1}`, wk: [], day: k.day ?? (k.date ? ((new Date(`${k.date}T12:00:00`).getDay() + 6) % 7) + 1 : undefined), ex: [] };
        out.push(u);
      }
      u.wk[wi] ??= k;
      const labels = exerciseLabels(k.exercises);
      k.exercises.forEach((e, ei) => {
        if (!e.name.trim()) return;
        const ek = fold(e.name);
        let row = u!.ex.find((x) => x.key === ek && !x.perWeek[wi]);
        if (!row) {
          row = { key: ek, name: e.name.trim(), label: labels[ei], perWeek: [] };
          u!.ex.push(row);
        }
        row.perWeek[wi] = e;
      });
    }),
  );
  return out;
}

// ——— wykonanie (arkusz prowadzony automatycznie z aplikacji) ———

const num = (v: number) => String(Math.round(v * 100) / 100).replace('.', ',');
const shortDate = (d: string) => `${Number(d.slice(8))}.${Number(d.slice(5, 7))}`;

/** Serie robocze jednym tekstem: „50×6 @7 · 55×6 @8”; bez ciężaru „8 @7”, na czas „25 s”. */
export function doneText(e: SessionExercise | undefined): string {
  const sets = (e?.setsLog ?? []).filter((x) => !x.warmup && x.done !== false && (x.reps != null || x.load != null));
  return sets
    .map((x) => {
      const reps = x.reps != null ? `${num(x.reps)}${x.unit ? ` ${x.unit}` : ''}${x.repsR != null ? `/${num(x.repsR)}` : ''}` : '';
      const base = x.load != null ? `${num(x.load)}×${reps || '?'}` : reps;
      return `${base}${x.rpe != null ? ` @${num(x.rpe)}` : ''}`;
    })
    .join(' · ');
}

/** Zapisany trening danej jednostki planu (ostatni, jeśli kilka). */
function sessionOf(plan: Plan, k: PlanWorkout | undefined, sessions: TrainingSession[]): TrainingSession | undefined {
  if (!k) return undefined;
  return sessions.filter((s) => s.planId === plan.id && s.workoutId === k.id).sort((a, b) => b.date.localeCompare(a.date))[0];
}

/**
 * Ćwiczenie z zapisu pasujące do ćwiczenia planu: po nazwie; ćwiczenia bez pary po nazwie (zamiennik, zmieniona nazwa)
 * łączone po kolei — n-te niedopasowane z planu z n-tym niedopasowanym z zapisu.
 */
function sessionEx(s: TrainingSession | undefined, k: PlanWorkout | undefined, name: string): SessionExercise | undefined {
  if (!s) return undefined;
  const byName = s.exercises.find((x) => fold(x.name) === fold(name));
  if (byName || !k) return byName;
  const planNames = new Set(k.exercises.filter((e) => e.name.trim()).map((e) => fold(e.name)));
  const sesNames = new Set(s.exercises.map((x) => fold(x.name)));
  const freePlan = k.exercises.filter((e) => e.name.trim() && !sesNames.has(fold(e.name)));
  const freeSes = s.exercises.filter((x) => !planNames.has(fold(x.name)));
  const i = freePlan.findIndex((e) => fold(e.name) === fold(name));
  return i >= 0 ? freeSes[i] : undefined;
}

/** Arkusz szablonu dla jednej jednostki (albo pusty, gdy `unit` brak). Z `sessions` — kolumna „Wykonano” przy każdym tygodniu. */
function unitSheet(plan: Plan | null, unit: Unit | null, weeks: string[], client: string, taken: string[], emptyRows = 15, sessions?: TrainingSession[]): XSheet {
  const rows: XCell[][] = [];
  const merges: string[] = [];
  const W0 = TEMPLATE_FIXED.length;
  const withDone = !!sessions && !!plan && !!unit;
  const WEEK_COLS: readonly string[] = withDone ? [...TEMPLATE_WEEK, 'Wykonano'] : TEMPLATE_WEEK;
  const PW = WEEK_COLS.length;
  const done = withDone ? unit!.wk.map((k) => sessionOf(plan!, k, sessions!)) : [];
  const last = W0 + weeks.length * PW - 1;
  const name = unit?.name ?? 'Dzień 1';
  rows.push([c(`Plan treningowy — ${name}`, S.title)]);
  const vals: Record<(typeof KEYS)[number], string> = {
    Plan: plan?.name ?? '',
    Podopieczny: client,
    Start: plan?.startDate ? plan.startDate.split('-').reverse().join('.') : '',
    'Dzień tygodnia': unit?.day ? DAY_PL[unit.day] : '',
    Trening: name,
  };
  for (const k of KEYS) {
    rows.push([null, c(k, S.key), c(vals[k], S.val), c(null, S.val), c(null, S.val)]);
    merges.push(`C${rows.length}:E${rows.length}`);
  }
  rows.push([
    c(
      withDone
        ? 'Arkusz prowadzi aplikacja Fitowa: plan i kolumna „Wykonano” (serie robocze: kg×powtórzenia @RPE) uzupełniają się same po zapisaniu treningu. Zmiany planu rób w aplikacji. Własne notatki trzymaj w osobnej zakładce.'
        : 'Wypełniaj żółte pola i tabelę. Wiersz bez nazwy ćwiczenia = kolejne serie ćwiczenia wyżej (np. back-off). Ozn. A1/A2 = superseria. Ciężar: Kg albo % 1RM (albo oba). Nie zmieniaj nazw nagłówków.',
      S.hint,
    ),
  ]);
  merges.push(`A${rows.length}:${colName(Math.min(last, 12))}${rows.length}`);
  rows.push([]);
  // wiersz tygodni
  const wr: XCell[] = TEMPLATE_FIXED.map(() => null);
  weeks.forEach((w, i) => {
    const label = done[i] ? `${w} · ${shortDate(done[i]!.date)} ✓` : w;
    for (let j = 0; j < PW; j++) wr.push(c(j === 0 ? label : null, done[i] ? S.weekDone : S.week));
    merges.push(`${colName(W0 + i * PW)}${rows.length + 1}:${colName(W0 + i * PW + PW - 1)}${rows.length + 1}`);
  });
  rows.push(wr);
  const headRow = rows.length;
  rows.push([...TEMPLATE_FIXED.map((h) => c(h, S.head)), ...weeks.flatMap(() => WEEK_COLS.map((h) => c(h, h === 'Wykonano' ? S.headDone : S.head)))]);

  const weekCells = (g: SetGroup | undefined, e: PlanExercise | undefined, first: boolean, wi: number): XCell[] => {
    const st = wi % 2 ? S.cellB : S.cellA;
    if (!g || !e) return WEEK_COLS.map((h) => c(null, h === 'Uwagi tyg.' ? S.note : h === 'Wykonano' ? S.done : st));
    const sp = splitPctNote(e.notes);
    const pct = pctOf(g.load) || (first ? sp.pct : '');
    const kg = pctOf(g.load) ? '' : g.load;
    const reps = e.perSide && g.reps && !/\/\s*str/i.test(g.reps) ? `${g.reps}/str.` : g.reps;
    const kgCell = kg && e.loadPer === 'one' ? `${kg.replace('.', ',')}/rękę` : numOr(kg);
    const out = [c(numOr(g.sets || '1'), st), c(numOr(reps), st), c(pct ? numOr(pct) : null, st), c(kgCell, st), c(numOr(g.rpe), st), c(null, S.note)];
    if (withDone) out.push(c(null, S.done));
    return out;
  };

  if (unit) {
    for (const ex of unit.ex) {
      const per = weeks.map((_w, wi) => ex.perWeek[wi]);
      const groups = per.map((e) => (e ? mergeGroups(structuredClone(e.groups)) : []));
      const n = Math.max(1, ...groups.map((g) => g.length));
      // uwagi stałe: te same we wszystkich tygodniach (bez procentu 1RM) — inaczej w kolumnie tygodnia
      const notes = per.map((e) => (e ? splitPctNote(e.notes).notes : null));
      const present = notes.filter((x): x is string => x != null);
      const same = present.length > 0 && present.every((x) => x === present[0]);
      const first = per.find(Boolean)!;
      for (let gi = 0; gi < n; gi++) {
        const type = groups.map((g) => g[gi]?.type).find(Boolean);
        const r: XCell[] = [
          c(gi === 0 ? ex.label : null, S.fixed),
          c(gi === 0 ? ex.name : null, S.ex),
          c(type && type !== 'Robocze' ? type : null, S.fixed),
          c(gi === 0 ? (first.rest ?? '') : null, S.fixed),
          c(gi === 0 && same ? present[0] : null, S.note),
        ];
        weeks.forEach((_w, wi) => {
          const cells = weekCells(groups[wi][gi], per[wi], gi === 0, wi);
          const NI = WEEK_COLS.indexOf('Uwagi tyg.');
          if (gi === 0 && !same && notes[wi]) cells[NI] = c(notes[wi], S.note);
          if (withDone && gi === 0 && done[wi] && per[wi]) {
            cells[PW - 1] = c(doneText(sessionEx(done[wi], unit!.wk[wi], ex.name)) || '—', S.done);
          }
          r.push(...cells);
        });
        rows.push(r);
      }
    }
  }
  if (withDone && done.some(Boolean)) {
    // podsumowanie treningu pod tabelą: czas, sRPE, ból, notatka
    const r: XCell[] = [null, c('Podsumowanie', S.ex), null, null, null];
    weeks.forEach((_w, wi) => {
      const sx = done[wi];
      const cells: XCell[] = WEEK_COLS.map(() => null);
      if (sx) cells[PW - 1] = c([sx.duration && `${sx.duration} min`, sx.srpe != null && `sRPE ${sx.srpe}`, sx.pain != null && `ból ${sx.pain}`, sx.solo === false ? 'z trenerem' : '', sx.notes].filter(Boolean).join(' · '), S.done);
      r.push(...cells);
    });
    rows.push(r);
  }
  for (let i = 0; i < (unit?.ex.length ? 3 : emptyRows); i++) rows.push([...TEMPLATE_FIXED.map((_h, j) => c(null, j === 1 ? S.ex : S.fixed)), ...weeks.flatMap((_w, wi) => weekCells(undefined, undefined, false, wi))]);
  return {
    name: sheetName(name, taken),
    rows,
    merges,
    widths: [6, 28, 10, 8, 28, ...weeks.flatMap(() => [6, 8, 7, 8, 6, 18, ...(withDone ? [26] : [])])],
    heights: { [headRow]: 30 },
    freezeCols: 2,
    landscape: true,
    fitWidth: true,
    noGrid: true,
  };
}

/** Szablon do pisania planu: z gotowego planu (round-trip) albo pusty (dni × tygodnie). */
export function templateWorkbook(plan: Plan | null, client?: Pick<Client, 'name'>, empty = { days: ['Dzień 1', 'Dzień 2', 'Dzień 3'], weeks: 4 }): XSheet[] {
  const taken: string[] = [];
  const add = (s: XSheet) => {
    taken.push(s.name);
    return s;
  };
  if (plan && plan.weeks.length) {
    const weeks = plan.weeks.map((w) => w.name);
    return units(plan).map((u) => add(unitSheet(plan, u, weeks, client?.name ?? '', taken)));
  }
  const weeks = Array.from({ length: empty.weeks }, (_x, i) => `Tydzień ${i + 1}`);
  return empty.days.map((d) => add(unitSheet(null, { name: d, ex: [], wk: [] }, weeks, client?.name ?? '', taken)));
}

/** Plan biegowy: wszystkie ćwiczenia to cardio. */
export const isRunPlan = (plan: Plan) => {
  const ex = plan.weeks.flatMap((w) => w.workouts.flatMap((k) => k.exercises)).filter((e) => e.name.trim());
  return ex.length > 0 && ex.every((e) => e.cardio ?? cardioByName(e.name));
};

const DAY_SHORT = ['niedz', 'pon', 'wt', 'śr', 'czw', 'pt', 'sob'];

/** Opis odcinków jednostki biegowej: „Rozgrzewka 2 km · 5 × 800 m (2:00 trucht) · Schłodzenie 1 km”. */
function runDesc(k: PlanWorkout): string {
  return k.exercises
    .flatMap((e) =>
      e.groups.map((g) => {
        const n = Number(g.sets || '1') || 1;
        const km = g.load ? (/\d\s*m$/i.test(g.load.trim()) ? g.load.trim() : `${g.load.trim()} km`) : '';
        const what = [km, g.reps && `${g.reps} min`].filter(Boolean).join(' / ') || 'odcinek';
        const head = g.type === 'Rozgrzewka' || g.type === 'Schłodzenie' ? `${g.type} ` : '';
        return `${head}${n > 1 ? `${n} × ` : ''}${what}${g.rest ? ` (przerwa ${g.rest})` : ''}`;
      }),
    )
    .join(' · ');
}

/** Tempo docelowe odcinków roboczych (bez rozgrzewki i schłodzenia). */
function runPace(k: PlanWorkout): string {
  const all = k.exercises.flatMap((e) => e.groups.filter((g) => g.type !== 'Rozgrzewka' && g.type !== 'Schłodzenie').map((g) => g.pace?.trim()).filter(Boolean));
  return [...new Set(all)].join(', ');
}

const RUN_HEAD = ['Tydzień', 'Dzień', 'Data', 'Trening', 'Plan (odcinki)', 'Dystans (km)', 'Tempo cel (/km)', 'Data wyk.', 'km', 'Czas', 'Śr. tempo', 'Śr. tętno', 'RPE', 'Uwagi'] as const;

/** Arkusz planu biegowego: wiersz = jednostka (plan po lewej, wykonanie po prawej). */
function runSheet(plan: Plan, client: string, sessions: TrainingSession[], taken: string[]): XSheet {
  const rows: XCell[][] = [];
  const merges: string[] = [];
  rows.push([c(`Plan biegowy — ${plan.name}`, S.title)]);
  const vals: [string, string][] = [
    ['Plan', plan.name],
    ['Podopieczny', client],
    ['Start', plan.startDate ? plan.startDate.split('-').reverse().join('.') : ''],
  ];
  for (const [k, v] of vals) {
    rows.push([null, c(k, S.key), c(v, S.val), c(null, S.val), c(null, S.val)]);
    merges.push(`C${rows.length}:E${rows.length}`);
  }
  if (plan.notes) {
    rows.push([c(plan.notes, S.hint)]);
    merges.push(`A${rows.length}:N${rows.length}`);
  }
  rows.push([c('Arkusz prowadzi aplikacja Fitowa: plan po lewej, wykonanie (zielone kolumny) uzupełnia się samo po zapisaniu biegu.', S.hint)]);
  merges.push(`A${rows.length}:N${rows.length}`);
  rows.push([]);
  const wr: XCell[] = Array.from({ length: 7 }, (_x, i) => c(i === 0 ? 'PLAN' : null, S.week));
  for (let i = 0; i < 7; i++) wr.push(c(i === 0 ? 'WYKONANIE' : null, S.weekDone));
  rows.push(wr);
  merges.push(`A${rows.length}:G${rows.length}`, `H${rows.length}:N${rows.length}`);
  const headRow = rows.length + 1;
  rows.push(RUN_HEAD.map((h, i) => c(h, i >= 7 ? S.headDone : S.head)));
  const lastNote = new Map<string, string>();
  plan.weeks.forEach((w, wi) => {
    w.workouts.forEach((k, ki) => {
      const st = wi % 2 ? S.cellB : S.cellA;
      const sx = sessionOf(plan, k, sessions);
      const t = sx ? runTotals(sx) : null;
      const hrs = (sx?.exercises ?? []).flatMap((e) => e.setsLog ?? []).map((x) => x.hr).filter((x): x is number => !!x);
      const km = planRunTotals(k.exercises.flatMap((e) => e.groups)).km;
      const dow = k.date ? DAY_SHORT[new Date(`${k.date}T12:00:00`).getDay()] : k.day ? DAY_PL[k.day] : '';
      // uwagi z planu tylko, gdy inne niż w poprzedniej jednostce o tej nazwie (bez powtarzania stałego opisu co tydzień)
      const pn = k.exercises.map((e) => e.notes).filter(Boolean).join(' ');
      const prev = lastNote.get(k.name);
      lastNote.set(k.name, pn);
      const notes = [pn !== prev ? pn : '', sx?.notes].filter(Boolean).join(' · ');
      rows.push([
        c(ki === 0 ? w.name : null, S.ex),
        c(dow, st),
        c(k.date ? shortDate(k.date) : null, st),
        c(k.name, { ...st, align: 'left', wrap: true }),
        c(runDesc(k), { ...st, align: 'left', wrap: true, size: 9 }),
        c(km ? Number(km.toFixed(1)) : null, st),
        c(runPace(k) || null, st),
        c(sx ? shortDate(sx.date) : null, S.done),
        c(t?.km ? Number(t.km.toFixed(2)) : null, S.done),
        c(t?.min ? fmtClock(t.min) : sx?.duration ? `${sx.duration} min` : null, S.done),
        c(t?.pace || null, S.done),
        c(hrs.length ? Math.round(hrs.reduce((a, x) => a + x, 0) / hrs.length) : null, S.done),
        c(sx?.srpe ?? null, S.done),
        c(notes || null, S.done),
      ]);
    });
  });
  return {
    name: sheetName('Bieganie', taken),
    rows,
    merges,
    widths: [16, 7, 7, 24, 40, 9, 14, 9, 7, 9, 9, 9, 6, 36],
    heights: { [headRow]: 30 },
    freezeCols: 4,
    landscape: true,
    fitWidth: true,
    noGrid: true,
  };
}

/**
 * Arkusz Fitowa podopiecznego (prowadzony automatycznie): wzór planu Fitowa z kolumną „Wykonano” przy każdym
 * tygodniu (zakładka = dzień treningowy), a plany biegowe w układzie biegowym (zakładka „Bieganie”).
 */
export function fitowaWorkbook(plans: Plan[], client: Pick<Client, 'name'>, sessions: TrainingSession[]): XSheet[] {
  const taken: string[] = [];
  const out: XSheet[] = [];
  for (const plan of plans.filter((p) => p.weeks.length)) {
    if (isRunPlan(plan)) {
      const sh = runSheet(plan, client.name, sessions, taken);
      taken.push(sh.name);
      out.push(sh);
      continue;
    }
    const weeks = plan.weeks.map((w) => w.name);
    for (const u of units(plan)) {
      const sh = unitSheet(plan, u, weeks, client.name, taken, 15, sessions);
      taken.push(sh.name);
      out.push(sh);
    }
  }
  return out;
}

// ——— odczyt ———

export interface TemplateRead {
  rows: string[][];
  name?: string;
  start?: string;
  info: string;
  warnings: string[];
}

/**
 * Przerwa zamieniona przez Excel na czas: wpis „2:30” Excel czyta jako 2 h 30 min (ułamek doby 0,104…),
 * a trener miał na myśli 2 min 30 s — godziny → minuty, minuty → sekundy.
 */
function restText(v: string): string {
  const t = v.replace(',', '.');
  if (!/^0?\.\d+$/.test(t)) return v;
  const sec = Math.round(Number(t) * 1440);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

const OUT_HEAD = ['Tydzień', 'Dzień', 'Trening', 'Ćwiczenie', 'Serie', 'Powt.', 'Ciężar', 'RPE', 'Przerwa', 'Uwagi', 'Typ serii'];
const cell = (r: string[] | undefined, i: number) => (i >= 0 && r ? (r[i] ?? '').trim() : '');

/** Arkusze w układzie szablonu → płaska tabela do importu; null — to nie szablon. */
export function readTemplate(sheets: { name: string; rows: string[][] }[]): TemplateRead | null {
  const byWeek = new Map<string, string[][]>();
  const push = (w: string, r: string[]) => (byWeek.get(w) ?? byWeek.set(w, []).get(w)!).push(r);
  const warnings: string[] = [];
  let name: string | undefined;
  let start: string | undefined;
  const used: string[] = [];
  for (const s of sheets) {
    const rows = s.rows;
    const hi = rows.findIndex((r) => r.some((x) => fold(x) === 'ozn') && r.some((x) => fold(x) === 'cwiczenie') && r.some((x) => fold(x) === 'serie'));
    if (hi < 1) continue;
    const head = rows[hi].map(fold);
    const kv = new Map<string, string>();
    // pola nad tabelą: pierwsza niepusta komórka = nazwa pola, następna = wartość
    for (const r of rows.slice(0, hi)) {
      const filled = r.map((x, i) => [x.trim(), i] as const).filter(([x]) => x);
      if (filled.length >= 2) kv.set(fold(filled[0][0]), filled[1][0]);
    }
    const unit = kv.get('trening') || s.name.trim();
    const day = kv.get('dzien tygodnia') ?? '';
    name ||= kv.get('plan') || undefined;
    if (!start && kv.get('start')) {
      const d = parseDay(kv.get('start')!);
      if (d.date) start = d.date;
    }
    const fx = (h: string) => head.indexOf(h);
    const [oI, eI, tI, pI, nI] = [fx('ozn'), fx('cwiczenie'), fx('typ'), fx('przerwa'), fx('uwagi')];
    // grupy tygodni: od każdej kolumny „Serie” do następnej
    const wrow = rows[hi - 1] ?? [];
    const starts = head.map((h, i) => (h === 'serie' ? i : -1)).filter((i) => i >= 0);
    const weeks = starts.map((st, wi) => {
      const end = starts[wi + 1] ?? head.length;
      const find = (re: RegExp) => {
        for (let i = st; i < end; i++) if (re.test(head[i])) return i;
        return -1;
      };
      // nazwa tygodnia: scalona komórka nad grupą (wartość w pierwszej kolumnie albo na lewo)
      let wn = '';
      for (let i = end - 1; i >= st && !wn; i--) wn = cell(wrow, i);
      return { name: wn || `Tydzień ${wi + 1}`, sets: st, reps: find(/^powt/), pct: find(/1 ?rm|^%$/), kg: find(/^kg$|^ciezar/), rpe: find(/^rpe/), notes: find(/^uwagi/) };
    });
    let cur: { name: string; label: string; type: string; rest: string; notes: string } | null = null;
    let found = 0;
    for (const r of rows.slice(hi + 1)) {
      const exn = cell(r, eI);
      if (exn) cur = { name: exn, label: cell(r, oI), type: '', rest: restText(cell(r, pI)), notes: cell(r, nI) };
      if (!cur) continue;
      const type = cell(r, tI);
      for (const w of weeks) {
        const sets = cell(r, w.sets);
        const reps = cell(r, w.reps);
        if (!sets && !reps) continue;
        const pctRaw = cell(r, w.pct).replace('%', '').replace(',', '.');
        const pctN = pctRaw && /^\d+(\.\d+)?$/.test(pctRaw) ? Number(pctRaw) : null;
        const pct = pctN == null ? '' : String(Math.round((pctN <= 3 && !cell(r, w.pct).includes('%') ? pctN * 100 : pctN) * 10) / 10);
        const kg = cell(r, w.kg);
        const notes = exn ? [pct && kg ? `${pct}% 1RM` : '', cur.notes, cell(r, w.notes)].filter(Boolean).join('. ') : cell(r, w.notes);
        const label = /^[A-Z]\d$/.test(cur.label) ? `${cur.label} ` : '';
        push(w.name, [w.name, day, unit, `${label}${cur.name}`, sets || '1', reps, kg || (pct ? `${pct}%` : ''), cell(r, w.rpe), exn ? cur.rest : '', notes, type]);
        found++;
      }
    }
    if (found) used.push(s.name);
    if (found && !day) warnings.push(`„${s.name}”: brak dnia tygodnia. Ustawiony domyślnie, popraw w edytorze.`);
  }
  if (!used.length) return null;
  const rows = [OUT_HEAD, ...[...byWeek.values()].flat()];
  return { rows, name, start, info: `Szablon Fitowej: ${used.length} ${used.length === 1 ? 'dzień treningowy' : used.length < 5 ? 'dni treningowe' : 'dni treningowych'} (${used.map((x) => `„${x}”`).join(', ')}), ${byWeek.size} tyg.`, warnings };
}
