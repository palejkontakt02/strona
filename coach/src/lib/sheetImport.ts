import { SET_TYPES, type Plan, type PlanExercise, type PlanWeek, type PlanWorkout, type SetGroup, type SetType } from '../domain';
import { uid } from '../format';
import { addDays, weekStart } from './dates';
import { exerciseBlocks, exerciseLabels, mergeGroups } from './plan';
import { cardioByName } from './run';
import { parseDur, parseKm } from './running';

/**
 * Import planu z arkusza (Excel / Google Sheets: wklejony zakres TSV, plik CSV) i eksport do CSV
 * (UTF-8 z BOM, średnik, przecinek dziesiętny) w tym samym układzie kolumn.
 */

export type SheetField = 'week' | 'day' | 'workout' | 'exercise' | 'sets' | 'reps' | 'load' | 'rpe' | 'rest' | 'notes' | 'type' | 'dist' | 'target' | 'skip';

export const FIELD_LABEL: Record<SheetField, string> = {
  week: 'Tydzień',
  day: 'Dzień',
  workout: 'Trening',
  exercise: 'Ćwiczenie',
  sets: 'Serie',
  reps: 'Powt.',
  load: 'Ciężar',
  rpe: 'RPE',
  rest: 'Przerwa',
  notes: 'Uwagi',
  type: 'Typ serii',
  dist: 'Dystans',
  target: 'Cel',
  skip: 'Pomiń',
};
export const SHEET_FIELDS = Object.keys(FIELD_LABEL) as SheetField[];

/** Kolumny eksportu (i kolejność rozpoznawana przy imporcie bez nagłówka). Dystans i Cel — tylko w planach z biegiem / cardio. */
const EXPORT_COLS: SheetField[] = ['week', 'day', 'workout', 'exercise', 'sets', 'reps', 'load', 'rpe', 'rest', 'notes', 'type', 'dist', 'target'];
const BASE_COLS = EXPORT_COLS.slice(0, 11);

/** Małe litery bez polskich znaków i interpunkcji. */
export const fold = (s: string) =>
  s
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9%@ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const HEADERS: [SheetField, RegExp][] = [
  ['week', /^(tydzien|tydz|tyg|tydzien treningowy|week|wk|mikrocykl|microcycle)( nr)?$/],
  ['day', /^(dzien|dzien tygodnia|data|termin|day|date|weekday)$/],
  ['workout', /^(trening|jednostka|sesja|workout|session|training|blok treningowy)( nr)?$/],
  ['exercise', /^(cwiczenie|cwiczenia|nazwa|nazwa cwiczenia|exercise|exercises|movement|name)$/],
  ['sets', /^(serie|serii|ilosc serii|liczba serii|sets?|s)$/],
  ['reps', /^(powt|powtorzenia|powtorzen|ilosc powtorzen|reps?|repetitions|p)$/],
  ['load', /^(ciezar|obciazenie|kg|ciezar kg|load|weight|intensywnosc kg|%|% 1rm)$/],
  ['rpe', /^(rpe|@|rpe cel|target rpe)$/],
  ['rest', /^(przerwa|odpoczynek|przerwa s|rest|rest s|recovery)$/],
  ['notes', /^(uwagi|notatki|notatka|komentarz|opis|tempo|notes?|comments?|cues)$/],
  ['type', /^(typ|typ serii|rodzaj|rodzaj serii|type|set type)$/],
  ['dist', /^(dystans|distance|dist|km|odleglosc|dlugosc odcinka)( (km|m|w m|w km))?$/],
  ['target', /^(cel|strefa|strefa tetna|tempo cel|tempo strefa|target|zone|pace|intensywnosc)$/],
];

/** Pole dla nagłówka kolumny (PL / EN); nieznany → null. */
export function headerField(h: string): SheetField | null {
  const f = fold(h);
  if (!f) return null;
  for (const [field, re] of HEADERS) if (re.test(f)) return field;
  // „Obciążenie (kg)”, „Ciężar [kg]”, „Load (kg)”, „Weight lbs”
  if (/^(ciezar|obciazenie|load|weight)\b/.test(f)) return 'load';
  return null;
}

/** Tekst z arkusza → wiersze komórek. Tab (wklejony zakres), inaczej średnik albo przecinek; cudzysłowy jak w CSV. */
export function parseTable(text: string): string[][] {
  const t = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const first = t.split('\n').find((l) => l.trim()) ?? '';
  const outside = first.replace(/"[^"]*"/g, '');
  const sep = t.includes('\t') ? '\t' : (outside.match(/;/g)?.length ?? 0) >= (outside.match(/,/g)?.length ?? 0) && outside.includes(';') ? ';' : outside.includes(',') ? ',' : ';';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => [...r.map((x) => x.trim()), ...Array(width - r.length).fill('')]);
}

export interface ColumnGuess {
  /** Wiersz nagłówka (-1 — brak, dane od pierwszego wiersza). */
  headerRow: number;
  map: SheetField[];
}

/**
 * Rozpoznanie kolumn: pierwszy z 10 pierwszych wierszy, w którym ≥ 2 komórki to znane nagłówki.
 * Bez nagłówka: jedna kolumna → „Ćwiczenie” (zapis „Przysiad 4x6 @RPE8 100kg”), inaczej kolejność jak w eksporcie.
 */
export function detectColumns(rows: string[][]): ColumnGuess {
  const width = Math.max(0, ...rows.map((r) => r.length));
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const fs = rows[i].map((c) => headerField(c));
    if (fs.filter(Boolean).length >= 2 || (fs.filter(Boolean).length === 1 && rows[i].filter((c) => c.trim()).length === 1 && fs.some((f) => f === 'exercise'))) {
      const used = new Set<SheetField>();
      const map = Array.from({ length: width }, (_, j) => {
        const f = fs[j];
        if (!f || used.has(f)) return 'skip' as const;
        used.add(f);
        return f;
      });
      return { headerRow: i, map };
    }
  }
  const nonEmpty = Array.from({ length: width }, (_, j) => rows.some((r) => r[j]?.trim()));
  if (nonEmpty.filter(Boolean).length <= 1) return { headerRow: -1, map: nonEmpty.map((x) => (x ? 'exercise' : 'skip')) };
  return { headerRow: -1, map: Array.from({ length: width }, (_, j) => EXPORT_COLS[j] ?? 'skip') };
}

export interface Inline {
  name: string;
  sets?: string;
  reps?: string;
  load?: string;
  rpe?: string;
}

/** „Przysiad 4x6 @RPE8 100kg”, „Wyciskanie 3×8–10 @8 80 kg”, „Martwy ciąg 5x5 120”, „Podciąganie 4x6-8 RPE 7”. */
export function parseInline(text: string): Inline {
  let s = ` ${text.trim()} `;
  const out: Inline = { name: '' };
  const rpe = s.match(/(?:@\s*(?:rpe\s*)?|\brpe\s*[:=]?\s*)(\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?)/i);
  if (rpe) {
    out.rpe = rpe[1].replace(/\s/g, '').replace(/,/g, '.').replace('-', '–');
    s = s.replace(rpe[0], ' ');
  }
  const kg = s.match(/(\d+(?:[.,]\d+)?)\s*kg\b/i) ?? s.match(/([+-]?\d+(?:[.,]\d+)?)\s*%/);
  if (kg) {
    out.load = /%/.test(kg[0]) ? `${kg[1].replace(',', '.')}%` : kg[1].replace(',', '.');
    s = s.replace(kg[0], ' ');
  }
  const sr = s.match(/(\d+)\s*[x×*]\s*(\d+(?:\s*[-–]\s*\d+)?(?:\s*(?:s|sek|min)\b)?(?:\s*\/\s*str\.?)?)/i);
  if (sr) {
    out.sets = sr[1];
    out.reps = sr[2].replace(/\s+/g, '').replace('-', '–').replace(/(\d)(s|sek|min)\b/i, '$1 $2');
    const idx = s.indexOf(sr[0]);
    const after = s.slice(idx + sr[0].length);
    out.name = s.slice(0, idx);
    // „5x5 120” — liczba po serii to ciężar
    const bare = after.match(/^\s*(\d+(?:[.,]\d+)?)\b(?!\s*(?:x|×|s\b|min|sek))/i);
    if (!out.load && bare) {
      out.load = bare[1].replace(',', '.');
      out.name += ` ${after.replace(bare[0], ' ')}`;
    } else out.name += ` ${after}`;
  } else out.name = s;
  out.name = out.name.replace(/\s+/g, ' ').replace(/[\s:–—-]+$/, '').replace(/^[\s:–—-]+/, '').trim();
  return out;
}

const DAYS: [RegExp, number][] = [
  [/^(pon|poniedzialek|pn|mon|monday)$/, 1],
  [/^(wt|wtorek|tue|tues|tuesday)$/, 2],
  [/^(sr|sroda|wed|wednesday)$/, 3],
  [/^(czw|czwartek|cz|thu|thur|thurs|thursday)$/, 4],
  [/^(pt|piatek|pia|fri|friday)$/, 5],
  [/^(sob|sobota|so|sat|saturday)$/, 6],
  [/^(nd|nie|niedz|niedziela|ndz|sun|sunday)$/, 7],
];

/** Dzień z komórki: nazwa dnia / numer 1–7 → dzień tygodnia; data (dd.mm.rrrr, rrrr-mm-dd, numer seryjny Excela) → data. */
export function parseDay(v: string, year = new Date().getFullYear()): { day?: number; date?: string } {
  const t = v.trim();
  if (!t) return {};
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}` };
  m = t.match(/(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/);
  if (m && Number(m[2]) <= 12) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : year;
    return { date: `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}` };
  }
  if (/^\d{5}(\.\d+)?$/.test(t)) {
    // numer seryjny daty z Excela (dni od 30.12.1899)
    return { date: addDays('1899-12-30', Math.floor(Number(t))) };
  }
  const f = fold(t);
  const word = f.split(' ')[0];
  for (const [re, d] of DAYS) if (re.test(word)) return { day: d };
  const n = f.match(/(\d+)/);
  if (n && Number(n[1]) >= 1 && Number(n[1]) <= 7) return { day: Number(n[1]) };
  return {};
}

const weekKey = (v: string) => {
  const n = fold(v).match(/(\d+)/);
  return n ? `#${Number(n[1])}` : fold(v);
};
const weekName = (v: string) => {
  const n = fold(v).match(/(\d+)/);
  return n && fold(v).replace(/\d+/, '').replace(/^(tydzien|tydz|tyg|week|wk|w|t|mikrocykl)\s*/, '').trim() === '' ? `Tydzień ${Number(n[1])}` : v.trim();
};
const workoutName = (v: string) => {
  const t = v.trim();
  if (/^[A-Za-z]$/.test(t)) return `Trening ${t.toUpperCase()}`;
  if (/^\d+$/.test(t)) return `Trening ${t}`;
  return t;
};

function setType(v: string): SetType {
  const f = fold(v);
  if (!f) return 'Robocze';
  const exact = SET_TYPES.find((x) => fold(x) === f);
  if (exact) return exact;
  if (/rozgrz|warm/.test(f)) return 'Rozgrzewka';
  if (/top/.test(f)) return 'Top set';
  if (/back ?off|odciaz/.test(f)) return 'Back-off';
  if (/drop/.test(f)) return 'Drop set';
  if (/amrap|max/.test(f)) return 'AMRAP';
  if (/schlodz|cool/.test(f)) return 'Schłodzenie';
  return 'Robocze';
}

/** Ciężar: „100 kg” → „100”, „102,5” → „102.5”, „75%” / „-10%” bez zmian; inny tekst → null (trafi do uwag). */
function cleanLoad(v: string): string | null {
  const t = v.trim().replace(/\s*kg\.?$/i, '').trim();
  if (!t) return '';
  if (/^[+-]?\d+(?:[.,]\d+)?\s*%$/.test(t)) return t.replace(/\s/g, '').replace(',', '.');
  if (/^\d+(?:[.,]\d+)?$/.test(t)) return t.replace(',', '.');
  return null;
}
const cleanRpe = (v: string) => v.replace(/rpe|@/gi, '').trim().replace(/,/g, '.').replace(/\s*-\s*/, '–');
const cleanReps = (v: string) => v.trim().replace(/\s*-\s*/, '–');

/** „8/str.”, „20 s/str.”, „8 na stronę” → [powtórzenia bez dopisku, na stronę]. */
export function splitSide(reps: string): [string, boolean] {
  const m = reps.match(/^(.*?)\s*(?:\/\s*(?:str\.?|stron[eęa]|side)|na\s+stron[eę]|per\s+side|each\s+side|e\/s)\s*$/i);
  return m && m[1].trim() ? [m[1].trim(), true] : [reps, false];
}

const mss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

/** Przerwa do m:ss: „2'” → „2:00”, „90s” → „1:30”, „1'30''” → „1:30”, „2 min trucht” → „2:00 trucht”; inny zapis bez zmian. */
export function normRest(v: string): string {
  const t = v.trim();
  let m = t.match(/^(\d+)\s*'\s*(\d{1,2})\s*(?:''|"|s)?(?=\s|$)(.*)$/i);
  if (m && +m[2] < 60) return `${m[1]}:${m[2].padStart(2, '0')}${m[3]}`;
  m = t.match(/^(\d+(?:[.,]\d+)?)\s*(?:'|min\.?|minut[ay]?|m)(?=\s|$)(.*)$/i);
  if (m) return `${mss(parseFloat(m[1].replace(',', '.')) * 60)}${m[2]}`;
  m = t.match(/^(\d+)\s*(?:s|sek\.?|sec|''|")(?=\s|$)(.*)$/i);
  if (m) return `${mss(+m[1])}${m[2]}`;
  return t;
}

/** Czas odcinka biegu z arkusza → minuty jak w planie: „1:18:45” → „78:45”, „75” zostaje. */
function cardioTime(v: string): string {
  if (!/^\d+:\d{1,2}:\d{1,2}$/.test(v.trim())) return v;
  const d = parseDur(v);
  if (d == null) return v;
  const sec = Math.round(d * 60);
  return sec % 60 === 0 ? String(sec / 60) : mss(sec);
}

/** Dystans z kolumny „Dystans”: „800 m” → „800 m”, „10 km” / „10” → „10”, „8,5 km” → „8.5”. */
function cleanDist(v: string): string {
  const t = v.trim();
  if (!t) return '';
  const km = parseKm(t.replace(/\s+/g, ' ').replace(/\s*(km|m)\.?$/i, ' $1').trim());
  if (km == null) return t;
  return km < 1 ? `${Math.round(km * 1000)} m` : String(km);
}

/** Domyślne dni tygodnia dla n treningów w tygodniu (gdy arkusz nie ma kolumny dnia). */
const SPREAD: Record<number, number[]> = { 1: [1], 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6], 7: [1, 2, 3, 4, 5, 6, 7] };

export interface SheetResult {
  plan: Plan;
  warnings: string[];
  stats: { weeks: number; workouts: number; exercises: number; rows: number };
}

const LABEL = /^([A-Z])(\d)?[.)]?\s+(?=\S)/;

/**
 * Wiersze arkusza → plan. Puste komórki tygodnia / dnia / treningu (scalone komórki) dziedziczą wartość z góry;
 * wiersz bez ćwiczenia, ale z powtórzeniami / ciężarem, to kolejna seria poprzedniego ćwiczenia;
 * wiersz z samym „Tydzień 2” / „Trening B” ustawia tydzień / trening dla kolejnych.
 */
export function sheetToPlan(rows: string[][], map: SheetField[], headerRow: number, opts: { clientId: string; name?: string; startDate: string; today?: string }): SheetResult {
  const warnings: string[] = [];
  const col = (f: SheetField) => map.indexOf(f);
  const get = (r: string[], f: SheetField) => (col(f) >= 0 ? (r[col(f)] ?? '').trim() : '');
  const year = Number((opts.today ?? opts.startDate).slice(0, 4));
  const weeks: (PlanWeek & { key: string })[] = [];
  let cur = { week: '', day: '', workout: '' };
  let lastEx: PlanExercise | null = null;
  let lastWorkout: PlanWorkout | null = null;
  let lastLabel: { letter: string } | null = null;
  let dataRows = 0;
  const odd: string[] = [];
  const hasWorkoutCol = col('workout') >= 0;
  const wkey = new Map<PlanWorkout, string>();

  const weekFor = (raw: string) => {
    const key = raw ? weekKey(raw) : '#1';
    let w = weeks.find((x) => x.key === key);
    if (!w) {
      w = { id: uid(), key, name: raw ? weekName(raw) : 'Tydzień 1', workouts: [] };
      weeks.push(w);
    }
    return w;
  };

  rows.forEach((r, ri) => {
    if (ri <= headerRow) return;
    const filled = r.filter((c) => c.trim());
    if (!filled.length) return;
    // wiersz-sekcja: „Tydzień 2” albo „Trening B” w jednej komórce
    if (filled.length === 1) {
      const only = filled[0].trim();
      const f = fold(only);
      if (/^(tydzien|tydz|tyg|week|mikrocykl)\b/.test(f)) {
        cur = { week: only, day: '', workout: '' };
        lastEx = null;
        return;
      }
      if (/^(trening|jednostka|sesja|workout|session)\b/.test(f) || (/^(dzien|day)\s*\d+$/.test(f) && !hasWorkoutCol)) {
        cur = { ...cur, workout: only, day: col('day') >= 0 ? '' : cur.day };
        lastEx = null;
        return;
      }
    }
    const wv = get(r, 'week');
    const dv = get(r, 'day');
    const kv = get(r, 'workout');
    if (wv && wv !== cur.week) cur = { week: wv, day: '', workout: '' };
    if (dv && dv !== cur.day) cur = { ...cur, day: dv, workout: '' };
    if (kv) cur = { ...cur, workout: kv };
    let exText = get(r, 'exercise');
    let label: { letter: string; n?: number } | null = null;
    const lm = exText.match(LABEL);
    if (lm && exText.length > lm[0].length + 2) {
      label = { letter: lm[1].toUpperCase(), n: lm[2] ? Number(lm[2]) : undefined };
      exText = exText.slice(lm[0].length);
    }
    let sets = get(r, 'sets');
    let reps = get(r, 'reps');
    const distRaw = get(r, 'dist');
    const target = get(r, 'target');
    // kolumny serii / powtórzeń / dystansu wypełnione — nazwa zostaje w całości („Interwały 6 × 800 m”)
    const structured = !!(sets || reps || distRaw || target);
    const inline: Inline = exText ? (structured && cardioByName(exText) ? { name: exText.replace(/\s+/g, ' ').trim() } : parseInline(exText)) : { name: '' };
    if (/[x×]/i.test(sets) && !reps) {
      const m = sets.match(/(\d+)\s*[x×]\s*(.+)/i);
      if (m) [sets, reps] = [m[1], m[2]];
    }
    sets = sets || inline.sets || '';
    reps = cleanReps(reps || inline.reps || '');
    const loadRaw = get(r, 'load') || inline.load || '';
    const rpe = cleanRpe(get(r, 'rpe') || inline.rpe || '');
    const rest = normRest(get(r, 'rest'));
    const notes = get(r, 'notes');
    if (!inline.name && !reps && !loadRaw && !sets && !rpe && !distRaw && !target) return;
    const [repsNoSide, side] = splitSide(reps);
    reps = repsNoSide;
    dataRows++;

    // trening (jednostka) dla wiersza
    const week = weekFor(cur.week);
    const wname = cur.workout ? workoutName(cur.workout) : '';
    const pd = parseDay(cur.day, year);
    const key = wname ? `n:${wname}` : `d:${cur.day ? fold(cur.day) : ''}`;
    let k = week.workouts.find((x) => wkey.get(x) === key);
    if (!k) {
      k = { id: uid(), name: wname, ...(pd.date ? { date: pd.date } : pd.day ? { day: pd.day } : {}), exercises: [] };
      wkey.set(k, key);
      week.workouts.push(k);
    } else if (!k.day && !k.date && (pd.date || pd.day)) Object.assign(k, pd.date ? { date: pd.date } : { day: pd.day });
    if (k !== lastWorkout) {
      lastEx = null;
      lastLabel = null;
    }
    lastWorkout = k;

    let load = cleanLoad(loadRaw);
    let extraNote = '';
    if (load == null) {
      extraNote = `ciężar: ${loadRaw}`;
      load = '';
      if (!odd.includes(loadRaw)) odd.push(loadRaw);
    }
    const type = setType(get(r, 'type'));
    const n = /[-–]/.test(sets) ? 1 : Math.max(1, Math.min(20, Number.parseInt(sets, 10) || 1));
    const exName = inline.name || lastEx?.name || '';
    const isCardio = !!(distRaw || target) || (lastEx && !inline.name ? !!lastEx.cardio : cardioByName(exName));
    // bieg / cardio: jeden wiersz = odcinek (× serie), dystans w „ciężarze”, cel w tempie / strefie, przerwa przy odcinku
    const groups: SetGroup[] = isCardio
      ? [{ type, sets: String(n), reps: cardioTime(reps), load: cleanDist(distRaw) || load!, rpe, ...(target ? { pace: target } : {}), ...(rest ? { rest } : {}) }]
      : Array.from({ length: n }, () => ({ type, sets: /[-–]/.test(sets) ? sets.replace('-', '–') : '1', reps, load: load!, rpe }));

    // bez nazwy albo ta sama nazwa co w wierszu wyżej — kolejne serie tego samego ćwiczenia
    let ex: PlanExercise | null = !inline.name || (lastEx && fold(lastEx.name) === fold(inline.name) && !label) ? lastEx : null;
    if (!ex) {
      if (!inline.name) {
        warnings.push(`Wiersz ${ri + 1}: brak nazwy ćwiczenia — pominięty.`);
        return;
      }
      ex = { id: uid(), name: inline.name, rest: '', notes: '', groups: [] };
      if (label && label.n && label.n > 1 && lastLabel?.letter === label.letter && k.exercises.length) ex.linked = true;
      k.exercises.push(ex);
      lastLabel = label ? { letter: label.letter } : null;
    }
    if (isCardio) ex.cardio = true;
    if (side) ex.perSide = true;
    ex.groups.push(...groups);
    if (rest && !ex.rest && !isCardio) ex.rest = rest;
    for (const nt of [notes, extraNote]) if (nt && !(ex.notes ?? '').split(' · ').includes(nt)) ex.notes = ex.notes ? `${ex.notes} · ${nt}` : nt;
    lastEx = ex;
  });

  // nazwy i dni treningów
  let defaulted = false;
  for (const w of weeks) {
    const unnamed = w.workouts.filter((k) => !k.name);
    unnamed.forEach((k) => (k.name = `Trening ${String.fromCharCode(65 + w.workouts.indexOf(k))}`));
    const spread = SPREAD[Math.min(7, w.workouts.length)] ?? [];
    w.workouts.forEach((k, i) => {
      if (!k.day && !k.date && spread[i]) {
        k.day = spread[i];
        defaulted = true;
      }
      for (const e of k.exercises) {
        if (!e.rest) delete e.rest;
        if (!e.notes) delete e.notes;
      }
    });
  }
  weeks.sort((a, b) => {
    const na = a.key.startsWith('#') ? Number(a.key.slice(1)) : NaN;
    const nb = b.key.startsWith('#') ? Number(b.key.slice(1)) : NaN;
    return Number.isNaN(na) || Number.isNaN(nb) ? 0 : na - nb;
  });
  if (defaulted) warnings.push('Dni tygodnia ustawione domyślnie (np. pon. i czw.) — popraw w edytorze, jeśli trzeba.');
  if (odd.length) warnings.push(`Ciężar nierozpoznany (${odd.slice(0, 3).map((x) => `„${x}”`).join(', ')}) — przeniesiony do uwag ćwiczenia.`);

  // daty wpisane wprost: start planu w tygodniu pierwszej daty
  const firstDate = weeks.flatMap((w) => w.workouts.map((k) => k.date).filter(Boolean) as string[]).sort()[0];
  const plan: Plan = {
    id: uid(),
    clientId: opts.clientId,
    name: opts.name?.trim() || 'Plan z arkusza',
    startDate: firstDate ? weekStart(firstDate) : opts.startDate,
    active: true,
    weeks: weeks.map(({ key: _k, ...w }) => w),
  };
  const stats = { weeks: plan.weeks.length, workouts: plan.weeks.reduce((a, w) => a + w.workouts.length, 0), exercises: plan.weeks.reduce((a, w) => a + w.workouts.reduce((b, k) => b + k.exercises.length, 0), 0), rows: dataRows };
  return { plan, warnings, stats };
}

/* ---------- eksport ---------- */

const WD = ['pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.', 'niedz.'];
const dec = (v: string | undefined) => String(v ?? '').replace(/(\d)\.(\d)/g, '$1,$2');
const csvCell = (v: string) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

const isCardioEx = (e: PlanExercise) => !!(e.cardio ?? cardioByName(e.name));

/** Czas biegu do arkusza: od 60 min jako „1:18:45” (h:mm:ss), krótszy bez zmian. */
function exportTime(reps: string): string {
  const d = parseDur(reps);
  if (d == null || d < 60) return reps;
  const sec = Math.round(d * 60);
  return `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

/** Dystans do arkusza: „800 m”, „10 km”, „8,5 km”. */
function exportDist(load: string): string {
  const km = parseKm(load);
  if (km == null) return dec(load);
  return km < 1 ? `${Math.round(km * 1000)} m` : `${dec(String(km))} km`;
}

/**
 * Plan → CSV (UTF-8 z BOM, średnik, przecinek dziesiętny) — wczytasz go z powrotem przez import. Plan z biegiem / cardio
 * ma dodatkowe kolumny „Dystans” i „Cel” (strefa / tempo); czas ≥ 60 min jako h:mm:ss. Na stronę — „8/str.”.
 */
export function planToCsv(plan: Plan): string {
  const anyCardio = plan.weeks.some((w) => w.workouts.some((k) => k.exercises.some((e) => e.name.trim() && isCardioEx(e))));
  const cols = anyCardio ? EXPORT_COLS : BASE_COLS;
  const lines: string[][] = [cols.map((f) => FIELD_LABEL[f])];
  for (const w of plan.weeks)
    for (const k of w.workouts) {
      const labels = exerciseLabels(k.exercises);
      const blocks = exerciseBlocks(k.exercises);
      k.exercises.forEach((e, ei) => {
        if (!e.name.trim()) return;
        const inBlock = blocks.some((b) => b.length > 1 && b.includes(ei));
        const name = inBlock ? `${labels[ei]} ${e.name}` : e.name;
        const cardio = isCardioEx(e);
        mergeGroups(structuredClone(e.groups)).forEach((g, gi) => {
          const side = e.perSide && g.reps.trim() && !splitSide(g.reps)[1] ? '/str.' : '';
          const row = [
            w.name,
            k.date ? dmy(k.date) : k.day ? WD[k.day - 1] : '',
            k.name,
            name,
            String(g.sets || 1),
            cardio ? exportTime(g.reps) : `${g.reps}${side}`,
            cardio ? '' : dec(g.load),
            dec(g.rpe),
            cardio ? g.rest || (gi === 0 ? e.rest || '' : '') : g.rest || e.rest || '',
            cardio ? (gi === 0 ? e.notes || '' : '') : gi === 0 ? [e.notes, g.pace ? `tempo ${g.pace}` : ''].filter(Boolean).join(' · ') : g.pace ? `tempo ${g.pace}` : '',
            g.type === 'Robocze' ? '' : g.type,
          ];
          if (anyCardio) row.push(cardio && g.load.trim() ? exportDist(g.load) : '', cardio ? g.pace || '' : '');
          lines.push(row);
        });
      });
    }
  return `\uFEFF${lines.map((l) => l.map(csvCell).join(';')).join('\r\n')}\r\n`;
}

/** Nazwa pliku: „plan-s-c-sila-i-moc.csv”. */
export function csvFileName(plan: Plan): string {
  return `plan-${fold(plan.name).replace(/%|@/g, '').trim().replace(/\s+/g, '-') || 'treningowy'}.csv`;
}
