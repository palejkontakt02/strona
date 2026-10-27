import type { Client, ClientNote, DayLog, DayTargets, ISODate, MsgMedia, MsgRef, ProgressPhoto, WeeklyReport } from '../domain';
import { addDays, todayISO, weekStart } from './dates';

/* ---------- raport tygodniowy ---------- */

/** 1 = pon … 7 = niedz. */
export const isoDow = (iso: ISODate) => {
  const ws = weekStart(iso);
  for (let i = 0; i < 7; i++) if (addDays(ws, i) === iso) return i + 1;
  return 1;
};

/**
 * Tydzień (poniedziałek), którego dotyczy raport wysyłany dziś: pt–nd — bieżący tydzień,
 * pn–czw — poprzedni (raport z poniedziałku zamyka miniony tydzień).
 */
export function reportWeek(today: ISODate): ISODate {
  const ws = weekStart(today);
  return isoDow(today) >= 5 ? ws : addDays(ws, -7);
}

/** Karta „Raport tygodnia” u podopiecznego: piątek, sobota, niedziela i poniedziałek. */
export const inReportWindow = (today: ISODate) => [5, 6, 7, 1].includes(isoDow(today));

/** Trener wymaga raportu (przełącznik) albo podopieczny już je wysyła; `false` wyłącza. */
export const reportExpected = (c: Client) => c.weeklyReport ?? (c.weeklyReports?.length ?? 0) > 0;

export const reportFor = (c: Client, week: ISODate) => (c.weeklyReports ?? []).find((r) => r.week === week);

/** Pokazać kartę raportu dziś? */
export const reportDue = (c: Client, today: ISODate) => reportExpected(c) && inReportWindow(today) && !reportFor(c, reportWeek(today));

/** Raporty od najnowszego tygodnia. */
export const reportsDesc = (c: Client): WeeklyReport[] => [...(c.weeklyReports ?? [])].sort((a, b) => b.week.localeCompare(a.week) || (b.at || '').localeCompare(a.at || ''));

/** „13–19 paź” / „27 paź – 2 lis”. */
export function weekLabel(week: ISODate): string {
  const end = addDays(week, 6);
  const d = (iso: string) => new Date(`${iso}T12:00:00`);
  const m = (iso: string) => d(iso).toLocaleDateString('pl-PL', { month: 'short' });
  return week.slice(0, 7) === end.slice(0, 7) ? `${d(week).getDate()}–${d(end).getDate()} ${m(end)}` : `${d(week).getDate()} ${m(week)} – ${d(end).getDate()} ${m(end)}`;
}

/** Pulpit: kto przysłał raport za tydzień `reportWeek(today)` (aktywni z włączonym raportem). */
export function reportStats(clients: Client[], today: ISODate) {
  const week = reportWeek(today);
  const expected = clients.filter((c) => c.status === 'aktywny' && reportExpected(c));
  const sent = expected.filter((c) => reportFor(c, week));
  const missing = expected.filter((c) => !reportFor(c, week));
  const unread = clients.flatMap((c) => (c.weeklyReports ?? []).filter((r) => !r.seenAt).map((r) => ({ c, r })));
  return { week, expected, sent, missing, unread };
}

/** Waga z raportów (rosnąco) — trend. */
export const reportWeights = (reports: WeeklyReport[] | undefined) =>
  [...(reports ?? [])].filter((r) => r.weight != null).sort((a, b) => a.week.localeCompare(b.week)).map((r) => ({ x: r.week, y: r.weight! }));

/* ---------- rozmowa ---------- */

export interface ChatMsg {
  id: string;
  at: string;
  text: string;
  from: 'client' | 'coach';
  sessionId?: string;
  /** Wiadomość podopiecznego przeczytana przez trenera. */
  read?: boolean;
  /** Kontekst: trening / ćwiczenie. */
  ref?: MsgRef;
  media?: MsgMedia[];
  textAuto?: boolean;
  /** Odpowiedź trenera na wiadomość o tym id. */
  replyTo?: string;  /** Wiadomość automatyczna (reguła trenera). */
  auto?: string;
}

/** Wiadomości podopiecznego i odpowiedzi trenera w jednym wątku, od najstarszej. */
export function chatThread(c: Pick<Client, 'inbox' | 'replies'>): ChatMsg[] {
  return [
    ...(c.inbox ?? []).filter((n) => !n.hidden).map((n: ClientNote): ChatMsg => ({ id: n.id, at: n.at, text: n.text, from: 'client', sessionId: n.sessionId, read: !!n.read, ref: n.ref, media: n.media, textAuto: n.textAuto })),
    ...(c.replies ?? []).map((r): ChatMsg => ({ id: r.id, at: r.at, text: r.text, from: 'coach', read: true, ref: r.ref, media: r.media, textAuto: r.textAuto, replyTo: r.replyTo, ...(r.auto ? { auto: r.auto } : {}) })),
  ].sort((a, b) => (a.at || '').localeCompare(b.at || ''));
}

/** Nieprzeczytane przez trenera. */
export const trainerUnread = (c: Pick<Client, 'inbox'>) => (c.inbox ?? []).filter((n) => !n.read && !n.hidden).length;

/** Nowe odpowiedzi trenera dla podopiecznego: po ostatnim otwarciu rozmowy i po jego ostatniej wiadomości. */
export function athleteUnread(c: Pick<Client, 'inbox' | 'replies'>, seenAt = ''): number {
  const lastMine = (c.inbox ?? []).reduce((a, n) => (n.at > a ? n.at : a), '');
  const since = seenAt > lastMine ? seenAt : lastMine;
  return (c.replies ?? []).filter((r) => (r.at || '') > since).length;
}

/** Lokalna data wiadomości (RRRR-MM-DD). */
export const msgDay = (at: string) => (at ? todayISO(new Date(at)) : '');

/** Wiadomości pogrupowane po dniach (do separatorów). */
export function byDay(msgs: ChatMsg[]): { day: ISODate; msgs: ChatMsg[] }[] {
  const out: { day: ISODate; msgs: ChatMsg[] }[] = [];
  for (const m of msgs) {
    const d = msgDay(m.at);
    if (out.length && out[out.length - 1].day === d) out[out.length - 1].msgs.push(m);
    else out.push({ day: d, msgs: [m] });
  }
  return out;
}

/** „Dziś”, „Wczoraj”, „pt, 17 paź” (inny rok — z rokiem). */
export function dayLabel(day: ISODate, today: ISODate): string {
  if (!day) return '—';
  if (day === today) return 'Dziś';
  if (day === addDays(today, -1)) return 'Wczoraj';
  const d = new Date(`${day}T12:00:00`);
  return d.toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short', ...(day.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}) });
}

/* ---------- makro i kroki ---------- */

export type MetricKey = keyof DayTargets;
/** klucz, etykieta, jednostka, krok przycisków +/−, maks. */
export const METRICS: [MetricKey, string, string, number, number][] = [
  ['protein', 'Białko', 'g', 10, 600],
  ['kcal', 'Kalorie', 'kcal', 100, 10000],
  ['steps', 'Kroki', '', 1000, 100000],
  ['water', 'Woda', 'l', 0.25, 15],
];

/** Cel osiągnięty: kcal w granicach ±10%, reszta co najmniej 90% celu. */
export function metricHit(key: MetricKey, value: number | undefined, target: number | undefined): boolean {
  if (!target || value == null) return false;
  return key === 'kcal' ? value >= target * 0.9 && value <= target * 1.1 : value >= target * 0.9;
}

export const hasTargets = (t?: DayTargets) => !!t && METRICS.some(([k]) => (t[k] ?? 0) > 0);

/** Ile celów dnia osiągniętych (spośród ustawionych). */
export function dayScore(log: DayLog | undefined, t: DayTargets | undefined): { hit: number; total: number } {
  const keys = METRICS.map(([k]) => k).filter((k) => (t?.[k] ?? 0) > 0);
  return { hit: keys.filter((k) => metricHit(k, log?.[k], t?.[k])).length, total: keys.length };
}

const logged = (l?: DayLog) => !!l && METRICS.some(([k]) => l[k] != null);

/**
 * Realizacja celów w ostatnich `days` dniach (do dziś). Dzień bez wpisu = nieosiągnięty;
 * dzisiejszy dzień liczy się tylko, gdy ma wpis (nie karze za trwający dzień).
 */
export function adherence(log: DayLog[] | undefined, t: DayTargets | undefined, today: ISODate, days: number) {
  const map = new Map((log ?? []).map((l) => [l.date, l]));
  const perDay = Array.from({ length: days }, (_, i) => addDays(today, i - days + 1)).map((date) => {
    const l = map.get(date);
    return { date, log: l, logged: logged(l), ...dayScore(l, t) };
  });
  const counted = perDay.filter((d) => d.date !== today || d.logged);
  const hit = counted.reduce((a, d) => a + d.hit, 0);
  const total = counted.reduce((a, d) => a + d.total, 0);
  const perMetric = Object.fromEntries(
    METRICS.filter(([k]) => (t?.[k] ?? 0) > 0).map(([k]) => {
      const vals = counted.map((d) => d.log?.[k]).filter((v): v is number => v != null);
      return [k, { avg: vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : undefined, hitDays: counted.filter((d) => metricHit(k, d.log?.[k], t?.[k])).length, days: counted.length }];
    }),
  ) as Partial<Record<MetricKey, { avg?: number; hitDays: number; days: number }>>;
  return { perDay, pct: total ? hit / total : null, loggedDays: counted.filter((d) => d.logged).length, days: counted.length, perMetric };
}

/** Wartość po +/−: nie poniżej 0, bez błędów zmiennoprzecinkowych. */
export const bump = (v: number | undefined, step: number, max: number) => Math.min(max, Math.max(0, Math.round(((v ?? 0) + step) * 100) / 100));

/* ---------- zdjęcia sylwetki ---------- */

export const POSES: ProgressPhoto['pose'][] = ['przód', 'bok', 'tył'];

/** Daty (od najnowszej) ze zdjęciem w danej pozie. */
export const photoDates = (photos: ProgressPhoto[] | undefined, pose: ProgressPhoto['pose'], withHidden = false) =>
  [...new Set((photos ?? []).filter((p) => p.pose === pose && (withHidden || !p.hidden)).map((p) => p.date))].sort((a, b) => b.localeCompare(a));

/** Zdjęcie z dnia w pozie (najnowsze z tego dnia). */
export const photoAt = (photos: ProgressPhoto[] | undefined, pose: ProgressPhoto['pose'], date: ISODate, withHidden = false) =>
  (photos ?? []).filter((p) => p.pose === pose && p.date === date && (withHidden || !p.hidden)).sort((a, b) => (b.at || '').localeCompare(a.at || ''))[0];
