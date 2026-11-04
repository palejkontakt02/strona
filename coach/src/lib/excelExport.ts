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
const b = (v: string | number | null | undefined): XCell => ({ v, bold: true });

export function xlsxName(kind: 'plan' | 'trening' | 'treningi', ...parts: (string | undefined)[]): string {
  const slug = parts.filter(Boolean).map((p) => fold(p!)).filter(Boolean).join('-');
  return `${kind}${slug ? `-${slug}` : ''}.xlsx`;
}

/* ---------- plan ---------- */

function groupText(groups: Parameters<typeof exerciseSummary>[0], perSide?: boolean): string {
  const s = exerciseSummary(groups);
  if (!s.sets && !s.reps && !s.load) return '';
  const reps = s.reps ? `${s.reps}${perSide && !/str\./.test(s.reps) ? '/str.' : ''}` : '';
  return [s.sets && reps ? `${s.sets} × ${reps}` : s.sets || reps, s.load && s.load.replace('.', ','), s.rpe && `@${s.rpe.replace('.', ',')}`].filter(Boolean).join(' · ');
}

/** Siatka „ćwiczenia × tygodnie” dla każdej jednostki planu (jak tabela w aplikacji). */
export function planGridRows(plan: Plan, client?: Pick<Client, 'name'>): XCell[][] {
  const rows: XCell[][] = [[b(plan.name)], ...(client ? [['Podopieczny', client.name]] : []), ...(plan.startDate ? [['Start', dmy(plan.startDate)]] : []), []];
  const slots: string[] = [];
  for (const w of plan.weeks) for (const k of w.workouts) if (k.exercises.some((e) => e.name.trim()) && !slots.includes(k.name)) slots.push(k.name);
  for (const slot of slots) {
    const weeks = plan.weeks.map((w) => ({ w, k: w.workouts.find((x) => x.name === slot) })).filter((x) => x.k);
    const names: string[] = [];
    for (const { k } of weeks) for (const e of k!.exercises) if (e.name.trim() && !names.includes(e.name)) names.push(e.name);
    rows.push([b(slot)]);
    rows.push([b('Ćwiczenie'), ...weeks.map(({ w, k }) => b([w.name, k!.date ? dmy(k!.date) : ''].filter(Boolean).join(' · ')))]);
    for (const n of names)
      rows.push([
        n,
        ...weeks.map(({ k }) => {
          const e = k!.exercises.find((x) => x.name === n);
          return e ? groupText(e.groups, e.perSide) || '—' : '';
        }),
      ]);
    rows.push([]);
  }
  return rows;
}

/* ---------- wspólny układ (jak arkusz trenera): PLAN | REALIZACJA — seria po serii KG / REP | RPE | DATA | NOTATKI ---------- */

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
  return new Set(v).size <= 1 ? (v[0] ?? '') : v.join('-');
};
const mmss = (rest?: string) => (rest && /^\d+$/.test(rest.trim()) ? `${Math.floor(Number(rest) / 60)}:${String(Number(rest) % 60).padStart(2, '0')}` : (rest ?? '').trim());
/** Liczba („62,5” → 62.5) albo tekst bez zmian. */
const num = (v: string | number | undefined | null): string | number | null => {
  const r = numOrText(v == null ? null : typeof v === 'number' ? v : String(v));
  return r === '' ? null : r;
};

/** Jedna seria: ciężar i powtórzenia osobno; `text` — zapis w jednej komórce (cardio). */
export interface XSet {
  kg: string | number | null;
  rep: string | number | null;
  warm?: boolean;
  text?: string;
}
export interface ExRow {
  name: string;
  /** Kolumny planu: serie, powtórzenia, RPE, tempo, przerwa. */
  plan: { sets: string; reps: string; rpe: string; tempo: string; rest: string };
  sets: XSet[];
  /** RPE z realizacji. */
  rpe: string | number | null;
  notes: string;
}

const C = { black: '000000', dark: '262626', blue: '6D9EEB', kg: 'BFBFBF', rep: 'D9D9D9', warm: 'C9DAF8', note: 'EFEFEF', white: 'FFFFFF' };
const LEFT = ['Ćwiczenie', 'Serie', 'Powt.', 'RPE', 'Tempo', 'Przerwa'];
/** Kolumny: lewe (plan) | KG, REP × n | RPE | DATA | NOTATKI. */
const layout = (n: number) => {
  const s0 = LEFT.length;
  const rpe = s0 + 2 * n;
  return { s0, rpe, date: rpe + 1, note: rpe + 2, cols: rpe + 3 };
};
export const tableWidths = (n: number) => [30, 7, 8, 7, 9, 8, ...Array.from({ length: n }, () => [7, 7]).flat(), 7, 12, 42];

type Edge = { l?: boolean; r?: boolean; t?: boolean; b?: boolean };
function st(fill: string, o: { bold?: boolean; color?: string; size?: number; align?: 'left' | 'center'; fmt?: string; wrap?: boolean; edge?: Edge; dotted?: boolean } = {}): XStyle {
  const inner = o.dotted ? ('dotted' as const) : ('thin' as const);
  const e = o.edge ?? {};
  return {
    fill,
    bold: o.bold,
    color: o.color ?? C.black,
    size: o.size,
    align: o.align ?? 'center',
    valign: 'center',
    wrap: o.wrap,
    fmt: o.fmt,
    border: { l: e.l ? 'medium' : inner, r: e.r ? 'medium' : inner, t: e.t ? 'medium' : inner, b: e.b ? 'medium' : inner },
  };
}
const cell = (v: string | number | null | undefined, s: XStyle): XCell => ({ v, st: s });

/** Arkusz złożony z bloków (jednostka planu / trening) w stylu arkusza trenera. */
class Grid {
  rows: XCell[][] = [];
  merges: string[] = [];
  heights: Record<number, number> = {};
  constructor(public n: number) {}
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
  /** Wiersze informacyjne nad tabelą (dane treningu, nazwa planu). */
  info(rows: XCell[][]) {
    for (const r of rows) this.rows.push(r);
  }
  block(title: string, date: string, ex: ExRow[]) {
    const L = layout(this.n);
    const top = this.rows.length;
    const hd = (_: string, edge: Edge, size = 9) => st(C.dark, { bold: true, color: C.white, size, edge });
    const bl = (edge: Edge) => st(C.blue, { bold: true, color: '000000', edge });
    // wiersz 1: tytuł bloku | REALIZACJA | DATA: | NOTATKI
    this.merge(top, 0, top, L.s0 - 1, title, { ...hd('', { l: true, t: true, r: true }, 10), align: 'left' });
    this.merge(top, L.s0, top, L.rpe, 'REALIZACJA', hd('', { l: true, t: true, r: true }));
    this.merge(top, L.date, top, L.date, 'DATA:', hd('', { t: true }));
    this.merge(top, L.note, top + 2, L.note, 'NOTATKI', { ...hd('', { t: true, r: true }, 14), bold: true });
    // wiersze 2–3: nagłówki planu, „Seria N” nad KG | REP, RPE, data
    LEFT.forEach((h, i) => this.merge(top + 1, i, top + 2, i, h, bl({ l: i === 0, r: i === LEFT.length - 1 })));
    for (let i = 0; i < this.n; i++) {
      const c = L.s0 + 2 * i;
      this.merge(top + 1, c, top + 1, c + 1, `Seria ${i + 1}`, bl({ l: i === 0 }));
      this.put(top + 2, c, cell('KG', bl({ l: i === 0 })));
      this.put(top + 2, c + 1, cell('REP', bl({})));
    }
    this.merge(top + 1, L.rpe, top + 2, L.rpe, 'RPE', bl({ r: true }));
    this.merge(top + 1, L.date, top + 2, L.date, date, st(C.white, { bold: true }));
    this.heights[top] = 16;
    // ćwiczenia jedno pod drugim
    const list = ex.length ? ex : [{ name: '', plan: { sets: '', reps: '', rpe: '', tempo: '', rest: '' }, sets: [], rpe: null, notes: '' }];
    list.forEach((e, k) => {
      const r = top + 3 + k;
      this.heights[r] = 18;
      const last = k === list.length - 1;
      const ed = (o: Edge = {}): Edge => ({ ...o, b: last });
      const p = e.plan;
      [e.name, p.sets, p.reps, p.rpe, p.tempo, p.rest].forEach((v, i) =>
        this.put(r, i, cell(i === 0 ? v : num(v), st(C.white, { dotted: true, align: i === 0 ? 'left' : 'center', bold: i === 0, wrap: i === 0, edge: ed({ l: i === 0, r: i === LEFT.length - 1 }) }))),
      );
      for (let i = 0; i < this.n; i++) {
        const c = L.s0 + 2 * i;
        const x = e.sets[i];
        const fk = x?.warm ? C.warm : C.kg;
        const fr = x?.warm ? C.warm : C.rep;
        if (x?.text) this.merge(r, c, r, c + 1, x.text, st(fk, { dotted: true, size: 9, edge: ed({ l: i === 0 }) }));
        else {
          this.put(r, c, cell(x?.kg ?? null, st(fk, { dotted: true, bold: true, fmt: '0.0', edge: ed({ l: i === 0 }) })));
          this.put(r, c + 1, cell(x?.rep ?? null, st(fr, { dotted: true, edge: ed() })));
        }
      }
      this.put(r, L.rpe, cell(num(e.rpe), st(C.kg, { dotted: true, bold: true, edge: ed({ r: true }) })));
      this.merge(r, L.date, r, L.note, e.notes, st(C.note, { dotted: true, align: 'left', wrap: true, size: 10, edge: ed({ r: true }) }));
    });
    this.rows.push([]);
  }
  sheet(name: string, extraWidths?: number[]): XSheet {
    const w = tableWidths(this.n);
    return { name, rows: this.rows, merges: this.merges, heights: this.heights, widths: extraWidths ?? w, noGrid: true, landscape: true };
  }
}
const seriesCount = (blocks: { rows: ExRow[] }[]) => Math.min(20, Math.max(3, ...blocks.flatMap((x) => x.rows.map((r) => r.sets.length))));

/* ---------- plan ---------- */

/** Ćwiczenia jednostki planu w układzie tabeli: plan po lewej, w seriach ciężar do wykonania (powtórzenia do wpisania). */
export function planExRows(k: PlanWorkout): ExRow[] {
  const labels = exerciseLabels(k.exercises);
  return k.exercises
    .map((e, i) => ({ e, label: labels[i] }))
    .filter(({ e }) => e.name.trim())
    .map(({ e, label }) => {
      const all = expandSets(e.groups);
      const work = all.filter((g) => g.type !== 'Rozgrzewka');
      const warmN = all.length - work.length;
      const sets: XSet[] = all.map((g) => {
        const warm = g.type === 'Rozgrzewka';
        if (e.cardio) return { kg: null, rep: null, warm, text: [g.reps && `${g.reps}${/\d$/.test(g.reps) ? ' min' : ''}`, g.load && `${g.load.replace('.', ',')}${/\d$/.test(g.load) ? ' km' : ''}`, g.pace].filter(Boolean).join(' · ') };
        return { kg: num(g.load), rep: null, warm };
      });
      const reps = joinSeq(work.map((g) => g.reps));
      const t = splitTempo(e.notes);
      const extra = [warmN ? `rozgrzewka: ${warmN === 1 ? 'seria 1' : `serie 1–${warmN}`}` : '', ...e.groups.filter((g) => g.type && g.type !== 'Robocze' && g.type !== 'Rozgrzewka').map((g) => g.type)];
      return {
        name: label && /\d/.test(label) ? `${label} ${e.name}` : e.name,
        plan: {
          sets: work.length ? String(work.length) : '',
          reps: e.cardio ? '' : reps ? `${reps}${e.perSide && !/str\./.test(reps) ? '/str.' : ''}${e.timed && /^\d+$/.test(reps) ? ' s' : ''}` : '',
          rpe: joinRpe(work.map((g) => g.rpe)),
          tempo: t.tempo,
          rest: mmss(e.rest),
        },
        sets,
        rpe: null,
        notes: [...new Set(extra.filter(Boolean)), t.notes].filter(Boolean).join(' · '),
      };
    });
}

/** Arkusz „Plan”: dla każdego tygodnia i jednostki tabela w stylu arkusza trenera. */
export function planTableSheet(plan: Plan, client?: Pick<Client, 'name'>): XSheet {
  const blocks = plan.weeks.flatMap((w, wi) =>
    w.workouts
      .filter((k) => k.exercises.some((e) => e.name.trim()))
      .map((k) => {
        const d = workoutDate(plan, wi, k);
        return { title: [w.name, k.name].filter(Boolean).join(' · ').toUpperCase(), date: d ? dmy(d) : '', rows: planExRows(k) };
      }),
  );
  const g = new Grid(seriesCount(blocks));
  g.info([[b(plan.name)], ...(client ? [['Podopieczny', client.name]] : []), ...(plan.startDate ? [['Start', dmy(plan.startDate)]] : []), []]);
  for (const x of blocks) g.block(x.title, x.date, x.rows);
  return g.sheet('Plan');
}

/** Skoroszyt planu: „Plan” (tabela seria po serii), „Tygodnie” (siatka) i „Do importu” (wczytasz go z powrotem). */
export function planWorkbook(plan: Plan, client?: Pick<Client, 'name'>): XSheet[] {
  const rows = planRows(plan);
  const restCol = rows[0].indexOf('Przerwa');
  // przerwa „90” (sekundy) → „1:30”, żeby w arkuszu było jednolicie m:ss
  const flat = rows.map((r, i) => (i === 0 ? r : r.map((c, ci) => (ci === restCol ? mmss(c) : numOrText(c)))));
  return [planTableSheet(plan, client), { name: 'Tygodnie', rows: planGridRows(plan, client) }, { name: 'Do importu', rows: flat, header: true }];
}

/* ---------- treningi ---------- */

function setCell(e: SessionExercise, x: SetLog): XSet {
  const warm = !!x.warmup;
  if (e.cardio) return { kg: null, rep: null, warm, text: [x.reps != null ? fmtClock(x.reps) : '', x.dist ? `${String(x.dist).replace('.', ',')} km` : '', x.hr ? `${x.hr} ud/min` : ''].filter(Boolean).join(' · ') };
  let rep: string | number | null = x.reps ?? null;
  if (x.unit === 's' && x.reps != null) rep = `${x.reps} s`;
  else if (x.unit === 'min' && x.reps != null) rep = `${String(x.reps).replace('.', ',')} min`;
  else if (x.complex) rep = x.complex;
  if (x.repsR != null) rep = `${String(rep ?? '').replace(/ s$/, '')}/${x.repsR}${x.unit === 's' ? ' s' : ''}`;
  return { kg: x.load ?? null, rep, warm };
}

/** Ćwiczenia zapisanego treningu w układzie tabeli (seria po serii: KG i REP). */
export function sessionExRows(s: TrainingSession): ExRow[] {
  return s.exercises
    .filter((e) => e.name.trim())
    .map((e) => {
      const logs = e.setsLog ?? [];
      const t = splitTempo(e.notes);
      const warmN = logs.filter((x) => x.warmup).length;
      const base = { name: e.label && /\d/.test(e.label) ? `${e.label} ${e.name}` : e.name, notes: [warmN ? `rozgrzewka: ${warmN === 1 ? '1 seria' : `${warmN} serie`}` : '', t.notes].filter(Boolean).join(' · ') };
      const plan = { sets: e.sets ?? '', reps: e.reps ? `${e.reps}${e.perSide && !/str\./.test(e.reps) ? '/str.' : ''}` : '', rpe: e.rpe ?? '', tempo: t.tempo, rest: mmss(e.rest) };
      if (!logs.length) {
        // zapis skrócony („3 × 8 · 60 kg”) — rozpisany na serie
        const n = Math.min(20, Math.max(1, Number(e.sets) || 1));
        return { ...base, plan, sets: Array.from({ length: n }, () => ({ kg: num(e.load), rep: num(e.reps) })), rpe: num(e.rpe) };
      }
      const rpe = joinRpe(logs.filter((x) => !x.warmup).map((x) => x.rpe));
      return { ...base, plan: { ...plan, sets: plan.sets || String(logs.length - warmN) }, sets: logs.map((x) => setCell(e, x)), rpe };
    });
}

function sessionInfo(s: TrainingSession, client?: Pick<Client, 'name'>, withTrainer?: boolean): XCell[][] {
  const ton = tonnage(s);
  const run = runTotals(s);
  return [
    [b('Trening'), s.workoutName || 'Trening'],
    ['Data', dmy(s.date)],
    ...(client ? [['Podopieczny', client.name] as XCell[]] : []),
    ...(withTrainer != null ? [['Rodzaj', withTrainer ? 'z trenerem' : 'samodzielnie'] as XCell[]] : []),
    ...(s.duration ? [['Czas (min)', s.duration] as XCell[]] : []),
    ...(s.srpe != null ? [['Wysiłek (sRPE)', s.srpe] as XCell[]] : []),
    ...(sessionLoad(s) != null ? [['Obciążenie (AU)', sessionLoad(s)] as XCell[]] : []),
    ...(ton ? [['Tonaż (kg)', Math.round(ton)] as XCell[]] : []),
    ...(run && run.km ? [['Dystans (km)', Math.round(run.km * 100) / 100] as XCell[], ['Tempo biegu', run.pace] as XCell[]] : []),
    ...(s.pain != null ? [['Ból (0–10)', s.pain] as XCell[]] : []),
    ...(s.stoppedForPain ? [['Przerwany', 'z powodu bólu'] as XCell[]] : []),
    ...(s.notes ? [['Notatki', s.notes] as XCell[]] : []),
    [],
  ];
}

/** Skoroszyt jednego treningu: dane treningu i tabela ćwiczeń (seria po serii). */
export function sessionWorkbook(s: TrainingSession, client?: Pick<Client, 'name'>, withTrainer?: boolean): XSheet[] {
  const rows = sessionExRows(s);
  const g = new Grid(seriesCount([{ rows }]));
  g.info(sessionInfo(s, client, withTrainer));
  g.block((s.workoutName || 'Trening').toUpperCase(), dmy(s.date), rows);
  return [g.sheet('Trening')];
}

/** Wszystkie treningi klienta: „Treningi” (wiersz na trening) i „Serie” (każdy trening jako tabela seria po serii). */
export function sessionsWorkbook(sessions: TrainingSession[], withTrainer?: (s: TrainingSession) => boolean): XSheet[] {
  const sorted = [...sessions].sort((a, z) => (a.date + (a.createdAt ?? '')).localeCompare(z.date + (z.createdAt ?? '')));
  const list: XCell[][] = [['Data', 'Trening', 'Rodzaj', 'Czas (min)', 'sRPE', 'Obciążenie (AU)', 'Tonaż (kg)', 'Dystans (km)', 'Ból', 'Przerwany', 'Notatki']];
  for (const s of sorted) {
    const run = runTotals(s);
    const ton = tonnage(s);
    list.push([
      dmy(s.date),
      s.workoutName || 'Trening',
      withTrainer ? (withTrainer(s) ? 'z trenerem' : 'samodzielnie') : '',
      s.duration ?? null,
      s.srpe ?? null,
      sessionLoad(s),
      ton ? Math.round(ton) : null,
      run && run.km ? Math.round(run.km * 100) / 100 : null,
      s.pain ?? null,
      s.stoppedForPain ? 'tak' : '',
      s.notes ?? '',
    ]);
  }
  const blocks = sorted.map((s) => ({ title: (s.workoutName || 'Trening').toUpperCase(), date: dmy(s.date), rows: sessionExRows(s) })).filter((x) => x.rows.length);
  const g = new Grid(seriesCount(blocks));
  for (const x of blocks) g.block(x.title, x.date, x.rows);
  return [{ name: 'Treningi', rows: list, header: true }, g.sheet('Serie')];
}
