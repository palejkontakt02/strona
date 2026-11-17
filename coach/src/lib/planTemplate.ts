import type { Client, Plan, PlanExercise, SetGroup } from '../domain';
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
        u = { name: k.name || `Dzień ${ki + 1}`, day: k.day ?? (k.date ? ((new Date(`${k.date}T12:00:00`).getDay() + 6) % 7) + 1 : undefined), ex: [] };
        out.push(u);
      }
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

/** Arkusz szablonu dla jednej jednostki (albo pusty, gdy `unit` brak). */
function unitSheet(plan: Plan | null, unit: Unit | null, weeks: string[], client: string, taken: string[], emptyRows = 15): XSheet {
  const rows: XCell[][] = [];
  const merges: string[] = [];
  const W0 = TEMPLATE_FIXED.length;
  const PW = TEMPLATE_WEEK.length;
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
  rows.push([c('Wypełniaj żółte pola i tabelę. Wiersz bez nazwy ćwiczenia = kolejne serie ćwiczenia wyżej (np. back-off). Ozn. A1/A2 = superseria. Ciężar: Kg albo % 1RM (albo oba). Nie zmieniaj nazw nagłówków.', S.hint)]);
  merges.push(`A${rows.length}:${colName(Math.min(last, 12))}${rows.length}`);
  rows.push([]);
  // wiersz tygodni
  const wr: XCell[] = TEMPLATE_FIXED.map(() => null);
  weeks.forEach((w, i) => {
    for (let j = 0; j < PW; j++) wr.push(c(j === 0 ? w : null, S.week));
    merges.push(`${colName(W0 + i * PW)}${rows.length + 1}:${colName(W0 + i * PW + PW - 1)}${rows.length + 1}`);
  });
  rows.push(wr);
  const headRow = rows.length;
  rows.push([...TEMPLATE_FIXED.map((h) => c(h, S.head)), ...weeks.flatMap(() => TEMPLATE_WEEK.map((h) => c(h, S.head)))]);

  const weekCells = (g: SetGroup | undefined, e: PlanExercise | undefined, first: boolean, wi: number): XCell[] => {
    const st = wi % 2 ? S.cellB : S.cellA;
    if (!g || !e) return TEMPLATE_WEEK.map((_h, j) => c(null, j === PW - 1 ? S.note : st));
    const sp = splitPctNote(e.notes);
    const pct = pctOf(g.load) || (first ? sp.pct : '');
    const kg = pctOf(g.load) ? '' : g.load;
    const reps = e.perSide && g.reps && !/\/\s*str/i.test(g.reps) ? `${g.reps}/str.` : g.reps;
    const kgCell = kg && e.loadPer === 'one' ? `${kg.replace('.', ',')}/rękę` : numOr(kg);
    return [c(numOr(g.sets || '1'), st), c(numOr(reps), st), c(pct ? numOr(pct) : null, st), c(kgCell, st), c(numOr(g.rpe), st), c(null, S.note)];
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
          if (gi === 0 && !same && notes[wi]) cells[PW - 1] = c(notes[wi], S.note);
          r.push(...cells);
        });
        rows.push(r);
      }
    }
  }
  for (let i = 0; i < (unit?.ex.length ? 3 : emptyRows); i++) rows.push([...TEMPLATE_FIXED.map((_h, j) => c(null, j === 1 ? S.ex : S.fixed)), ...weeks.flatMap((_w, wi) => weekCells(undefined, undefined, false, wi))]);
  return {
    name: sheetName(name, taken),
    rows,
    merges,
    widths: [6, 28, 10, 8, 28, ...weeks.flatMap(() => [6, 8, 7, 8, 6, 18])],
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
  return empty.days.map((d) => add(unitSheet(null, { name: d, ex: [] }, weeks, client?.name ?? '', taken)));
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
    if (found && !day) warnings.push(`„${s.name}”: brak dnia tygodnia — ustawiony domyślnie, popraw w edytorze.`);
  }
  if (!used.length) return null;
  const rows = [OUT_HEAD, ...[...byWeek.values()].flat()];
  return { rows, name, start, info: `Szablon Fitowej: ${used.length} ${used.length === 1 ? 'dzień treningowy' : used.length < 5 ? 'dni treningowe' : 'dni treningowych'} (${used.map((x) => `„${x}”`).join(', ')}), ${byWeek.size} tyg.`, warnings };
}
