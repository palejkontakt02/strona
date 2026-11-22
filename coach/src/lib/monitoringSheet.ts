import type { Client, TrainingSession } from '../domain';
import { addDays, todayISO, weekStart } from './dates';
import { acwrZone, loadStats, sessionLoad, tonnage } from './load';
import { painLabel } from './painMap';
import { runTotals } from './running';
import { e1rmHistory, exerciseE1 } from './strength';
import { readiness, wellnessTotal } from './wellness';
import type { XCell, XSheet, XStyle } from './xlsxWrite';

/**
 * Zakładka „Monitoring” arkusza Fitowa: to samo co zakładka Monitoring w aplikacji, w tabelach —
 * wskaźniki na dziś, tygodnie (obciążenie, ACWR, tonaż, km, ból, wellness), każdy trening i najlepsze e1RM.
 */

const GRID = 'A6A6A6';
const box = (fill?: string, o: Partial<XStyle> = {}): XStyle => ({ fill, color: '000000', align: 'center', valign: 'center', bc: GRID, border: { l: 'thin', r: 'thin', t: 'thin', b: 'thin' }, ...o });
const S = {
  title: { bold: true, size: 14, align: 'left' } as XStyle,
  sub: { italic: true, size: 9, color: '595959', align: 'left' } as XStyle,
  section: box('404040', { bold: true, color: 'FFFFFF', align: 'left', indent: 1 }),
  head: box('9FC5E8', { bold: true, wrap: true }),
  kpiKey: box('F3F3F3', { bold: true, align: 'left', indent: 1 }),
  cell: box('FFFFFF'),
  left: box('FFFFFF', { align: 'left', indent: 1, wrap: true }),
  note: box('FFFFFF', { align: 'left', wrap: true, size: 9 }),
  green: box('D9EAD3'),
  yellow: box('FFF2CC'),
  red: box('F4CCCC'),
};
const c = (v: string | number | null | undefined, st: XStyle): XCell => ({ v: v === '' || v == null ? null : v, st });
const d = (iso: string) => iso.split('-').reverse().join('.');
const r1 = (v: number | null | undefined, k = 1) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** k) / 10 ** k);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const zoneStyle = (a: number | null) => {
  const z = acwrZone(a).level;
  return z === 'red' ? S.red : z === 'yellow' ? S.yellow : z === 'green' ? S.green : S.cell;
};

export function monitoringSheet(client: Client, all: TrainingSession[], today: string = todayISO(), name = 'Monitoring'): XSheet {
  const sessions = [...all].sort((a, b) => a.date.localeCompare(b.date));
  const rows: XCell[][] = [];
  const merges: string[] = [];
  const W = 14;
  const section = (t: string) => {
    rows.push([]);
    rows.push(Array.from({ length: W }, (_x, i) => c(i === 0 ? t : null, S.section)));
    merges.push(`A${rows.length}:N${rows.length}`);
  };
  rows.push([c(`Monitoring — ${client.name}`, S.title)]);
  rows.push([c(`Stan na ${d(today)}. Obciążenie = sRPE × minuty (AU). ACWR = obciążenie z 7 dni / średnia tygodniowa z 28 dni (0,8–1,3 optymalnie, powyżej 1,5 ryzyko przeciążenia).`, S.sub)]);
  merges.push(`A2:N2`);

  // ——— dziś ———
  const st = loadStats(sessions, today);
  section('Teraz');
  const kpi: [string, string | number | null, XStyle?][] = [
    ['ACWR', r1(st.acwr, 2), zoneStyle(st.acwr)],
    ['Strefa', acwrZone(st.acwr).label],
    ['Obciążenie 7 dni (AU)', Math.round(st.acute)],
    ['Średnia tygodniowa z 28 dni (AU)', Math.round(st.chronic)],
    ['Monotonia (7 dni)', r1(st.monotony, 2), st.monotony != null && st.monotony > 2 ? S.yellow : undefined],
    ['Strain', st.strain != null ? Math.round(st.strain) : null],
  ];
  for (const [k, v, sty] of kpi) {
    rows.push([c(k, S.kpiKey), null, c(v, sty ?? S.cell), c(null, sty ?? S.cell)]);
    merges.push(`A${rows.length}:B${rows.length}`, `C${rows.length}:D${rows.length}`);
  }

  // ——— tygodnie ———
  section('Tygodnie');
  rows.push(['Tydzień (od)', 'Treningi', 'Czas (min)', 'Obciążenie (AU)', 'ACWR', 'Strefa', 'Monotonia', 'Tonaż (kg)', 'Bieg (km)', 'Śr. sRPE', 'Maks. ból', 'Śr. wellness (/25)', 'Gotowość (/5)', 'Gdzie bolało'].map((h) => c(h, S.head)));
  const first = sessions[0]?.date;
  if (first) {
    for (let w = weekStart(first); w <= weekStart(today); w = addDays(w, 7)) {
      const end = addDays(w, 6);
      const ss = sessions.filter((s) => s.date >= w && s.date <= end);
      const at = end < today ? end : today;
      const ls = loadStats(sessions, at);
      const load = ss.reduce((a, s) => a + (sessionLoad(s) ?? 0), 0);
      const ton = ss.reduce((a, s) => a + tonnage(s), 0);
      const km = ss.reduce((a, s) => a + (runTotals(s, true)?.km ?? 0), 0);
      const pains = ss.map((s) => s.pain).filter((x): x is number => x != null);
      const well = ss.map((s) => wellnessTotal(s.wellness)).filter((x): x is number => x != null);
      const ready = client.checkins.filter((x) => x.date >= w && x.date <= end).map((x) => readiness(x)).filter((x): x is number => x != null);
      const spots = [...new Set(ss.flatMap((s) => (s.painMap ?? []).filter((p) => p.level > 0).map((p) => painLabel(p))))].join(', ');
      rows.push([
        c(d(w), S.left),
        c(ss.length, S.cell),
        c(ss.reduce((a, s) => a + (s.duration ?? 0), 0) || null, S.cell),
        c(load ? Math.round(load) : null, S.cell),
        c(r1(ls.acwr, 2), zoneStyle(ls.acwr)),
        c(ls.acwr != null ? acwrZone(ls.acwr).label : null, S.note),
        c(r1(ls.monotony, 2), ls.monotony != null && ls.monotony > 2 ? S.yellow : S.cell),
        c(ton ? Math.round(ton) : null, S.cell),
        c(km ? r1(km) : null, S.cell),
        c(r1(avg(ss.map((s) => s.srpe).filter((x): x is number => x != null))), S.cell),
        c(pains.length ? Math.max(...pains) : null, pains.length && Math.max(...pains) >= 4 ? S.red : S.cell),
        c(r1(avg(well)), S.cell),
        c(r1(avg(ready)), S.cell),
        c(spots || null, S.note),
      ]);
    }
  }

  // ——— treningi ———
  section('Treningi');
  rows.push(['Data', 'Trening', 'Z trenerem', 'Czas (min)', 'sRPE', 'Obciążenie (AU)', 'Tonaż (kg)', 'Bieg (km)', 'Ból (0–10)', 'Gdzie boli', 'Wellness (/25)', 'Sen (h)', 'Tętno spocz.', 'Notatki'].map((h) => c(h, S.head)));
  for (const s of [...sessions].reverse()) {
    const load = sessionLoad(s);
    const ton = tonnage(s);
    const km = runTotals(s, true)?.km;
    rows.push([
      c(d(s.date), S.left),
      c(s.workoutName || 'Trening', S.left),
      c(s.solo === false ? 'tak' : s.solo ? 'nie' : null, S.cell),
      c(s.duration ?? null, S.cell),
      c(s.srpe ?? null, S.cell),
      c(load != null ? Math.round(load) : null, S.cell),
      c(ton ? Math.round(ton) : null, S.cell),
      c(km ? r1(km, 2) : null, S.cell),
      c(s.pain ?? null, s.pain != null && s.pain >= 4 ? S.red : S.cell),
      c((s.painMap ?? []).filter((p) => p.level > 0).map((p) => `${painLabel(p)} ${p.level}`).join(', ') || null, S.note),
      c(wellnessTotal(s.wellness), S.cell),
      c(s.sleepH ?? null, S.cell),
      c(s.rhr ?? null, S.cell),
      c([s.stoppedForPain ? `przerwany przez ból (${s.stoppedForPain.level}/10)` : '', s.notes].filter(Boolean).join(' · ') || null, S.note),
    ]);
  }

  // ——— siła ———
  const names = [...new Set(sessions.flatMap((s) => s.exercises.filter((e) => exerciseE1(e) != null).map((e) => e.name)))];
  if (names.length) {
    section('Siła: najlepsze szacowane 1RM (e1RM)');
    rows.push(['Ćwiczenie', null, 'Najlepsze e1RM (kg)', 'Seria', 'Data', 'Ostatnie e1RM (kg)', 'Data ost.', 'Zmiana (kg)'].map((h) => c(h, S.head)));
    merges.push(`A${rows.length}:B${rows.length}`);
    const list = names
      .map((n) => ({ n, h: e1rmHistory(sessions, n) }))
      .filter((x) => x.h.length)
      .map((x) => ({ ...x, best: x.h.reduce((a, b) => (b.e1 > a.e1 ? b : a)), last: x.h[x.h.length - 1], firstE: x.h[0].e1 }))
      .sort((a, b) => b.h.length - a.h.length);
    for (const x of list) {
      rows.push([
        c(x.n, S.left),
        null,
        c(r1(x.best.e1), S.cell),
        c(`${String(x.best.load).replace('.', ',')} × ${x.best.reps}`, S.cell),
        c(d(x.best.date), S.cell),
        c(r1(x.last.e1), S.cell),
        c(d(x.last.date), S.cell),
        c(x.h.length > 1 ? r1(x.last.e1 - x.firstE) : null, S.cell),
      ]);
      merges.push(`A${rows.length}:B${rows.length}`);
    }
  }

  return { name, rows, merges, widths: [12, 22, 11, 11, 8, 14, 10, 10, 9, 18, 11, 9, 10, 36], landscape: true, fitWidth: true, noGrid: true, freezeCols: 1 };
}
