import type { Client, Plan, PlanWorkout, SessionExercise, SetLog, TrainingSession } from '../domain';
import { exerciseLabels, exerciseSummary, expandSets, workoutDate } from './plan';
import { planRows } from './sheetImport';
import { sessionLoad, tonnage } from './load';
import { fmtClock, runTotals } from './running';
import { colName, numOrText, type XCell, type XSheet, type XStyle } from './xlsxWrite';

/** Eksport planów i treningów do Excela (.xlsx): układ do ponownego importu, siatka tygodni, treningi seria po serii. */

const dmy = (iso?: string) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');
const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export function xlsxName(kind: 'plan' | 'trening' | 'treningi', ...parts: (string | undefined)[]): string {
  const slug = parts.filter(Boolean).map((p) => fold(p!)).filter(Boolean).join('-');
  return `${kind}${slug ? `-${slug}` : ''}.xlsx`;
}

/* ---------- styl (czytelny na ekranie, na telefonie i w druku czarno-białym) ---------- */

const C = { black: '000000', dark: '262626', blue: '9FC5E8', kg: 'E8E8E8', white: 'FFFFFF', note: 'F5F5F5', line: '8C8C8C', hint: '595959', faint: 'BFBFBF' };
type Edge = { l?: boolean; r?: boolean; t?: boolean; b?: boolean };
interface StO {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  size?: number;
  align?: 'left' | 'center' | 'right';
  wrap?: boolean;
  indent?: number;
  edge?: Edge;
  /** Bez wewnętrznych ramek (puste pole poza liczbą serii). */
  bare?: boolean;
}
function st(fill: string | undefined, o: StO = {}): XStyle {
  const e = o.edge ?? {};
  const inner = o.bare ? undefined : ('thin' as const);
  return {
    fill,
    bold: o.bold,
    italic: o.italic,
    color: o.color ?? C.black,
    size: o.size,
    align: o.align ?? 'center',
    valign: 'center',
    wrap: o.wrap,
    indent: o.indent,
    bc: C.line,
    border: { l: e.l ? 'medium' : inner, r: e.r ? 'medium' : inner, t: e.t ? 'medium' : inner, b: e.b ? 'medium' : inner },
  };
}
const cell = (v: string | number | null | undefined, s: XStyle): XCell => ({ v, st: s });
/** Liczba („62,5” → 62.5, zaokrąglona) albo tekst bez zmian. */
const num = (v: string | number | undefined | null): string | number | null => {
  const r = numOrText(v == null ? null : typeof v === 'number' ? v : String(v));
  if (r === '' || r == null) return null;
  return typeof r === 'number' ? Math.round(r * 100) / 100 : r;
};
const kgText = (v: string | number | undefined | null) => {
  const t = String(v ?? '').trim();
  if (!t) return '';
  return /^-?\d+(?:[.,]\d+)?$/.test(t) ? `${t.replace('.', ',')} kg` : t.replace(/(\d)\.(\d)/g, '$1,$2');
};
const mmss = (rest?: string) => (rest && /^\d+$/.test(rest.trim()) ? `${Math.floor(Number(rest) / 60)}:${String(Number(rest) % 60).padStart(2, '0')}` : (rest ?? '').trim());
const TYPE_PL: Record<string, string> = { 'Top set': 'seria szczytowa', 'Back-off': 'serie zjazdowe (back-off)', 'Drop set': 'drop set', AMRAP: 'AMRAP — ostatnia seria do maks. powtórzeń', Schłodzenie: 'schłodzenie' };

/* ---------- plan: siatka tygodni ---------- */

function groupText(groups: Parameters<typeof exerciseSummary>[0], perSide?: boolean): string {
  const s = exerciseSummary(groups);
  if (!s.sets && !s.reps && !s.load) return '';
  const reps = s.reps ? `${s.reps}${perSide && !/str\./.test(s.reps) ? '/str.' : ''}` : '';
  return [s.sets && reps ? `${s.sets} × ${reps}` : s.sets || reps, s.load && kgText(s.load), s.rpe && `RPE ${s.rpe.replace('.', ',')}`].filter(Boolean).join(' · ');
}

/** Siatka „ćwiczenia × tygodnie” dla każdej jednostki planu (jak tabela w aplikacji) — progresja z tygodnia na tydzień. */
export function planGridSheet(plan: Plan, client?: Pick<Client, 'name'>): XSheet {
  const rows: XCell[][] = [[cell(plan.name, { bold: true, size: 13, align: 'left' })], ...(client ? [[cell(`Podopieczny: ${client.name}`, { align: 'left' })]] : []), []];
  const merges: string[] = [];
  const heights: Record<number, number> = { 0: 20 };
  const slots: string[] = [];
  for (const w of plan.weeks) for (const k of w.workouts) if (k.exercises.some((e) => e.name.trim()) && !slots.includes(k.name)) slots.push(k.name);
  let maxW = 1;
  for (const slot of slots) {
    const weeks = plan.weeks.map((w, wi) => ({ w, wi, k: w.workouts.find((x) => x.name === slot) })).filter((x) => x.k);
    maxW = Math.max(maxW, weeks.length);
    const names: { name: string; label: string }[] = [];
    for (const { k } of weeks) {
      const labels = exerciseLabels(k!.exercises);
      k!.exercises.forEach((e, i) => {
        if (e.name.trim() && !names.some((n) => n.name === e.name)) names.push({ name: e.name, label: labels[i] && /\d/.test(labels[i]) ? labels[i] : '' });
      });
    }
    const r0 = rows.length;
    rows.push([cell(slot.toUpperCase(), st(C.dark, { bold: true, color: C.white, size: 11, align: 'left', indent: 1, edge: { l: true, t: true, r: true } })), ...weeks.map(() => cell(null, st(C.dark, { edge: { t: true, r: true } })))]);
    merges.push(`A${r0 + 1}:${colName(weeks.length)}${r0 + 1}`);
    heights[r0] = 20;
    rows.push([
      cell('Ćwiczenie', st(C.blue, { bold: true, edge: { l: true } })),
      ...weeks.map(({ w, wi, k }, i) => {
        const d = workoutDate(plan, wi, k!);
        return cell([w.name, d ? dmy(d).slice(0, 5) : ''].filter(Boolean).join('\n'), st(C.blue, { bold: true, wrap: true, edge: { r: i === weeks.length - 1 } }));
      }),
    ]);
    heights[r0 + 1] = 28;
    names.forEach((n, ni) => {
      const last = ni === names.length - 1;
      rows.push([
        cell(`${n.label ? `${n.label} ` : ''}${n.name}`, st(undefined, { bold: true, align: 'left', wrap: true, indent: 1, edge: { l: true, b: last } })),
        ...weeks.map(({ k }, i) => {
          const e = k!.exercises.find((x) => x.name === n.name);
          return cell(e ? groupText(e.groups, e.perSide) || '—' : '', st(ni % 2 ? C.note : undefined, { wrap: true, size: 9, edge: { r: i === weeks.length - 1, b: last } }));
        }),
      ]);
      heights[rows.length - 1] = 26;
    });
    rows.push([]);
  }
  return {
    name: 'Tygodnie',
    rows,
    merges,
    heights,
    widths: [28, ...Array.from({ length: maxW }, () => 17)],
    noGrid: true,
    landscape: maxW > 4,
    fitWidth: true,
    freezeCols: 1,
    pageFooter: `&L${plan.name}&RStrona &P z &N`,
  };
}

/* ---------- wspólny układ (arkusz trenera): PLAN | REALIZACJA — seria po serii KG / REP | RPE | DATA | NOTATKI ---------- */

const TEMPO_RE = /[0-9xX]\s*-\s*[0-9xX]\s*-\s*[0-9xX]\s*-\s*[0-9xX]/;
/** Tempo z uwag („tempo 3-1-X-0, kolana na zewnątrz” → tempo „3-1-X-0”, uwagi „kolana na zewnątrz”). */
export function splitTempo(notes?: string): { tempo: string; notes: string } {
  const t = String(notes ?? '');
  const m = t.match(TEMPO_RE);
  if (!m) return { tempo: '', notes: t.trim() };
  return { tempo: m[0].replace(/\s/g, '').toUpperCase(), notes: t.replace(/tempo\s*:?\s*/i, '').replace(TEMPO_RE, '').replace(/^[\s,;·-]+|[\s,;·-]+$/g, '') };
}

const joinRpe = (vals: (string | number | undefined | null)[]) => {
  const u = [...new Set(vals.map((v) => String(v ?? '').trim().replace('.', ',')).filter(Boolean))];
  return u.length <= 1 ? (u[0] ?? '') : u.join(' / ');
};
const joinSeq = (vals: (string | undefined)[]) => {
  const v = vals.map((x) => String(x ?? '').trim()).filter(Boolean);
  return new Set(v).size <= 1 ? (v[0] ?? '') : v.join(', ');
};

/** Jedna seria robocza: ciężar i powtórzenia osobno; `text` — zapis w jednej komórce (cardio); `hint` — cel do wpisania (np. „max”). */
export interface XSet {
  kg: string | number | null;
  rep: string | number | null;
  text?: string;
  hint?: string;
}
export interface ExRow {
  name: string;
  /** Kolumny planu: serie, powtórzenia, RPE, tempo, przerwa. */
  plan: { sets: string; reps: string; rpe: string; tempo: string; rest: string };
  /** Serie robocze (rozgrzewka trafia do uwag). */
  sets: XSet[];
  /** Ciężar w seriach to cel z planu (pokazany kursywą — do nadpisania). */
  target?: boolean;
  /** RPE z realizacji. */
  rpe: string | number | null;
  notes: string;
}

type PlanKey = keyof ExRow['plan'];
const LEFT: { key: PlanKey; head: string; w: number; always?: boolean }[] = [
  { key: 'sets', head: 'Serie', w: 6, always: true },
  { key: 'reps', head: 'Powt.', w: 8, always: true },
  { key: 'rpe', head: 'RPE', w: 6 },
  { key: 'tempo', head: 'Tempo', w: 8 },
  { key: 'rest', head: 'Przerwa', w: 8 },
];
const NAME_W = 26;
const KG_W = 7;
const REP_W = 6;
const NOTE_W = 30;
const DATE_W = 11;

/** Wysokość wiersza: tyle linii, ile zajmie najdłuższy zawijany tekst. */
const linesOf = (t: string, width: number) => Math.max(1, Math.ceil(t.length / Math.max(4, width * 1.15)));

/** Arkusz złożony z bloków (jednostka planu / trening) w stylu arkusza trenera, z podziałem stron między blokami. */
class Grid {
  rows: XCell[][] = [];
  merges: string[] = [];
  heights: Record<number, number> = {};
  breaks: number[] = [];
  left: typeof LEFT;
  private used = 0;
  private pageH: number;
  constructor(
    public n: number,
    all: ExRow[],
  ) {
    this.left = LEFT.filter((c) => c.always || all.some((r) => r.plan[c.key]));
    // A4 poziomo: ~500 pkt wysokości do druku; przy dopasowaniu do szerokości strona „mieści” więcej wierszy
    const widthPt = this.widths().reduce((a, w) => a + w, 0) * 5.6;
    const scale = Math.min(1, 790 / widthPt);
    this.pageH = 490 / scale;
  }
  private get s0() {
    return 1 + this.left.length;
  }
  private get rpe() {
    return this.s0 + 2 * this.n;
  }
  widths(): number[] {
    return [NAME_W, ...this.left.map((c) => c.w), ...Array.from({ length: this.n }, () => [KG_W, REP_W]).flat(), 6, DATE_W, NOTE_W];
  }
  private put(r: number, c: number, v: XCell) {
    while (this.rows.length <= r) this.rows.push([]);
    const row = this.rows[r];
    while (row.length < c) row.push(null);
    row[c] = v;
  }
  private merge(r0: number, c0: number, r1: number, c1: number, v: string | number | null | undefined, s: XStyle) {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.put(r, c, cell(r === r0 && c === c0 ? v : null, s));
    if (r1 > r0 || c1 > c0) this.merges.push(`${colName(c0)}${r0 + 1}:${colName(c1)}${r1 + 1}`);
  }
  private h(r: number) {
    return this.heights[r] ?? 13;
  }
  /** Wiersze informacyjne nad tabelą: etykieta pogrubiona, wartość jako tekst (nie ucina się). */
  info(lines: [string, string][], title?: string) {
    if (title) {
      this.heights[this.rows.length] = 22;
      this.rows.push([cell(title, { bold: true, size: 14, align: 'left' })]);
    }
    for (const [k, v] of lines) this.rows.push([cell(k, { bold: true, align: 'left' }), cell(v, { align: 'left' })]);
    this.rows.push([]);
    for (let r = 0; r < this.rows.length; r++) this.used += this.h(r);
  }
  block(title: string, date: string, ex: ExRow[], dateLabel = 'DATA:') {
    const L = { s0: this.s0, rpe: this.rpe, date: this.rpe + 1, note: this.rpe + 2 };
    const list = ex.length ? ex : [{ name: '', plan: { sets: '', reps: '', rpe: '', tempo: '', rest: '' }, sets: [], rpe: null, notes: '' } as ExRow];
    // wysokości wierszy ćwiczeń (miejsce na wpis długopisem, zawijane nazwy i uwagi)
    const hs = list.map((e) => Math.max(22, 12 * Math.max(linesOf(e.name, NAME_W), linesOf(e.notes, NOTE_W + DATE_W) * 0.9) + 8));
    const blockH = 20 + 18 + 16 + hs.reduce((a, x) => a + x, 0) + 12;
    const top0 = this.rows.length;
    if (this.used > 0 && this.used + blockH > this.pageH) {
      this.breaks.push(top0); // ostatni wiersz poprzedniej strony (numeracja od 1) = top0
      this.used = 0;
    }
    this.used += blockH;
    const top = top0;
    const dark = (edge: Edge, size = 9, align: 'left' | 'center' = 'center') => st(C.dark, { bold: true, color: C.white, size, edge, align, indent: align === 'left' ? 1 : undefined });
    const bl = (edge: Edge) => st(C.blue, { bold: true, edge });
    // wiersz 1: tytuł | REALIZACJA | DATA: | NOTATKI
    this.merge(top, 0, top, L.s0 - 1, title, dark({ l: true, t: true, r: true }, 12, 'left'));
    this.merge(top, L.s0, top, L.rpe, 'REALIZACJA', dark({ l: true, t: true, r: true }));
    this.merge(top, L.date, top, L.date, dateLabel, dark({ t: true }));
    this.merge(top, L.note, top + 2, L.note, 'NOTATKI', dark({ t: true, r: true }, 10));
    // wiersze 2–3: nagłówki planu, „Seria N” nad KG | REP, RPE, data
    this.merge(top + 1, 0, top + 2, 0, 'Ćwiczenie', bl({ l: true }));
    this.left.forEach((c, i) => this.merge(top + 1, 1 + i, top + 2, 1 + i, c.head, bl({ r: i === this.left.length - 1 })));
    for (let i = 0; i < this.n; i++) {
      const c = L.s0 + 2 * i;
      this.merge(top + 1, c, top + 1, c + 1, `Seria ${i + 1}`, bl({ l: i === 0 }));
      this.put(top + 2, c, cell('KG', st(C.blue, { bold: true, size: 8, edge: { l: i === 0 } })));
      this.put(top + 2, c + 1, cell('REP', st(C.blue, { bold: true, size: 8 })));
    }
    this.merge(top + 1, L.rpe, top + 2, L.rpe, 'RPE', bl({ r: true }));
    this.merge(top + 1, L.date, top + 2, L.date, date, st(C.white, { bold: true }));
    this.heights[top] = 20;
    this.heights[top + 1] = 18;
    this.heights[top + 2] = 16;
    // ćwiczenia jedno pod drugim
    list.forEach((e, k) => {
      const r = top + 3 + k;
      this.heights[r] = hs[k];
      const last = k === list.length - 1;
      const ed = (o: Edge = {}): Edge => ({ ...o, b: last });
      this.put(r, 0, cell(e.name, st(C.white, { bold: true, align: 'left', wrap: true, indent: 1, size: 10, edge: ed({ l: true }) })));
      this.left.forEach((c, i) => this.put(r, 1 + i, cell(num(e.plan[c.key]), st(C.white, { edge: ed({ r: i === this.left.length - 1 }) }))));
      for (let i = 0; i < this.n; i++) {
        const c = L.s0 + 2 * i;
        const x = e.sets[i];
        if (!x) {
          // poza liczbą serii — puste, bez ramek: od razu widać, ile serii zrobić
          this.put(r, c, cell(null, st(undefined, { bare: true, edge: ed({ l: i === 0 }) })));
          this.put(r, c + 1, cell(null, st(undefined, { bare: true, edge: ed() })));
        } else if (x.text) this.merge(r, c, r, c + 1, x.text, st(C.kg, { size: 8, wrap: true, italic: e.target, edge: ed({ l: i === 0 }) }));
        else {
          this.put(r, c, cell(x.kg, st(C.kg, { bold: !e.target, italic: e.target, color: e.target ? C.hint : C.black, edge: ed({ l: i === 0 }) })));
          this.put(r, c + 1, cell(x.rep ?? x.hint ?? null, st(C.white, { italic: x.rep == null && !!x.hint, color: x.rep == null && x.hint ? C.hint : C.black, size: x.rep == null && x.hint ? 8 : undefined, edge: ed() })));
        }
      }
      this.put(r, L.rpe, cell(num(e.rpe), st(C.white, { bold: true, edge: ed({ r: true }) })));
      this.merge(r, L.date, r, L.note, e.notes, st(C.white, { align: 'left', wrap: true, size: 9, indent: 1, edge: ed({ r: true }) }));
    });
    this.heights[this.rows.length] = 12;
    this.rows.push([]);
  }
  sheet(name: string, footer: string): XSheet {
    return {
      name,
      rows: this.rows,
      merges: this.merges,
      heights: this.heights,
      widths: this.widths(),
      noGrid: true,
      landscape: true,
      freezeCols: 1,
      rowBreaks: this.breaks,
      pageFooter: `&L${footer.replace(/&/g, '&&')}&RStrona &P z &N`,
    };
  }
}
/** Liczba kolumn serii: najwięcej serii roboczych w arkuszu (min. 3). */
const seriesCount = (rows: ExRow[]) => Math.min(20, Math.max(3, ...rows.map((r) => r.sets.length)));

/* ---------- plan ---------- */

const repsText = (reps: string, e: { perSide?: boolean; timed?: boolean }) =>
  reps ? `${reps}${e.perSide && !/str\./.test(reps) ? '/str.' : ''}${e.timed && /^\d+$/.test(reps) ? ' s' : ''}` : '';

/** Ćwiczenia jednostki planu: plan po lewej, w seriach ciężar docelowy (kursywą), powtórzenia do wpisania. */
export function planExRows(k: PlanWorkout): ExRow[] {
  const labels = exerciseLabels(k.exercises);
  return k.exercises
    .map((e, i) => ({ e, label: labels[i] }))
    .filter(({ e }) => e.name.trim())
    .map(({ e, label }) => {
      const all = expandSets(e.groups);
      const warm = all.filter((g) => g.type === 'Rozgrzewka');
      const work = all.filter((g) => g.type !== 'Rozgrzewka' && g.type !== 'Schłodzenie' && g.type !== 'Przerwa');
      const cardioText = (g: (typeof all)[number]) => [g.reps && `${g.reps}${/\d$/.test(g.reps) ? ' min' : ''}`, g.load && `${g.load.replace('.', ',')}${/\d$/.test(g.load) ? ' km' : ''}`, g.pace].filter(Boolean).join(' · ');
      const sets: XSet[] = work.map((g) => (e.cardio ? { kg: null, rep: null, text: cardioText(g) } : { kg: num(g.load), rep: null, hint: g.type === 'AMRAP' ? 'max' : undefined }));
      const t = splitTempo(e.notes);
      const warmText = warm.length ? `Rozgrzewka: ${warm.map((g) => (e.cardio ? cardioText(g) : [g.reps, kgText(g.load)].filter(Boolean).join(' × '))).join(', ')}` : '';
      const types = [...new Set(e.groups.map((g) => TYPE_PL[g.type]).filter(Boolean))];
      return {
        name: label && /\d/.test(label) ? `${label}  ${e.name}` : e.name,
        plan: {
          sets: work.length ? String(work.length) : '',
          reps: e.cardio ? '' : repsText(joinSeq(work.map((g) => g.reps)), e),
          rpe: joinRpe(work.map((g) => g.rpe)),
          tempo: t.tempo,
          rest: mmss(e.rest),
        },
        sets,
        target: true,
        rpe: null,
        notes: [warmText, types.join(', '), t.notes].filter(Boolean).join(' · '),
      };
    });
}

/** Arkusz „Plan”: dla każdego tygodnia i jednostki tabela w stylu arkusza trenera (tydzień po tygodniu, bez rozrywania na stronach). */
export function planTableSheet(plan: Plan, client?: Pick<Client, 'name'>): XSheet {
  const blocks = plan.weeks.flatMap((w, wi) =>
    w.workouts
      .filter((k) => k.exercises.some((e) => e.name.trim()))
      .map((k) => {
        const d = workoutDate(plan, wi, k);
        return { title: `${[w.name, k.name].filter(Boolean).join(' · ').toUpperCase()}${d ? `   (plan: ${dmy(d)})` : ''}`, rows: planExRows(k) };
      }),
  );
  const all = blocks.flatMap((x) => x.rows);
  const g = new Grid(seriesCount(all), all);
  g.info(
    [
      ...(client ? ([['Podopieczny', client.name]] as [string, string][]) : []),
      ...(plan.startDate ? ([['Start', dmy(plan.startDate)]] as [string, string][]) : []),
      ['Jak czytać', 'KG — ciężar z planu (kursywą), wpisz wykonany ciężar i powtórzenia (REP); RPE — odczuty wysiłek 1–10.'],
    ],
    plan.name,
  );
  for (const x of blocks) g.block(x.title, '', x.rows);
  return g.sheet('Plan', [plan.name, client?.name].filter(Boolean).join(' · '));
}

/** Skoroszyt planu: „Plan” (tabela do druku), „Tygodnie” (progresja) i „Do importu” (wczytasz go z powrotem). */
export function planWorkbook(plan: Plan, client?: Pick<Client, 'name'>): XSheet[] {
  const rows = planRows(plan);
  const restCol = rows[0].indexOf('Przerwa');
  // przerwa „90” (sekundy) → „1:30”, żeby w arkuszu było jednolicie m:ss
  const flat = rows.map((r, i) => (i === 0 ? r : r.map((c, ci) => (ci === restCol ? mmss(c) : numOrText(c)))));
  return [planTableSheet(plan, client), planGridSheet(plan, client), { name: 'Do importu', rows: flat, header: true, fitWidth: true, landscape: true }];
}

/* ---------- treningi ---------- */

function setCell(e: SessionExercise, x: SetLog): XSet {
  if (e.cardio) return { kg: null, rep: null, text: [x.reps != null ? fmtClock(x.reps) : '', x.dist ? `${String(x.dist).replace('.', ',')} km` : '', x.hr ? `${x.hr} ud/min` : ''].filter(Boolean).join(' · ') };
  let rep: string | number | null = x.reps ?? null;
  if (x.unit === 's' && x.reps != null) rep = `${x.reps} s`;
  else if (x.unit === 'min' && x.reps != null) rep = `${String(x.reps).replace('.', ',')} min`;
  else if (x.complex) rep = x.complex;
  if (x.repsR != null) rep = `${String(rep ?? '').replace(/ s$/, '')}/${x.repsR}${x.unit === 's' ? ' s' : ''}`;
  return { kg: x.load != null ? Math.round(x.load * 100) / 100 : null, rep };
}

/** Ćwiczenia zapisanego treningu (seria po serii: KG i REP; rozgrzewka w uwagach). */
export function sessionExRows(s: TrainingSession): ExRow[] {
  return s.exercises
    .filter((e) => e.name.trim())
    .map((e) => {
      const logs = e.setsLog ?? [];
      const t = splitTempo(e.notes);
      const warm = logs.filter((x) => x.warmup);
      const work = logs.filter((x) => !x.warmup);
      const warmText = warm.length ? `Rozgrzewka: ${warm.map((x) => (e.cardio ? setCell(e, x).text : [x.reps, x.load != null ? kgText(x.load) : ''].filter((v) => v != null && v !== '').join(' × '))).join(', ')}` : '';
      const base = { name: e.label && /\d/.test(e.label) ? `${e.label}  ${e.name}` : e.name, notes: [warmText, t.notes].filter(Boolean).join(' · ') };
      const plan = { sets: e.sets ?? '', reps: repsText(e.reps ?? '', e), rpe: e.rpe ?? '', tempo: t.tempo, rest: mmss(e.rest) };
      if (!logs.length) {
        // zapis skrócony („3 × 8 · 60 kg”) — rozpisany na serie
        const n = Math.min(20, Math.max(1, Number(e.sets) || 1));
        return { ...base, plan, sets: Array.from({ length: n }, () => ({ kg: num(e.load), rep: num(e.reps) })), rpe: num(e.rpe) };
      }
      return { ...base, plan: { ...plan, sets: plan.sets || String(work.length) }, sets: work.map((x) => setCell(e, x)), rpe: joinRpe(work.map((x) => x.rpe)) };
    });
}

function sessionInfo(s: TrainingSession, client?: Pick<Client, 'name'>, withTrainer?: boolean): [string, string][] {
  const ton = tonnage(s);
  const run = runTotals(s);
  const load = sessionLoad(s);
  const stats = [
    s.duration ? `czas ${s.duration} min` : '',
    s.srpe != null ? `wysiłek (sRPE) ${s.srpe}/10` : '',
    load != null ? `obciążenie ${load} AU` : '',
    ton ? `tonaż ${Math.round(ton).toLocaleString('pl-PL')} kg` : '',
    run && run.km ? `dystans ${String(Math.round(run.km * 100) / 100).replace('.', ',')} km, tempo ${run.pace}` : '',
  ].filter(Boolean);
  return [
    ['Data', dmy(s.date)],
    ...(client ? ([['Podopieczny', `${client.name}${withTrainer != null ? ` · ${withTrainer ? 'z trenerem' : 'samodzielnie'}` : ''}`]] as [string, string][]) : withTrainer != null ? ([['Rodzaj', withTrainer ? 'z trenerem' : 'samodzielnie']] as [string, string][]) : []),
    ...(stats.length ? ([['Podsumowanie', stats.join(' · ')]] as [string, string][]) : []),
    ...(s.pain != null || s.stoppedForPain ? ([['Ból', `${s.pain != null ? `${s.pain}/10` : ''}${s.stoppedForPain ? ' · przerwany z powodu bólu' : ''}`.replace(/^ · /, '')]] as [string, string][]) : []),
    ...(s.notes ? ([['Notatki', s.notes]] as [string, string][]) : []),
  ];
}

/** Skoroszyt jednego treningu: dane treningu i tabela ćwiczeń (seria po serii). */
export function sessionWorkbook(s: TrainingSession, client?: Pick<Client, 'name'>, withTrainer?: boolean): XSheet[] {
  const rows = sessionExRows(s);
  const g = new Grid(seriesCount(rows), rows);
  g.info(sessionInfo(s, client, withTrainer), s.workoutName || 'Trening');
  g.block((s.workoutName || 'Trening').toUpperCase(), dmy(s.date), rows);
  return [g.sheet('Trening', [s.workoutName || 'Trening', dmy(s.date), client?.name].filter(Boolean).join(' · '))];
}

/** Wszystkie treningi klienta: „Treningi” (wiersz na trening) i „Serie” (każdy trening jako tabela seria po serii). */
export function sessionsWorkbook(sessions: TrainingSession[], withTrainer?: (s: TrainingSession) => boolean): XSheet[] {
  const sorted = [...sessions].sort((a, z) => (a.date + (a.createdAt ?? '')).localeCompare(z.date + (z.createdAt ?? '')));
  const cols: { head: string; get: (s: TrainingSession) => string | number | null; w: number }[] = [
    { head: 'Data', get: (s) => dmy(s.date), w: 11 },
    { head: 'Trening', get: (s) => s.workoutName || 'Trening', w: 26 },
    { head: 'Rodzaj', get: (s) => (withTrainer ? (withTrainer(s) ? 'z trenerem' : 'samodzielnie') : null), w: 13 },
    { head: 'Czas [min]', get: (s) => s.duration ?? null, w: 10 },
    { head: 'sRPE', get: (s) => s.srpe ?? null, w: 7 },
    { head: 'Obciążenie [AU]', get: (s) => sessionLoad(s), w: 14 },
    { head: 'Tonaż [kg]', get: (s) => (tonnage(s) ? Math.round(tonnage(s)) : null), w: 11 },
    { head: 'Dystans [km]', get: (s) => { const r = runTotals(s); return r && r.km ? Math.round(r.km * 100) / 100 : null; }, w: 12 },
    { head: 'Ból [0–10]', get: (s) => s.pain ?? null, w: 10 },
    { head: 'Przerwany', get: (s) => (s.stoppedForPain ? 'tak' : null), w: 10 },
    { head: 'Notatki', get: (s) => s.notes || null, w: 40 },
  ];
  // kolumny puste we wszystkich treningach — pomijamy
  const used = cols.filter((c, i) => i < 2 || sorted.some((s) => { const v = c.get(s); return v != null && v !== ''; }));
  const head = st(C.blue, { bold: true, wrap: true });
  const list: XCell[][] = [
    used.map((c) => cell(c.head, head)),
    ...sorted.map((s, ri) => used.map((c, ci) => cell(c.get(s), st(ri % 2 ? C.note : undefined, { align: ci === 1 || c.head === 'Notatki' ? 'left' : 'center', wrap: c.head === 'Notatki', indent: ci === 1 ? 1 : undefined })))),
  ];
  const blocks = sorted.map((s) => ({ title: `${dmy(s.date)}  ·  ${(s.workoutName || 'Trening').toUpperCase()}`, date: dmy(s.date), rows: sessionExRows(s) })).filter((x) => x.rows.length);
  const all = blocks.flatMap((x) => x.rows);
  const g = new Grid(seriesCount(all), all);
  for (const x of blocks) g.block(x.title, x.date, x.rows);
  return [
    { name: 'Treningi', rows: list, header: true, widths: used.map((c) => c.w), heights: { 0: 28 }, noGrid: true, fitWidth: true, landscape: used.length > 7, pageFooter: '&RStrona &P z &N' },
    g.sheet('Serie', 'Treningi — seria po serii'),
  ];
}
