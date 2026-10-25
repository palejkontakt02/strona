/**
 * Postępy podopiecznego: podsumowanie miesiąca i kamienie milowe.
 * Tonaż — lib/load.ts (tonnage), km — lib/running.ts (runTotals), rekordy — lib/strength.ts (records).
 * Czyste funkcje, testy w progress.test.ts.
 */
import type { ISODate, TrainingSession, YearMonth } from '../domain';
import { plural } from '../format';
import { addDays, weekStart } from './dates';
import { streak, tonnage } from './load';
import { runTotals } from './running';
import { records, type PersonalRecord } from './strength';

/* ---------- miesiąc ---------- */

/** „2026-10” przesunięte o `n` miesięcy. */
export function shiftMonth(ym: YearMonth, n: number): YearMonth {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

const kmOf = (s: TrainingSession) => runTotals(s, true)?.km ?? 0;

export interface MonthSummary {
  month: YearMonth;
  sessions: number;
  /** kg */
  tonnage: number;
  /** km biegu / marszu (bez roweru, wioślarza…). */
  km: number;
  /** Rekordy (e1RM) z miesiąca — po jednym na ćwiczenie (najwyższy), od największego wzrostu. */
  records: PersonalRecord[];
}

export function monthSummary(sessions: TrainingSession[], month: YearMonth, allRecords: PersonalRecord[] = records(sessions)): MonthSummary {
  const ms = sessions.filter((s) => s.date.startsWith(month));
  const best = new Map<string, PersonalRecord>();
  for (const r of allRecords) {
    if (!r.date.startsWith(month)) continue;
    const b = best.get(r.name);
    if (!b || r.e1 > b.e1) best.set(r.name, r);
  }
  // wzrost liczony od stanu sprzed miesiąca: suma wzrostów kolejnych rekordów tego ćwiczenia
  const gain = new Map<string, number>();
  for (const r of allRecords) if (r.date.startsWith(month)) gain.set(r.name, (gain.get(r.name) ?? 0) + r.gain);
  const recs = [...best.values()].map((r) => ({ ...r, gain: gain.get(r.name) ?? r.gain })).sort((a, b) => b.gain - a.gain);
  return {
    month,
    sessions: ms.length,
    tonnage: ms.reduce((a, s) => a + tonnage(s), 0),
    km: ms.reduce((a, s) => a + kmOf(s), 0),
    records: recs,
  };
}

/** Miesiące od pierwszego treningu do `today` (od najstarszego). Bez treningów — tylko bieżący. */
export function monthsRange(sessions: TrainingSession[], today: ISODate): YearMonth[] {
  const last = today.slice(0, 7);
  const first = sessions.reduce((a, s) => (s.date && s.date.slice(0, 7) < a ? s.date.slice(0, 7) : a), last);
  const out: YearMonth[] = [];
  for (let m = first; m <= last; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

/* ---------- kamienie milowe ---------- */

export type MilestoneKind = 'sessions' | 'tonnage' | 'km' | 'streak';

export const MILESTONE_STEPS: Record<MilestoneKind, number[]> = {
  sessions: [10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000],
  /** tony */
  tonnage: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
  km: [10, 25, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000],
  /** tygodnie z rzędu z co najmniej jednym treningiem */
  streak: [4, 8, 12, 16, 26, 39, 52, 78, 104],
};

const nf = (v: number, d = 0) => v.toLocaleString('pl-PL', { maximumFractionDigits: d });

export function milestoneLabel(kind: MilestoneKind, n: number): string {
  switch (kind) {
    case 'sessions':
      return `${nf(n)} ${plural(n, 'trening', 'treningi', 'treningów')}`;
    case 'tonnage':
      return `${nf(n)} t podniesione łącznie`;
    case 'km':
      return `${nf(n)} km`;
    case 'streak':
      return `${nf(n)} ${plural(n, 'tydzień', 'tygodnie', 'tygodni')} z rzędu`;
  }
}

export interface Achieved {
  kind: MilestoneKind;
  target: number;
  label: string;
  date: ISODate;
}

export interface NextMilestone {
  kind: MilestoneKind;
  target: number;
  label: string;
  /** Obecny stan (dla tonażu w tonach, dla serii tygodni — bieżąca seria). */
  value: number;
}

export interface Milestones {
  achieved: Achieved[];
  next: NextMilestone[];
}

/** Kiedy przekroczono progi przy narastającej sumie (zdarzenia w kolejności dat). */
function crossings(kind: MilestoneKind, events: { date: ISODate; add: number }[]): { achieved: Achieved[]; total: number } {
  const steps = MILESTONE_STEPS[kind];
  const achieved: Achieved[] = [];
  let total = 0;
  let i = 0;
  for (const e of events) {
    total += e.add;
    while (i < steps.length && total >= steps[i] - 1e-9) {
      achieved.push({ kind, target: steps[i], label: milestoneLabel(kind, steps[i]), date: e.date });
      i++;
    }
  }
  return { achieved, total };
}

/**
 * Kamienie milowe: osiągnięte (z datą, od najnowszego) i następny próg każdego rodzaju z postępem.
 * Km — tylko gdy podopieczny cokolwiek przebiegł; tonaż — gdy cokolwiek podniósł.
 */
export function milestones(sessions: TrainingSession[], today: ISODate): Milestones {
  const asc = sessions.filter((s) => s.date && s.date <= today).sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  const ses = crossings('sessions', asc.map((s) => ({ date: s.date, add: 1 })));
  const ton = crossings('tonnage', asc.map((s) => ({ date: s.date, add: tonnage(s) / 1000 })));
  const km = crossings('km', asc.map((s) => ({ date: s.date, add: kmOf(s) })));

  // seria tygodni: najdłuższa w historii (próg osiągnięty w dniu pierwszego treningu tygodnia, który go dobił)
  const steps = MILESTONE_STEPS.streak;
  const st: Achieved[] = [];
  let run = 0;
  let prevWeek: ISODate | null = null;
  let si = 0;
  for (const s of asc) {
    const w = weekStart(s.date);
    if (w === prevWeek) continue;
    run = prevWeek && addDays(prevWeek, 7) === w ? run + 1 : 1;
    prevWeek = w;
    while (si < steps.length && run >= steps[si]) {
      st.push({ kind: 'streak', target: steps[si], label: milestoneLabel('streak', steps[si]), date: s.date });
      si++;
    }
  }

  const nextOf = (kind: MilestoneKind, value: number, done: number): NextMilestone | null => {
    const t = MILESTONE_STEPS[kind][done];
    return t == null ? null : { kind, target: t, label: milestoneLabel(kind, t), value };
  };
  const next = [
    nextOf('sessions', ses.total, ses.achieved.length),
    ton.total > 0 ? nextOf('tonnage', ton.total, ton.achieved.length) : null,
    km.total > 0 ? nextOf('km', km.total, km.achieved.length) : null,
    asc.length ? nextOf('streak', streak(asc, today).weeks, st.length) : null,
  ].filter((x): x is NextMilestone => x != null);

  const achieved = [...ses.achieved, ...ton.achieved, ...km.achieved, ...st].sort((a, b) => b.date.localeCompare(a.date) || b.target - a.target);
  return { achieved, next };
}
