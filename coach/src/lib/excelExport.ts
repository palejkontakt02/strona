import type { Client, Plan, PlanWorkout, SessionExercise, SetLog, TrainingSession } from '../domain';
import { exerciseLabels, exerciseSummary, expandSets, workoutDate } from './plan';
import { planRows } from './sheetImport';
import { sessionLoad, tonnage } from './load';
import { fmtClock, runTotals } from './running';
import { numOrText, type XCell, type XSheet } from './xlsxWrite';

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

/* ---------- wspólny układ: ćwiczenie w wierszu, każda seria w kolumnie „powt. × ciężar”, na końcu RPE, tempo, uwagi ---------- */

const TEMPO_RE = /[0-9xX]\s*-\s*[0-9xX]\s*-\s*[0-9xX]\s*-\s*[0-9xX]/;
/** Tempo z uwag („tempo 3-1-X-0, kolana na zewnątrz” → tempo „3-1-X-0”, uwagi „kolana na zewnątrz”). */
export function splitTempo(notes?: string): { tempo: string; notes: string } {
  const t = String(notes ?? '');
  const m = t.match(TEMPO_RE);
  if (!m) return { tempo: '', notes: t.trim() };
  return { tempo: m[0].replace(/\s/g, '').toUpperCase(), notes: t.replace(/tempo\s*:?\s*/i, '').replace(TEMPO_RE, '').replace(/^[\s,;·-]+|[\s,;·-]+$/g, '') };
}

const kg = (v: string | number | undefined | null) => {
  const t = String(v ?? '').trim();
  if (!t) return '';
  if (/^-?\d+(?:[.,]\d+)?$/.test(t)) return `${t.replace('.', ',')} kg`;
  return t.replace(/(\d)\.(\d)/g, '$1,$2'); // „-10%”, „70%”, „BW”
};
const joinRpe = (vals: (string | number | undefined | null)[]) => {
  const u = [...new Set(vals.map((v) => String(v ?? '').trim().replace('.', ',')).filter(Boolean))];
  return u.length <= 1 ? (u[0] ?? '') : u.join(' / ');
};

export interface ExRow {
  name: string;
  sets: string[];
  rpe: string;
  tempo: string;
  notes: string;
}

/** Blok tabeli: tytuł, nagłówek „Ćwiczenie | Seria 1…N | RPE | Tempo | Uwagi” i ćwiczenia jedno pod drugim. */
function block(title: string, rows: ExRow[], n: number): XCell[][] {
  return [
    [b(title)],
    [b('Ćwiczenie'), ...Array.from({ length: n }, (_, i) => b(`Seria ${i + 1}`)), b('RPE'), b('Tempo'), b('Uwagi')],
    ...rows.map((r) => [r.name, ...Array.from({ length: n }, (_, i) => r.sets[i] ?? ''), r.rpe, r.tempo, r.notes] as XCell[]),
    [],
  ];
}
const widths = (n: number) => [28, ...Array.from({ length: n }, () => 13), 8, 10, 40];

/* ---------- plan ---------- */

/** Ćwiczenia jednostki planu w układzie tabeli (seria po serii). */
export function planExRows(k: PlanWorkout): ExRow[] {
  const labels = exerciseLabels(k.exercises);
  return k.exercises
    .map((e, i) => ({ e, label: labels[i] }))
    .filter(({ e }) => e.name.trim())
    .map(({ e, label }) => {
      const sets = expandSets(e.groups).map((g) => {
        const warm = g.type === 'Rozgrzewka' ? 'R ' : '';
        if (e.cardio) return [g.reps && `${g.reps}${/\d$/.test(g.reps) ? ' min' : ''}`, g.load && `${g.load.replace('.', ',')}${/\d$/.test(g.load) ? ' km' : ''}`, g.pace].filter(Boolean).join(' · ');
        const reps = g.reps ? `${g.reps}${e.perSide && !/str\./.test(g.reps) ? '/str.' : ''}` : '';
        const load = kg(g.load);
        return `${warm}${[reps, load].filter(Boolean).join(' × ')}`.trim();
      });
      const t = splitTempo(e.notes);
      const rest = e.rest && /^\d+$/.test(e.rest.trim()) ? `${Math.floor(Number(e.rest) / 60)}:${String(Number(e.rest) % 60).padStart(2, '0')}` : e.rest;
      const extra = [rest ? `przerwa ${rest}` : '', ...e.groups.filter((g) => g.type && g.type !== 'Robocze' && g.type !== 'Rozgrzewka').map((g) => g.type)];
      return { name: label && /\d/.test(label) ? `${label} ${e.name}` : e.name, sets, rpe: joinRpe(e.groups.filter((g) => g.type !== 'Rozgrzewka').map((g) => g.rpe)), tempo: t.tempo, notes: [t.notes, ...new Set(extra.filter(Boolean))].filter(Boolean).join(' · ') };
    });
}

/** Arkusz „Plan”: dla każdego tygodnia i jednostki tabela ćwiczeń (seria po serii). */
export function planTableRows(plan: Plan, client?: Pick<Client, 'name'>): { rows: XCell[][]; n: number } {
  const blocks = plan.weeks.flatMap((w, wi) =>
    w.workouts
      .filter((k) => k.exercises.some((e) => e.name.trim()))
      .map((k) => {
        const d = workoutDate(plan, wi, k);
        return { title: [w.name, k.name, d ? dmy(d) : ''].filter(Boolean).join(' · '), rows: planExRows(k) };
      }),
  );
  const n = Math.max(1, ...blocks.flatMap((x) => x.rows.map((r) => r.sets.length)));
  const head: XCell[][] = [[b(plan.name)], ...(client ? [['Podopieczny', client.name]] : []), ...(plan.startDate ? [['Start', dmy(plan.startDate)]] : []), []];
  return { rows: [...head, ...blocks.flatMap((x) => block(x.title, x.rows, n))], n };
}

/** Skoroszyt planu: „Plan” (tabela seria po serii), „Tygodnie” (siatka) i „Do importu” (wczytasz go z powrotem). */
export function planWorkbook(plan: Plan, client?: Pick<Client, 'name'>): XSheet[] {
  const rows = planRows(plan);
  const restCol = rows[0].indexOf('Przerwa');
  // przerwa „90” (sekundy) → „1:30”, żeby w arkuszu było jednolicie m:ss
  const rest = (c: string) => (/^\d+$/.test(c.trim()) ? `${Math.floor(Number(c) / 60)}:${String(Number(c) % 60).padStart(2, '0')}` : c);
  const flat = rows.map((r, i) => (i === 0 ? r : r.map((c, ci) => (ci === restCol ? rest(c) : numOrText(c)))));
  const t = planTableRows(plan, client);
  return [
    { name: 'Plan', rows: t.rows, widths: widths(t.n) },
    { name: 'Tygodnie', rows: planGridRows(plan, client) },
    { name: 'Do importu', rows: flat, header: true },
  ];
}

/* ---------- treningi ---------- */

function setText(e: SessionExercise, x: SetLog): string {
  const warm = x.warmup ? 'R ' : '';
  if (e.cardio) return [x.reps != null ? fmtClock(x.reps) : '', x.dist ? `${String(x.dist).replace('.', ',')} km` : '', x.hr ? `${x.hr} ud/min` : ''].filter(Boolean).join(' · ');
  let reps = x.reps != null ? String(x.reps) : '';
  if (x.unit === 's' && x.reps != null) reps = `${x.reps} s`;
  else if (x.unit === 'min' && x.reps != null) reps = `${String(x.reps).replace('.', ',')} min`;
  else if (x.complex) reps = x.complex;
  if (x.repsR != null) reps = `${reps}/${x.repsR}${x.unit === 's' ? ' s' : ''}`.replace(' s/', '/');
  return `${warm}${[reps, x.load != null ? kg(x.load) : ''].filter(Boolean).join(' × ')}`.trim();
}

/** Ćwiczenia zapisanego treningu w układzie tabeli (seria po serii). */
export function sessionExRows(s: TrainingSession): ExRow[] {
  return s.exercises
    .filter((e) => e.name.trim())
    .map((e) => {
      const logs = e.setsLog ?? [];
      const t = splitTempo(e.notes);
      if (!logs.length) {
        // zapis skrócony („3 × 8 · 60 kg”) — rozpisany na serie
        const n = Math.min(20, Math.max(1, Number(e.sets) || 1));
        const cell = [e.reps ?? '', kg(e.load)].filter(Boolean).join(' × ');
        return { name: e.name, sets: Array.from({ length: n }, () => cell), rpe: joinRpe([e.rpe]), tempo: t.tempo, notes: t.notes };
      }
      return { name: e.name, sets: logs.map((x) => setText(e, x)), rpe: joinRpe(logs.filter((x) => !x.warmup).map((x) => x.rpe)), tempo: t.tempo, notes: t.notes };
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
  const n = Math.max(1, ...rows.map((r) => r.sets.length));
  return [{ name: 'Trening', rows: [...sessionInfo(s, client, withTrainer), ...block('Ćwiczenia', rows, n)], widths: widths(n) }];
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
  const blocks = sorted.map((s) => ({ title: [dmy(s.date), s.workoutName || 'Trening'].join(' · '), rows: sessionExRows(s) })).filter((x) => x.rows.length);
  const n = Math.max(1, ...blocks.flatMap((x) => x.rows.map((r) => r.sets.length)));
  return [
    { name: 'Treningi', rows: list, header: true },
    { name: 'Serie', rows: blocks.flatMap((x) => block(x.title, x.rows, n)), widths: widths(n) },
  ];
}
