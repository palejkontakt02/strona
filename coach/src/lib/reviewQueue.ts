import type { Client, ISODate, TrainingSession, Wellness } from '../domain';
import { addDays, weekStart } from './dates';
import { workoutStats } from './lastResult';
import { records } from './strength';
import { wellnessReadings, WELLNESS_DROP } from './overviewTable';

/*
 * Kolejka „Do przejrzenia”: wszystko z ostatnich 7 dni, na co trener powinien zareagować.
 * Element jest zamknięty, gdy:
 *  - trener oznaczył go „Przejrzane” (klucz w `client.reviewed` — pole trenera, zwykły zapis), albo
 *  - zareagował w naturalny sposób: komentarz do raportu (`coachNote`), odpowiedź w rozmowie po komentarzu,
 *    obejrzane nagranie (`reviewedAt`).
 */

export type ReviewKind = 'pain' | 'wellness' | 'comment' | 'video' | 'report' | 'food' | 'record';

export interface ReviewItem {
  /** Stały klucz (zapisywany w `client.reviewed`). */
  key: string;
  kind: ReviewKind;
  clientId: string;
  /** Data (RRRR-MM-DD) albo chwila (ISO) — do sortowania. */
  at: string;
  date: ISODate;
  title: string;
  detail?: string;
  sessionId?: string;
  noteId?: string;
  reportId?: string;
}

export const REVIEW_LABEL: Record<ReviewKind, string> = {
  pain: 'Ból na treningu',
  wellness: 'Spadek samopoczucia',
  comment: 'Komentarz do treningu',
  video: 'Nagranie do oceny',
  report: 'Raport tygodniowy',
  food: 'Żywienie poza celem',
  record: 'Nowy rekord',
};

/** Kolejność w kolejce: najpierw zdrowie, potem pytania podopiecznego, na końcu dobre wiadomości. */
const PRIORITY: ReviewKind[] = ['pain', 'wellness', 'comment', 'video', 'report', 'food', 'record'];

/** Ile kluczy „przejrzane” trzymamy (starsze i tak wypadają z okna 7 dni). */
export const REVIEWED_MAX = 300;

export const PAIN_AT = 5;
/** Kalorie poza 70–130% celu albo białko poniżej 70% celu. */
export const FOOD_FAR = 0.3;

const dayOf = (at: string) => at.slice(0, 10);

export function clientReviewItems(c: Client, allSessions: TrainingSession[], today: ISODate, days = 7): ReviewItem[] {
  const from = addDays(today, -(days - 1));
  const inRange = (d: string) => !!d && d >= from && d <= today;
  const sessions = allSessions.filter((s) => s.clientId === c.id);
  const out: ReviewItem[] = [];
  const replies = c.replies ?? [];

  // raport tygodniowy bez komentarza trenera
  for (const r of c.weeklyReports ?? []) {
    if (r.coachNote || !inRange(dayOf(r.at || r.week))) continue;
    out.push({ key: `report:${r.id}`, kind: 'report', clientId: c.id, at: r.at || r.week, date: dayOf(r.at || r.week), title: 'Raport tygodniowy', detail: r.comment, reportId: r.id });
  }

  // ból ≥ 5 na treningu
  for (const s of sessions) {
    if (s.pain != null && s.pain >= PAIN_AT && inRange(s.date)) {
      const where = (s.painMap ?? []).map((p) => p.area + (p.side ? ` ${p.side}` : '')).join(', ');
      out.push({ key: `pain:${s.id}`, kind: 'pain', clientId: c.id, at: s.createdAt || s.date, date: s.date, title: `Ból ${s.pain}/10`, detail: [s.workoutName, where].filter(Boolean).join(' · '), sessionId: s.id });
    }
  }

  // spadek samopoczucia: odczyt ≥ 0,5 pkt poniżej średniej z 4 wcześniejszych
  const readings = wellnessReadings(c, sessions, addDays(from, -28), today);
  readings.forEach((r, i) => {
    if (!inRange(r.date)) return;
    const prev = readings.slice(Math.max(0, i - 4), i);
    if (!prev.length) return;
    const base = prev.reduce((a, x) => a + x.v, 0) / prev.length;
    if (r.v <= base - WELLNESS_DROP) {
      out.push({
        key: `wellness:${r.date}`,
        kind: 'wellness',
        clientId: c.id,
        at: r.date,
        date: r.date,
        title: `Samopoczucie ${fmt1(r.v)}/5`,
        detail: `zwykle ok. ${fmt1(base)}/5`,
      });
    }
  });

  // komentarz do treningu bez odpowiedzi trenera
  for (const n of c.inbox ?? []) {
    const sid = n.ref?.sessionId ?? n.sessionId;
    if (n.hidden || !sid || !inRange(dayOf(n.at))) continue;
    const answered = replies.some((r) => r.replyTo === n.id || (r.at || '') > (n.at || ''));
    if (answered) continue;
    out.push({ key: `comment:${n.id}`, kind: 'comment', clientId: c.id, at: n.at, date: dayOf(n.at), title: n.ref?.exName ? `Komentarz: ${n.ref.exName}` : 'Komentarz do treningu', detail: n.text, sessionId: sid, noteId: n.id });
  }

  // nagrania do oceny
  for (const s of sessions) {
    if (s.reviewedAt || !inRange(s.date)) continue;
    const n = s.exercises.reduce((a, e) => a + (e.setsLog ?? []).filter((x) => x.video).length, 0);
    if (n) out.push({ key: `video:${s.id}`, kind: 'video', clientId: c.id, at: s.createdAt || s.date, date: s.date, title: `Nagrania: ${n}`, detail: s.workoutName, sessionId: s.id });
  }

  // nowe rekordy (jeden element na dzień)
  const prs = records(sessions).filter((p) => inRange(p.date));
  for (const date of [...new Set(prs.map((p) => p.date))]) {
    const list = prs.filter((p) => p.date === date);
    out.push({
      key: `record:${date}`,
      kind: 'record',
      clientId: c.id,
      at: date,
      date,
      title: list.length > 1 ? `Nowe rekordy: ${list.length}` : 'Nowy rekord',
      detail: list.map((p) => `${p.name} ${fmt1(p.e1)} kg e1RM (+${fmt1(p.gain)})`).join(' · '),
    });
  }

  // żywienie mocno poza celem
  const t = c.targets;
  for (const l of c.dayLog ?? []) {
    if (!inRange(l.date) || l.date === today) continue;
    const parts: string[] = [];
    if (t?.kcal && l.kcal != null && Math.abs(l.kcal / t.kcal - 1) > FOOD_FAR) parts.push(`${Math.round(l.kcal)} kcal (cel ${t.kcal})`);
    if (t?.protein && l.protein != null && l.protein / t.protein < 1 - FOOD_FAR) parts.push(`białko ${Math.round(l.protein)} g (cel ${t.protein})`);
    if (parts.length) out.push({ key: `food:${l.date}`, kind: 'food', clientId: c.id, at: l.date, date: l.date, title: 'Żywienie poza celem', detail: parts.join(' · ') });
  }

  const done = new Set(c.reviewed ?? []);
  return out.filter((x) => !done.has(x.key));
}

/** Cała kolejka: priorytet rodzaju, potem od najnowszych. */
export function reviewQueue(clients: Client[], sessions: TrainingSession[], today: ISODate): ReviewItem[] {
  return clients
    .filter((c) => c.status === 'aktywny')
    .flatMap((c) => clientReviewItems(c, sessions, today))
    .sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind) || b.at.localeCompare(a.at));
}

/** Dopisuje klucz do „przejrzanych” (bez duplikatów, najwyżej REVIEWED_MAX ostatnich). */
export function withReviewed(reviewed: string[] | undefined, key: string): string[] {
  const list = (reviewed ?? []).filter((k) => k !== key);
  return [...list, key].slice(-REVIEWED_MAX);
}

/* ---------- kontekst: 8 tygodni ---------- */

export interface WeekPt {
  x: ISODate;
  y: number;
}

export interface ReviewContext {
  weight: WeekPt[];
  sleep: WeekPt[];
  energy: WeekPt[];
  /** Serie robocze w tygodniu. */
  volume: WeekPt[];
}

/** Tygodniowe punkty z 8 tygodni (poniedziałki): waga (pomiary + raporty), sen i energia (check-iny, wellness), serie robocze. */
export function reviewContext(c: Client, allSessions: TrainingSession[], today: ISODate, weeks = 8): ReviewContext {
  const last = weekStart(today);
  const starts = Array.from({ length: weeks }, (_, i) => addDays(last, -7 * (weeks - 1 - i)));
  const weekOf = (d: string) => weekStart(d);
  const from = starts[0];
  const sessions = allSessions.filter((s) => s.clientId === c.id && s.date >= from && s.date <= today);

  const avgBy = (vals: { d: string; v: number }[]) =>
    starts
      .map((w) => {
        const xs = vals.filter((x) => weekOf(x.d) === w).map((x) => x.v);
        return xs.length ? { x: w, y: Math.round((xs.reduce((a, v) => a + v, 0) / xs.length) * 10) / 10 } : null;
      })
      .filter((p): p is WeekPt => !!p);

  const weights = [
    ...[...(c.measurements ?? []), ...(c.selfMeasurements ?? []).filter((m) => !m.hidden)].filter((m) => m.weight != null && m.date >= from).map((m) => ({ d: m.date, v: m.weight! })),
    ...(c.weeklyReports ?? []).filter((r) => r.weight != null && r.week >= from).map((r) => ({ d: r.week, v: r.weight! })),
  ];
  const well = [
    ...(c.checkins ?? []).filter((x) => x.date >= from).map((x) => ({ d: x.date, w: x as Wellness })),
    ...sessions.filter((s) => s.wellness).map((s) => ({ d: s.date, w: s.wellness! })),
  ];
  return {
    weight: avgBy(weights),
    sleep: avgBy(well.filter((x) => x.w.sleep != null).map((x) => ({ d: x.d, v: x.w.sleep! }))),
    energy: avgBy(well.filter((x) => x.w.energy != null).map((x) => ({ d: x.d, v: x.w.energy! }))),
    volume: starts.map((w) => ({ x: w, y: sessions.filter((s) => weekOf(s.date) === w).reduce((a, s) => a + workoutStats(s).sets, 0) })),
  };
}

function fmt1(v: number): string {
  return (Math.round(v * 10) / 10).toLocaleString('pl-PL', { maximumFractionDigits: 1 });
}
