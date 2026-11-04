import type { Client, Plan, SessionExercise, SetLog, TrainingSession } from '../domain';
import { exerciseSummary } from './plan';
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

/** Skoroszyt planu: arkusz „Plan” (wczytasz go z powrotem przez import) i „Tygodnie” (siatka do druku / podglądu). */
export function planWorkbook(plan: Plan, client?: Pick<Client, 'name'>): XSheet[] {
  const rows = planRows(plan);
  const restCol = rows[0].indexOf('Przerwa');
  // przerwa „90” (sekundy) → „1:30”, żeby w arkuszu było jednolicie m:ss
  const rest = (c: string) => (/^\d+$/.test(c.trim()) ? `${Math.floor(Number(c) / 60)}:${String(Number(c) % 60).padStart(2, '0')}` : c);
  const flat = rows.map((r, i) => (i === 0 ? r : r.map((c, ci) => (ci === restCol ? rest(c) : numOrText(c)))));
  return [
    { name: 'Plan', rows: flat, header: true },
    { name: 'Tygodnie', rows: planGridRows(plan, client) },
  ];
}

/* ---------- treningi ---------- */

const SET_HEAD = ['Ćwiczenie', 'Seria', 'Typ', 'Powt. / czas', 'Prawa strona', 'Ciężar (kg)', 'RPE', 'Dystans (km)', 'Tempo', 'Tętno', 'Uwagi'];

function setCells(e: SessionExercise, x: SetLog, i: number): XCell[] {
  const type = x.label || (x.warmup ? 'Rozgrzewka' : 'Robocza');
  let reps: string | number | null = x.reps ?? null;
  if (e.cardio && x.reps != null) reps = fmtClock(x.reps);
  else if (x.unit === 's' && x.reps != null) reps = `${x.reps} s`;
  else if (x.unit === 'min' && x.reps != null) reps = `${String(x.reps).replace('.', ',')} min`;
  else if (x.complex) reps = x.complex;
  const pace = e.cardio && x.reps && x.dist ? `${fmtClock(x.reps / x.dist)}/km` : '';
  return [e.name, i + 1, type, reps, x.repsR ?? null, e.cardio ? null : x.load ?? null, x.rpe ?? null, x.dist ?? null, pace, x.hr ?? null, i === 0 ? e.notes ?? '' : ''];
}

function exerciseRows(e: SessionExercise): XCell[][] {
  const logs = e.setsLog ?? [];
  if (logs.length) return logs.map((x, i) => setCells(e, x, i));
  // zapis skrócony (trener: „3 × 8 · 60 kg”)
  return [[e.name, e.sets ? `${e.sets} ${Number(e.sets) === 1 ? 'seria' : Number(e.sets) % 10 >= 2 && Number(e.sets) % 10 <= 4 && (Number(e.sets) % 100 < 12 || Number(e.sets) % 100 > 14) ? 'serie' : 'serii'}` : '', 'Robocza', numOrText(e.reps ?? ''), null, numOrText(e.load ?? ''), numOrText(e.rpe ?? ''), null, '', null, e.notes ?? '']];
}

/** Skoroszyt jednego treningu: dane treningu i tabela serii. */
export function sessionWorkbook(s: TrainingSession, client?: Pick<Client, 'name'>, withTrainer?: boolean): XSheet[] {
  const ton = tonnage(s);
  const run = runTotals(s);
  const info: XCell[][] = [
    [b('Trening'), s.workoutName || 'Trening'],
    ['Data', dmy(s.date)],
    ...(client ? [['Podopieczny', client.name] as XCell[]] : []),
    ...(withTrainer != null ? [['Rodzaj', withTrainer ? 'z trenerem' : 'samodzielnie'] as XCell[]] : []),
    ...(s.duration ? [['Czas (min)', s.duration] as XCell[]] : []),
    ...(s.srpe != null ? [['Wysiłek (sRPE)', s.srpe] as XCell[]] : []),
    ...(sessionLoad(s) != null ? [['Obciążenie (AU)', sessionLoad(s)] as XCell[]] : []),
    ...(ton ? [['Tonaż (kg)', Math.round(ton)] as XCell[]] : []),
    ...(run && run.km ? [['Dystans (km)', Math.round(run.km * 100) / 100] as XCell[], ['Tempo', run.pace] as XCell[]] : []),
    ...(s.pain != null ? [['Ból (0–10)', s.pain] as XCell[]] : []),
    ...(s.stoppedForPain ? [['Przerwany', 'z powodu bólu'] as XCell[]] : []),
    ...(s.notes ? [['Notatki', s.notes] as XCell[]] : []),
    [],
    SET_HEAD.map(b),
  ];
  return [{ name: 'Trening', rows: [...info, ...s.exercises.filter((e) => e.name.trim()).flatMap(exerciseRows)], widths: [26, 8, 13, 13, 12, 12, 7, 13, 11, 8, 36] }];
}

/** Wszystkie treningi klienta: arkusz „Treningi” (wiersz na trening) i „Serie” (wiersz na serię). */
export function sessionsWorkbook(sessions: TrainingSession[], withTrainer?: (s: TrainingSession) => boolean): XSheet[] {
  const sorted = [...sessions].sort((a, z) => (a.date + (a.createdAt ?? '')).localeCompare(z.date + (z.createdAt ?? '')));
  const list: XCell[][] = [['Data', 'Trening', 'Rodzaj', 'Czas (min)', 'sRPE', 'Obciążenie (AU)', 'Tonaż (kg)', 'Dystans (km)', 'Ból', 'Przerwany', 'Notatki']];
  const sets: XCell[][] = [['Data', 'Trening', ...SET_HEAD]];
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
    for (const e of s.exercises.filter((x) => x.name.trim())) for (const r of exerciseRows(e)) sets.push([dmy(s.date), s.workoutName || 'Trening', ...r]);
  }
  return [
    { name: 'Treningi', rows: list, header: true },
    { name: 'Serie', rows: sets, header: true },
  ];
}
