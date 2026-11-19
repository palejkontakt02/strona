import { readTemplate } from './planTemplate';
import { FIELD_LABEL, fold, type SheetField } from './sheetImport';

/**
 * Układy arkuszy trenera, które nie są płaską tabelą „wiersz = seria”, zamieniane na tę tabelę
 * (kolumny jak w eksporcie: Tydzień, Dzień, Trening, Ćwiczenie, Serie, Powt., Ciężar, RPE, Przerwa, Uwagi):
 *
 * - „bloki”: w jednym arkuszu nagłówki „TYDZIEŃ 1 · DZIEŃ 2 · ZARZUT I PODRZUT (budowa)”, pod nimi tabela
 *   Ćwiczenie | Serie | Powt. | % 1RM | RPE cel | kg orient. | Przerwa | (Seria 1 KG/REP/RPE …) | Notatki;
 * - „tygodnie obok siebie”: arkusz = jednostka (np. „Poniedziałek – góra”), wiersz nagłówka „Tydzień 1”, „Tydzień 2”…
 *   nad kolumnami Zalecenie | Ciężar | Powt. | RPE; w „Zaleceniu” zapis „3×6–8/nogę ⏎ 2×6 kg ⏎ RPE 7”.
 *
 * Kolumny wykonania (KG / REP / RPE wpisane przez podopiecznego) są pomijane — to plan, nie zapis treningu.
 */

export interface LayoutSheet {
  name: string;
  rows: string[][];
}
export interface LayoutResult {
  rows: string[][];
  /** Opis rozpoznanego układu (do pokazania trenerowi). */
  info: string;
  warnings: string[];
  /** Nazwa planu i start (rrrr-mm-dd) z pól szablonu, jeśli są. */
  name?: string;
  start?: string;
}

const OUT: SheetField[] = ['week', 'day', 'workout', 'exercise', 'sets', 'reps', 'load', 'rpe', 'rest', 'notes'];
const HEAD = OUT.map((f) => FIELD_LABEL[f]);
type Row = Record<(typeof OUT)[number], string>;
const line = (r: Partial<Row>) => OUT.map((f) => (r[f] ?? '').trim());

const cell = (r: string[] | undefined, i: number) => (i >= 0 && r ? (r[i] ?? '').trim() : '');
/** „0.65” (Excel) / „65%” (Arkusze) / „65” → „65”. */
function pctText(v: string): string {
  const t = v.replace('%', '').replace(',', '.').trim();
  if (!t || !/^\d+(\.\d+)?$/.test(t)) return '';
  const n = Number(t);
  return String(Math.round((n <= 3 && !v.includes('%') ? n * 100 : n) * 10) / 10);
}
const kgText = (v: string) => {
  const t = v.replace(',', '.').trim();
  return /^\d+(\.\d+)?$/.test(t) ? String(Math.round(Number(t) * 100) / 100) : v.trim();
};
/** „RWANIE” → „Rwanie”, „TEST: RWANIE + PODRZUT (jak zawody)” → „Test: rwanie + podrzut (jak zawody)”. */
function sentence(v: string): string {
  const t = v.trim();
  if (t !== t.toUpperCase()) {
    // „TECHNIKA (lekko)”: wielkie litery poza nawiasem
    const out = t.replace(/^[^(]+/, (m) => (m === m.toUpperCase() ? m.toLowerCase() : m));
    return out.charAt(0).toUpperCase() + out.slice(1);
  }
  const low = t.toLowerCase();
  return low.charAt(0).toUpperCase() + low.slice(1);
}
/** Uwagi bez instrukcji do wypełniania arkusza („W REP wpisz 2”). */
/** „A1. Przysiad” / „E1  Good morning” → „A1 Przysiad” (superseria rozpoznawana po oznaczeniu). */
const exName = (v: string) => v.trim().replace(/^([A-Z]\d)[.)]?\s+/, '$1 ');
const cleanNote = (v: string) =>
  v
    .replace(/\s*W REP wpisz[^.]*\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*\.$/, '');

// ——— układ „bloki” ———

const BLOCK = /^\s*TYDZIE[ŃN]\s*(\d+)\s*[·•|,:–—-]\s*DZIE[ŃN]\s*(\d+)\s*(?:[·•|,:–—-]\s*(.*))?$/i;

function blockLayout(sheets: LayoutSheet[]): LayoutResult | null {
  const sheet = sheets.find((s) => s.rows.filter((r) => BLOCK.test(cell(r, 0))).length >= 2);
  if (!sheet) return null;
  // nazwy jednostek z arkusza „Treningi” (Tydzień | Dzień | … | Trening), jeśli jest
  const names = new Map<string, string>();
  for (const s of sheets) {
    const h = s.rows.findIndex((r) => r.some((c) => fold(c) === 'trening') && r.some((c) => fold(c) === 'tydzien') && r.some((c) => fold(c) === 'dzien'));
    if (h < 0) continue;
    const head = s.rows[h].map(fold);
    const [wi, di, ti] = [head.indexOf('tydzien'), head.indexOf('dzien'), head.indexOf('trening')];
    for (const r of s.rows.slice(h + 1)) if (cell(r, wi) && cell(r, ti)) names.set(`${Number(cell(r, wi))}.${Number(cell(r, di))}`, cell(r, ti));
  }
  const out: string[][] = [HEAD];
  const warnings: string[] = [];
  let cur: { week: string; workout: string } | null = null;
  let col: Record<'ex' | 'sets' | 'reps' | 'pct' | 'rpe' | 'kg' | 'rest' | 'notes', number> | null = null;
  const weeks = new Set<string>();
  let units = 0;
  for (const r of sheet.rows) {
    const a = cell(r, 0);
    const m = a.match(BLOCK);
    if (m) {
      const [w, d] = [Number(m[1]), Number(m[2])];
      let title = (m[3] ?? '').trim();
      // faza w ostatnim nawiasie: „RWANIE  (budowa)”, „… (deload)”, „… (TEST)”
      const ph = title.match(/\s*\(([^()]*)\)\s*$/);
      const phase = ph && /budowa|deload|test|intens|akumul|realiz|odci|taper|peak/i.test(ph[1]) ? ph[1].trim() : '';
      if (phase) title = title.slice(0, ph!.index).trim();
      const fromList = names.get(`${w}.${d}`)?.replace(/\s*\((deload|test)\)\s*$/i, '');
      const tag = /deload|odci/i.test(phase) ? ' (deload)' : /test/i.test(phase) ? ' (test)' : '';
      cur = { week: `Tydzień ${w}${tag}`, workout: fromList || sentence(title) || `Dzień ${d}` };
      weeks.add(cur.week);
      units++;
      col = null;
      continue;
    }
    if (!cur) continue;
    if (fold(a) === 'cwiczenie') {
      const h = r.map(fold);
      const find = (re: RegExp) => h.findIndex((x) => re.test(x));
      col = {
        ex: 0,
        sets: find(/^serie$/),
        reps: find(/^powt/),
        pct: find(/1 ?rm|^%$/),
        rpe: find(/^rpe/),
        kg: find(/^kg|ciezar|obciaz/),
        rest: find(/^przerwa/),
        notes: find(/^(notatki|uwagi|technika)/),
      };
      continue;
    }
    if (!col || !a || !cell(r, col.sets)) continue;
    const pct = pctText(cell(r, col.pct));
    const kg = kgText(cell(r, col.kg));
    let reps = cell(r, col.reps);
    let notes = cleanNote(cell(r, col.notes));
    const side = notes.match(/^(\d+\s*)?\/\s*str\.?\s*/i) ?? notes.match(/^\d+\s*na stron[eę]\.?\s*/i);
    if (side) {
      reps = `${reps}/str.`;
      notes = notes.slice(side[0].length).trim();
    }
    let rpe = cell(r, col.rpe).replace(',', '.');
    if (/^max/i.test(rpe)) {
      rpe = '';
      notes = [notes, 'RPE: maks dnia'].filter(Boolean).join('. ');
    }
    if (pct && kg) notes = [`${pct}% 1RM`, notes].filter(Boolean).join('. ');
    const rest = cell(r, col.rest);
    out.push(line({ week: cur.week, workout: cur.workout, exercise: exName(a), sets: cell(r, col.sets), reps, load: kg || (pct ? `${pct}%` : ''), rpe, rest: /^[—–-]$/.test(rest) ? '' : rest, notes }));
  }
  if (out.length < 2) return null;
  if (![...out.slice(1)].some((r) => r[1])) warnings.push('Arkusz ma „dzień 1/2/3” bez dni tygodnia. Dni ustawione domyślnie, popraw je w edytorze.');
  return { rows: out, info: `Układ „bloki” z arkusza „${sheet.name}”: ${weeks.size} ${weeks.size === 1 ? 'tydzień' : weeks.size < 5 ? 'tygodnie' : 'tygodni'}, ${units} jednostek. Ciężar: kg orientacyjne (% 1RM w uwagach).`, warnings };
}

// ——— układ „tygodnie obok siebie” ———

/** „3×6–8/nogę”, „3×8, pauza 2 s na górze”, „3×3 (4–5 s)” → serie, powtórzenia, dopisek. */
function parseDose(v: string): { sets: string; reps: string; note: string } | null {
  const m = v.trim().match(/^(\d+(?:\s*[-–]\s*\d+)?)\s*[×x*]\s*(.+)$/i);
  if (!m) return null;
  let rest = m[2].trim();
  const notes: string[] = [];
  // „(4–5 s)” — czas opuszczania / pauzy
  rest = rest.replace(/\s*\(([^)]*)\)\s*/g, (_, x: string) => {
    notes.push(x.trim());
    return ' ';
  });
  const comma = rest.indexOf(',');
  if (comma > 0) {
    notes.push(rest.slice(comma + 1).trim());
    rest = rest.slice(0, comma);
  }
  const reps = rest
    .trim()
    .replace(/\s*\/\s*(nog[eęa]|rękę|reke|stron[eę]|str\.?)\s*$/i, '/str.')
    .replace(/\s+/g, ' ');
  return { sets: m[1].replace(/\s/g, '').replace('-', '–'), reps, note: notes.filter(Boolean).join('; ') };
}

/** Linia ciężaru zalecenia: „2×6 kg” (2 hantle po 6), „8–10 kg/rękę”, „piłka 3–4 kg”, „15→17,5 kg”, „masa ciała”. */
function parseLoadLine(v: string): { load: string; note: string } {
  let t = v.trim();
  if (/masa cia[łl]a|^bw$/i.test(t)) return { load: '', note: '' };
  let note = '';
  const what = t.match(/^([a-ząćęłńóśźż ]+?)\s+(?=\d)/i);
  if (what) {
    note = what[1].trim();
    t = t.slice(what[0].length);
  }
  const two = t.match(/^2\s*[×x]\s*(.+)$/i);
  if (two) t = `${two[1].trim()}/rękę`;
  return { load: t.replace(/\s*→\s*/, '–'), note };
}

const isRpeLine = (v: string) => /^rpe\b/i.test(v.trim());
const isLoadLine = (v: string) => /kg|masa cia|^bw$|%/i.test(v);

function weeksLayout(sheets: LayoutSheet[]): LayoutResult | null {
  // wiersze zbierane tydzień po tygodniu (w arkuszu tygodnie są obok siebie, w tabeli importu — jeden po drugim)
  const byWeek = new Map<string, string[][]>();
  const push = (week: string, r: string[]) => (byWeek.get(week) ?? byWeek.set(week, []).get(week)!).push(r);
  const used: string[] = [];
  const warnings: string[] = [];
  let weekCount = 0;
  for (const s of sheets) {
    const rows = s.rows;
    const hi = rows.findIndex((r) => r.some((c) => fold(c) === 'cwiczenie') && r.filter((c) => fold(c) === 'zalecenie').length >= 1);
    if (hi < 1) continue;
    const head = rows[hi].map(fold);
    // wiersz z „Tydzień N” nad nagłówkiem (albo w nim)
    const wrow = [rows[hi - 1], rows[hi]].find((r) => r.some((c) => /^tydzien\s*\d+/.test(fold(c))));
    if (!wrow) continue;
    const zal = head.map((x, i) => (x === 'zalecenie' ? i : -1)).filter((i) => i >= 0);
    const weeks = zal.map((zi) => {
      // nazwa tygodnia: najbliższa „Tydzień N” na lewo od kolumny (scalona komórka nad grupą kolumn)
      let wi = zi;
      while (wi >= 0 && !/^tydzien\s*\d+/.test(fold(wrow[wi] ?? ''))) wi--;
      return { zi, name: (wrow[Math.max(0, wi)] ?? '').trim().replace(/\s+/g, ' ') };
    });
    const exI = head.indexOf('cwiczenie');
    const notesI = head.findIndex((x) => /^(technika|uwagi|notatki)/.test(x));
    const workout = s.name.trim() || cell(rows[0], 0);
    const title = rows.slice(0, hi).map((r) => r.join(' ')).join(' ');
    // dzień tygodnia z nazwy arkusza / tytułu („poniedziałek”)
    const dayWord = (`${s.name} ${title}`.match(/poniedzia[łl]ek|wtorek|[śs]roda|czwartek|pi[ąa]tek|sobota|niedziela/i) ?? [''])[0];
    let found = false;
    for (let ri = hi + 1; ri < rows.length; ri++) {
      const r = rows[ri];
      const ex = cell(r, exI);
      if (!ex) continue;
      // legenda pod tabelą („RPE | Skala RPE…”) — koniec planu
      if (/^skala rpe/i.test(ex)) break;
      for (const w of weeks) {
        const z = cell(r, w.zi);
        if (!z) continue;
        const parts = z.split(/\n+/).map((x) => x.trim()).filter(Boolean);
        const dose = parseDose(parts[0] ?? '');
        if (!dose) continue;
        const loadLine = parts.slice(1).find((x) => isLoadLine(x) && !isRpeLine(x));
        const rpeLine = parts.find(isRpeLine);
        const ld = loadLine ? parseLoadLine(loadLine) : { load: '', note: '' };
        const rpe = (rpeLine ?? '').replace(/^rpe\s*/i, '').replace(',', '.').trim();
        const tech = cleanNote(cell(r, notesI));
        // dopisek z zalecenia („(4–5 s)”) pomijany, gdy już jest w uwagach
        const extra = dose.note && !fold(tech).includes(fold(dose.note)) ? dose.note.charAt(0).toUpperCase() + dose.note.slice(1) : '';
        const notes = [tech, extra, ld.note].filter(Boolean).join('. ');
        // „przerwa 60 s po rundzie” w uwagach → przerwa ćwiczenia
        const pr = tech.match(/przerwa\s+(\d+(?:[.,]\d+)?)\s*(s|sek|min)/i);
        const rest = pr ? (/^min/i.test(pr[2]) ? `${pr[1].replace(',', '.')}:00` : pr[1]) : '';
        const base = { week: w.name, day: dayWord, workout, exercise: exName(ex), reps: dose.reps, load: ld.load, rest };
        // „RPE 7→8”: pierwsza połowa serii na 7, druga na 8
        const arrow = rpe.match(/^(\d+(?:\.\d+)?)\s*(?:→|->)\s*(\d+(?:\.\d+)?)$/);
        const n = Number(dose.sets);
        if (arrow && Number.isInteger(n) && n >= 2) {
          const first = Math.floor(n / 2);
          push(w.name, line({ ...base, sets: String(first), rpe: arrow[1], notes }));
          push(w.name, line({ ...base, sets: String(n - first), rpe: arrow[2] }));
        } else push(w.name, line({ ...base, sets: dose.sets, rpe: rpe.replace(/\s*(?:→|->)\s*/, '–'), notes }));
        found = true;
      }
    }
    if (found) {
      used.push(s.name);
      weekCount = Math.max(weekCount, weeks.length);
    }
  }
  const out: string[][] = [HEAD, ...[...byWeek.values()].flat()];
  if (out.length < 2) return null;
  // tygodnie, w których zaleceń jest wyraźnie mniej niż w pierwszym
  const exs = new Map<string, Set<string>>();
  for (const r of out.slice(1)) (exs.get(r[0]) ?? exs.set(r[0], new Set()).get(r[0])!).add(r[3]);
  const per = new Map([...exs].map(([w, x]) => [w, x.size]));
  const max = Math.max(...per.values());
  for (const [w, n] of per) if (n < max / 2) warnings.push(`${w}: wypełnione tylko ${n} z ${max} pozycji. Uzupełnij w edytorze albo usuń tydzień.`);
  return { rows: out, info: `Układ „tygodnie obok siebie”: ${used.map((x) => `„${x}”`).join(', ')}, ${weekCount} tyg. Kolumny wykonania (Ciężar / Powt. / RPE) pominięte.`, warnings };
}

/** Rozpoznany układ trenera → płaska tabela do importu; null — zwykła tabela (bez zmian). */
export function normalizeLayout(sheets: LayoutSheet[]): LayoutResult | null {
  return readTemplate(sheets) ?? blockLayout(sheets) ?? weeksLayout(sheets);
}
