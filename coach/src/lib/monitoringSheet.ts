import type { Client, TrainingSession } from '../domain';
import { addDays, todayISO, weekStart } from './dates';
import { loadStats, loadVsBaseline, sessionLoad, tonnage } from './load';
import { painLabel } from './painMap';
import { MUSCLES, MUSCLE_LABEL, setsByMuscle } from './progressMuscles';
import { longestRunFlag, runTotals } from './running';
import { e1rmHistory, exerciseE1 } from './strength';
import { readiness, readinessNorm, wellnessItems, wellnessTotal } from './wellness';
import type { XCell, XSheet, XStyle } from './xlsxWrite';

/**
 * Zakładki „Monitoring” arkusza Fitowa — jak w aplikacji, na dwóch poziomach:
 * - podstawowy: regularność, obciążenie wobec własnej średniej z 4 poprzednich tygodni, samopoczucie, ból, bieg;
 * - zaawansowany (przygotowanie motoryczne): ACWR i monotonia bez progów „ryzyka”, tonaż, serie na partię,
 *   samopoczucie pytanie po pytaniu, każdy trening i e1RM.
 */

export type MonitoringLevel = 'basic' | 'advanced';

const GRID = 'A6A6A6';
const box = (fill?: string, o: Partial<XStyle> = {}): XStyle => ({ fill, color: '000000', align: 'center', valign: 'center', bc: GRID, border: { l: 'thin', r: 'thin', t: 'thin', b: 'thin' }, ...o });
const S = {
  title: { bold: true, size: 14, align: 'left' } as XStyle,
  sub: { italic: true, size: 9, color: '595959', align: 'left', wrap: true } as XStyle,
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
const pctTxt = (p: number | null) => (p == null ? null : `${p >= 0 ? '+' : '−'}${Math.round(Math.abs(p) * 100)}%`);
/** Model monitorowania bólu: ≤2 bezpiecznie, 3–5 akceptowalnie, >5 zmień obciążenie. */
const painStyle = (v: number | null | undefined) => (v == null ? S.cell : v > 5 ? S.red : v >= 3 ? S.yellow : S.green);

export function monitoringSheet(client: Client, all: TrainingSession[], today: string = todayISO(), name = 'Monitoring', level: MonitoringLevel = 'basic'): XSheet {
  const adv = level === 'advanced';
  const sessions = [...all].sort((a, b) => a.date.localeCompare(b.date));
  const rows: XCell[][] = [];
  const merges: string[] = [];
  const W = adv ? 14 : 10;
  const lastCol = String.fromCharCode(64 + W);
  const section = (t: string) => {
    rows.push([]);
    rows.push(Array.from({ length: W }, (_x, i) => c(i === 0 ? t : null, S.section)));
    merges.push(`A${rows.length}:${lastCol}${rows.length}`);
  };
  const kpi = (k: string, v: string | number | null, sty?: XStyle, note?: string) => {
    rows.push([c(k, S.kpiKey), null, c(v, sty ?? S.cell), c(null, sty ?? S.cell), c(note ?? null, S.note)]);
    merges.push(`A${rows.length}:B${rows.length}`, `C${rows.length}:D${rows.length}`, `E${rows.length}:${lastCol}${rows.length}`);
  };
  rows.push([c(`${adv ? 'Monitoring zaawansowany' : 'Monitoring'} — ${client.name}`, S.title)]);
  rows.push([
    c(
      `Stan na ${d(today)}. Obciążenie = ocena trudności treningu (sRPE 1–10) × minuty (AU), porównane z własną średnią z 4 poprzednich tygodni — to opis zmiany, nie prognoza kontuzji.` +
        (adv ? ' ACWR i monotonia pokazane do analizy trendu, bez progów ryzyka (badania 2019–2026 ich nie potwierdziły).' : ''),
      S.sub,
    ),
  ]);
  merges.push(`A2:${lastCol}2`);

  const lb = loadVsBaseline(sessions, today);
  const st = loadStats(sessions, today);
  const pain7 = sessions.filter((s) => s.pain != null && s.date > addDays(today, -7)).map((s) => s.pain!);
  const painMax = pain7.length ? Math.max(...pain7) : null;
  const norm = readinessNorm(client.checkins, sessions, today);
  const lastCi = [...client.checkins].filter((x) => readiness(x) != null).sort((a, b) => b.date.localeCompare(a.date))[0];
  const lastWs = [...sessions].reverse().find((s) => readiness(s.wellness) != null);
  const lastR = lastCi && (!lastWs || lastCi.date >= lastWs.date) ? readiness(lastCi) : lastWs ? readiness(lastWs.wellness) : null;
  const lr = longestRunFlag(sessions, today);

  // ——— teraz ———
  section('Teraz');
  if (!adv) {
    const thisWeek = sessions.filter((s) => s.date >= weekStart(today)).length;
    kpi('Treningi w tym tygodniu', thisWeek);
    kpi('Obciążenie 7 dni (AU)', Math.round(lb.week), lb.pct != null && lb.pct >= 0.5 ? S.yellow : undefined, lb.pct != null ? `${pctTxt(lb.pct)} wobec średniej z 4 poprzednich tygodni (${Math.round(lb.base!)} AU)` : 'zbieram dane (3 tygodnie historii)');
    kpi('Samopoczucie (1–5)', r1(lastR), lastR != null && norm != null && lastR < norm - 0.5 ? S.yellow : undefined, norm != null ? `norma 28 dni: ${r1(norm)}` : 'zbieram dane');
    kpi('Ból (najwyższy z 7 dni)', painMax, painStyle(painMax), '0–2 bezpiecznie · 3–5 w porządku, jeśli rano wraca do normy · powyżej 5 zmień obciążenie');
    if (lr && lr.pct > 0.1) kpi('Najdłuższy bieg z 7 dni', `${r1(lr.km)} km`, lr.pct > 0.3 ? S.yellow : undefined, `${pctTxt(lr.pct)} wobec najdłuższego z 30 dni (${r1(lr.prevMax)} km)`);
  } else {
    kpi('Obciążenie 7 dni / średnia 4 tyg. (AU)', `${Math.round(lb.week)} / ${lb.base != null ? Math.round(lb.base) : '—'}`, undefined, lb.pct != null ? `${pctTxt(lb.pct)} (okresy bez nakładania)` : 'zbieram dane');
    kpi('ACWR (7 / 28 dni)', r1(st.acwr, 2), undefined, 'trend; 1,0 = jak zwykle');
    kpi('Obciążenie ostre / przewlekłe (AU)', `${Math.round(st.acute)} / ${Math.round(st.chronic)}`, undefined, '7 dni / średnia tygodniowa z 28 dni');
    kpi('Monotonia (7 dni)', r1(st.monotony, 2), undefined, 'Foster; przy 2–4 treningach w tygodniu mierzy głównie częstotliwość');
    kpi('Strain (7 dni)', st.strain != null ? Math.round(st.strain) : null, undefined, 'obciążenie × monotonia');
  }

  // ——— tygodnie ———
  section('Tygodnie');
  const weeksHead = adv
    ? ['Tydzień (od)', 'Treningi', 'Czas (min)', 'Obciążenie (AU)', 'Średnia 4 poprz. tyg.', 'Zmiana', 'ACWR', 'Monotonia', 'Tonaż (kg)', 'Bieg (km)', 'Śr. sRPE', 'Maks. ból', 'Śr. samopoczucie (1–5)', 'Gdzie bolało']
    : ['Tydzień (od)', 'Treningi', 'Obciążenie (AU)', 'Średnia 4 poprz. tyg.', 'Zmiana', 'Bieg (km)', 'Najdłuższy bieg (km)', 'Maks. ból', 'Śr. samopoczucie (1–5)', 'Gdzie bolało'];
  rows.push(weeksHead.map((h) => c(h, S.head)));
  const first = sessions[0]?.date;
  const weekLoads: number[] = [];
  if (first) {
    for (let w = weekStart(first); w <= weekStart(today); w = addDays(w, 7)) {
      const end = addDays(w, 6);
      const ss = sessions.filter((s) => s.date >= w && s.date <= end);
      const load = ss.reduce((a, s) => a + (sessionLoad(s) ?? 0), 0);
      const prev = weekLoads.slice(-4);
      const base = prev.length >= 3 ? avg(prev) : null;
      weekLoads.push(load);
      const ch = base && base > 0 ? load / base - 1 : null;
      const km = ss.reduce((a, s) => a + (runTotals(s, true)?.km ?? 0), 0);
      const longest = Math.max(0, ...ss.map((s) => runTotals(s, true)?.km ?? 0));
      const pains = ss.map((s) => s.pain).filter((x): x is number => x != null);
      const pmax = pains.length ? Math.max(...pains) : null;
      const ready = [...client.checkins.filter((x) => x.date >= w && x.date <= end).map((x) => readiness(x)), ...ss.map((s) => readiness(s.wellness))].filter((x): x is number => x != null);
      const spots = [...new Set(ss.flatMap((s) => (s.painMap ?? []).filter((p) => p.level > 0).map((p) => painLabel(p))))].join(', ');
      const chCell = c(pctTxt(ch), ch != null && ch >= 0.5 ? S.yellow : S.cell);
      if (adv) {
        const at = end < today ? end : today;
        const ls = loadStats(sessions, at);
        rows.push([
          c(d(w), S.left),
          c(ss.length, S.cell),
          c(ss.reduce((a, s) => a + (s.duration ?? 0), 0) || null, S.cell),
          c(load ? Math.round(load) : null, S.cell),
          c(base != null ? Math.round(base) : null, S.cell),
          chCell,
          c(r1(ls.acwr, 2), S.cell),
          c(r1(ls.monotony, 2), S.cell),
          c(Math.round(ss.reduce((a, s) => a + tonnage(s), 0)) || null, S.cell),
          c(km ? r1(km) : null, S.cell),
          c(r1(avg(ss.map((s) => s.srpe).filter((x): x is number => x != null))), S.cell),
          c(pmax, painStyle(pmax)),
          c(r1(avg(ready)), S.cell),
          c(spots || null, S.note),
        ]);
      } else {
        rows.push([
          c(d(w), S.left),
          c(ss.length, S.cell),
          c(load ? Math.round(load) : null, S.cell),
          c(base != null ? Math.round(base) : null, S.cell),
          chCell,
          c(km ? r1(km) : null, S.cell),
          c(longest ? r1(longest) : null, S.cell),
          c(pmax, painStyle(pmax)),
          c(r1(avg(ready)), S.cell),
          c(spots || null, S.note),
        ]);
      }
    }
  }

  // ——— treningi ———
  section('Treningi');
  rows.push(
    (adv
      ? ['Data', 'Trening', 'Z trenerem', 'Czas (min)', 'sRPE', 'Obciążenie (AU)', 'Tonaż (kg)', 'Bieg (km)', 'Ból (0–10)', 'Gdzie boli', 'Wellness (/25)', 'Sen (h)', 'Tętno spocz.', 'Notatki']
      : ['Data', 'Trening', 'Czas (min)', 'sRPE', 'Obciążenie (AU)', 'Bieg (km)', 'Ból (0–10)', 'Gdzie boli', 'Samopoczucie (1–5)', 'Notatki']
    ).map((h) => c(h, S.head)),
  );
  for (const s of [...sessions].reverse()) {
    const load = sessionLoad(s);
    const km = runTotals(s, true)?.km;
    const spots = (s.painMap ?? []).filter((p) => p.level > 0).map((p) => `${painLabel(p)} ${p.level}`).join(', ') || null;
    const notes = [s.stoppedForPain ? `przerwany przez ból (${s.stoppedForPain.level}/10)` : '', s.notes].filter(Boolean).join(' · ') || null;
    rows.push(
      adv
        ? [
            c(d(s.date), S.left),
            c(s.workoutName || 'Trening', S.left),
            c(s.solo === false ? 'tak' : s.solo ? 'nie' : null, S.cell),
            c(s.duration ?? null, S.cell),
            c(s.srpe ?? null, S.cell),
            c(load != null ? Math.round(load) : null, S.cell),
            c(Math.round(tonnage(s)) || null, S.cell),
            c(km ? r1(km, 2) : null, S.cell),
            c(s.pain ?? null, painStyle(s.pain)),
            c(spots, S.note),
            c(wellnessTotal(s.wellness), S.cell),
            c(s.sleepH ?? null, S.cell),
            c(s.rhr ?? null, S.cell),
            c(notes, S.note),
          ]
        : [
            c(d(s.date), S.left),
            c(s.workoutName || 'Trening', S.left),
            c(s.duration ?? null, S.cell),
            c(s.srpe ?? null, S.cell),
            c(load != null ? Math.round(load) : null, S.cell),
            c(km ? r1(km, 2) : null, S.cell),
            c(s.pain ?? null, painStyle(s.pain)),
            c(spots, S.note),
            c(r1(readiness(s.wellness)), S.cell),
            c(notes, S.note),
          ],
    );
  }

  if (adv) {
    // ——— samopoczucie pytanie po pytaniu ———
    section('Samopoczucie pytanie po pytaniu (1–5)');
    rows.push(['Pytanie', null, 'Ostatnie 7 dni', 'Norma 28 dni', 'Zmiana'].map((h) => c(h, S.head)));
    merges.push(`A${rows.length}:B${rows.length}`);
    for (const it of wellnessItems(client.checkins, sessions, today)) {
      const diff = it.now != null && it.norm != null && it.n >= 8 ? it.now - it.norm : null;
      rows.push([c(it.label, S.left), null, c(r1(it.now), S.cell), c(r1(it.norm), S.cell), c(diff != null ? r1(diff) : it.n < 8 ? 'zbieram dane' : null, diff != null && diff <= -0.75 ? S.yellow : S.cell)]);
      merges.push(`A${rows.length}:B${rows.length}`);
    }

    // ——— serie na partię ———
    section('Ciężkie serie na partię mięśniową (główne 1, pomocnicze ½)');
    rows.push(['Partia', null, 'Ten tydzień', 'Poprzedni', 'Średnio 4 tyg.'].map((h) => c(h, S.head)));
    merges.push(`A${rows.length}:B${rows.length}`);
    const w0 = weekStart(today);
    const now = setsByMuscle(sessions.filter((s) => s.date >= w0 && s.date <= today));
    const prev = setsByMuscle(sessions.filter((s) => s.date >= addDays(w0, -7) && s.date < w0));
    const four = setsByMuscle(sessions.filter((s) => s.date >= addDays(w0, -28) && s.date < w0));
    for (const m of MUSCLES) {
      rows.push([c(MUSCLE_LABEL[m], S.left), null, c(r1(now[m]), S.cell), c(r1(prev[m]), S.cell), c(r1(four[m] / 4), S.cell)]);
      merges.push(`A${rows.length}:B${rows.length}`);
    }

    // ——— siła ———
    const names = [...new Set(sessions.flatMap((s) => s.exercises.filter((e) => exerciseE1(e) != null).map((e) => e.name)))];
    if (names.length) {
      section('Siła: szacowane 1RM (e1RM, najdokładniejsze z serii do ok. 10 powtórzeń)');
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
  }

  const widths = adv ? [12, 22, 11, 11, 11, 9, 8, 10, 10, 9, 9, 9, 12, 32] : [12, 24, 11, 11, 10, 9, 11, 9, 12, 32];
  return { name, rows, merges, widths, landscape: true, fitWidth: true, noGrid: true, freezeCols: 1 };
}
