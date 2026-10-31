import type { Appointment, Client, CoachReply, ISODate } from '../domain';
import type { TrainerProfile } from '../data/trainerProfile';
import { addDays, todayISO } from './dates';

/* Profil trenera: porządkowanie zapisu, urlop, podpowiedzi stawek. Logika bez Reacta (testy: trainerProfile.test.ts). */

const isRec = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown, max = 200): string | undefined => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : undefined);
const money = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 100000 ? Math.round(x * 100) / 100 : undefined);
const isDate = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
const isTime = (x: unknown): x is string => typeof x === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(x);

/** Porządkuje profil (dane z bazy / formularza): puste pola znikają, złe liczby i daty są pomijane. */
export function normalizeProfile(raw: unknown): TrainerProfile {
  if (!isRec(raw)) return {};
  const p: TrainerProfile = {};
  const s = (k: keyof TrainerProfile, max?: number) => {
    const v = str(raw[k], max);
    if (v) (p as Record<string, unknown>)[k] = v;
  };
  s('name', 120);
  s('phone', 40);
  s('email', 120);
  s('bankAccount', 60);
  s('bankName', 80);
  s('blikPhone', 40);
  s('replyHours', 120);
  s('weeklyNote', 300);
  const photo = str(raw.photo, 300);
  if (photo && /^(sb|idb):/.test(photo) && !photo.includes('..')) p.photo = photo;
  if (isRec(raw.prices)) {
    const pr = raw.prices;
    const prices: NonNullable<TrainerProfile['prices']> = {};
    const single = money(pr.single);
    const sub = money(pr.subscription);
    if (single != null) prices.single = single;
    if (sub != null) prices.subscription = sub;
    if (isRec(pr.package)) {
      const n = pr.package.sessions;
      const price = money(pr.package.price);
      if (typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 100 && price != null) prices.package = { sessions: n, price };
    }
    if (Object.keys(prices).length) p.prices = prices;
  }
  const dur = raw.defaultDuration;
  if (typeof dur === 'number' && Number.isInteger(dur) && dur >= 5 && dur <= 600) p.defaultDuration = dur;
  if (isRec(raw.workHours) && isTime(raw.workHours.from) && isTime(raw.workHours.to) && Array.isArray(raw.workHours.days)) {
    const days = [...new Set(raw.workHours.days.filter((d): d is number => Number.isInteger(d) && (d as number) >= 1 && (d as number) <= 7))].sort();
    p.workHours = { from: raw.workHours.from, to: raw.workHours.to, days };
  }
  if (isRec(raw.vacation) && isDate(raw.vacation.from) && isDate(raw.vacation.to) && raw.vacation.to >= raw.vacation.from) {
    const message = str(raw.vacation.message, 500);
    p.vacation = { from: raw.vacation.from, to: raw.vacation.to, ...(message ? { message } : {}) };
  }
  return p;
}

/** Problemy w formularzu profilu (puste = można zapisać). */
export function profileProblems(p: TrainerProfile): string[] {
  const out: string[] = [];
  if (p.bankAccount) {
    const digits = p.bankAccount.replace(/^PL/i, '').replace(/[\s-]/g, '');
    if (!/^\d{26}$/.test(digits)) out.push('Numer konta: 26 cyfr (np. 12 3456 7890 1234 5678 9012 3456).');
  }
  if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(p.email)) out.push('Sprawdź adres e-mail.');
  if (p.workHours && p.workHours.from >= p.workHours.to) out.push('Godziny pracy: „do” musi być później niż „od”.');
  if (p.vacation && p.vacation.to < p.vacation.from) out.push('Urlop: data końca przed datą początku.');
  return out;
}

/** Numer konta w czytelnych grupach: „12 3456 7890 …” (z PL na początku, jeśli był). */
export function fmtAccount(acc: string | undefined): string {
  if (!acc) return '';
  const pl = /^PL/i.test(acc.trim());
  const d = acc.replace(/^\s*PL/i, '').replace(/[\s-]/g, '');
  if (!/^\d{26}$/.test(d)) return acc.trim();
  return `${pl ? 'PL' : ''}${d.slice(0, 2)} ${d.slice(2).replace(/(\d{4})(?=\d)/g, '$1 ')}`;
}

/* ---------- urlop ---------- */

/** Trener jest na urlopie w tym dniu (od–do włącznie). */
export function onVacation(p: TrainerProfile | null | undefined, day: ISODate = todayISO()): boolean {
  const v = p?.vacation;
  return !!v && v.from <= day && day <= v.to;
}

/** Urlop trwa albo się zbliża (do baneru u podopiecznych): od `ahead` dni przed startem do końca. */
export function vacationRelevant(p: TrainerProfile | null | undefined, day: ISODate = todayISO(), ahead = 7): boolean {
  const v = p?.vacation;
  return !!v && v.to >= day && addDays(day, ahead) >= v.from;
}

const dm = (iso: ISODate) => `${Number(iso.slice(8, 10))}.${iso.slice(5, 7)}`;

/** Treść automatycznej odpowiedzi w czasie urlopu (własna wiadomość trenera albo domyślna). */
export function vacationReplyText(p: TrainerProfile): string {
  const v = p.vacation;
  if (!v) return '';
  if (v.message?.trim()) return v.message.trim().slice(0, 500);
  return `Dzięki za wiadomość! Jestem na urlopie do ${dm(v.to)} — odpiszę po powrocie.`;
}

/** Id automatycznej odpowiedzi — jedna dziennie na podopiecznego (to samo id w bazie, sekcja 29). */
export const vacationReplyId = (day: ISODate) => `vac-${day}`;

/**
 * Automatyczna odpowiedź trenera, gdy podopieczny pisze w czasie urlopu — raz dziennie na podopiecznego.
 * null = nie odpowiadać (brak urlopu albo dziś już odpowiedziano).
 */
export function vacationAutoReply(client: Pick<Client, 'replies'>, p: TrainerProfile | null | undefined, now = new Date()): CoachReply | null {
  const day = todayISO(now);
  if (!p || !onVacation(p, day)) return null;
  const id = vacationReplyId(day);
  if ((client.replies ?? []).some((r) => r.id === id)) return null;
  // `auto` — oznaczenie „automatyczna” u trenera (rodzaj spoza reguł z Ustawień)
  return { id, at: now.toISOString(), text: vacationReplyText(p), auto: 'vacation' as unknown as CoachReply['auto'] };
}

/** Zaplanowane wizyty w czasie urlopu (do pytania „Odwołać N wizyt?”). */
export function vacationAppointments(appts: Appointment[], v: TrainerProfile['vacation'], today: ISODate = todayISO()): Appointment[] {
  if (!v) return [];
  return appts
    .filter((a) => a.status === 'planned' && !a.sessionId && a.date >= v.from && a.date <= v.to && a.date >= today)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

/** Odwołanie przez trenera: sam status „cancel” (bez odpowiedzi podopiecznego). */
export const cancelByTrainer = (a: Appointment): Appointment => ({ ...a, status: 'cancel' });

/* ---------- cennik → nowy podopieczny ---------- */

/** Stawki z cennika do formularza nowego podopiecznego (tylko puste pola). */
export function priceDefaults(p: TrainerProfile, d: Record<string, string>): Record<string, string> {
  const pr = p.prices;
  if (!pr) return d;
  const fill = (k: string, v: number | undefined) => (v != null && !(d[k] ?? '').trim() ? { [k]: String(v).replace('.', ',') } : {});
  return { ...d, ...fill('singleRate', pr.single), ...fill('subRate', pr.subscription), ...fill('pkgSize', pr.package?.sessions), ...fill('pkgPrice', pr.package?.price) };
}

/** Krótki opis cennika: „Sesja 150 zł · Pakiet 10 × 1300 zł · Abonament 520 zł/mies.” */
export function pricesLine(p: TrainerProfile): string {
  const pr = p.prices;
  if (!pr) return '';
  const z = (n: number) => `${n.toLocaleString('pl-PL', { maximumFractionDigits: 2 })} zł`;
  return [pr.single != null && `Sesja ${z(pr.single)}`, pr.package && `Pakiet ${pr.package.sessions} × ${z(pr.package.price)}`, pr.subscription != null && `Abonament ${z(pr.subscription)}/mies.`].filter(Boolean).join(' · ');
}

export const WEEKDAYS: [number, string][] = [
  [1, 'pn'],
  [2, 'wt'],
  [3, 'śr'],
  [4, 'czw'],
  [5, 'pt'],
  [6, 'sob'],
  [7, 'nd'],
];

/** „pn–pt 7:00–20:00”, „pn, śr, pt 16:00–21:00”. */
export function workHoursLine(w: TrainerProfile['workHours']): string {
  if (!w || !w.days.length) return '';
  const ds = [...w.days].sort();
  const run = ds.length > 2 && ds.every((d, i) => i === 0 || d === ds[i - 1] + 1);
  const name = (d: number) => WEEKDAYS.find(([n]) => n === d)?.[1] ?? '';
  const days = run ? `${name(ds[0])}–${name(ds[ds.length - 1])}` : ds.map(name).join(', ');
  const t = (x: string) => x.replace(/^0(\d)/, '$1');
  return `${days} ${t(w.from)}–${t(w.to)}`;
}
