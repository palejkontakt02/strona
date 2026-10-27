/**
 * Nowy podopieczny krok po kroku: zaproszenie do aplikacji (link, tekst, SMS / WhatsApp / e-mail)
 * i checklista „Pierwsze kroki” liczona z danych (nic nie odhacza się ręcznie).
 */
import type { Client } from '../domain';
import { INTAKE_PARQ } from './intake';
import { fmtDay } from '../format';

/** Adres aplikacji podopiecznego (tak jak w mailach i na stronie). */
export const APP_URL = 'https://sebastianpalej.pl/app/';
/** Parametr w linku zaproszenia — ekran logowania wpisuje z niego e-mail i otwiera „Nowe konto”. */
export const INVITE_PARAM = 'zaproszenie';

/** Stan konta z listy kont (chmura); 'unknown' — lista niedostępna (podgląd lokalny, brak funkcji w bazie). */
export type AccountKnown = 'active' | 'unconfirmed' | 'none' | 'no-email' | 'unknown';
export type InviteState = 'connected' | 'unconfirmed' | 'invited' | 'not-invited';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const isEmail = (s: string | undefined | null) => !!s && EMAIL_RE.test(s.trim());

/** Polski numer → „+48 600 100 200”; inny numer z „+” zostaje (bez spacji podwójnych); null — to nie numer. */
export function normalizePhone(raw: string | undefined | null): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  if (/[^\d\s+()-]/.test(s)) return null;
  let d = s.replace(/[\s()-]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  if (/^\d{9}$/.test(d)) d = '+48' + d;
  if (/^48\d{9}$/.test(d)) d = '+' + d;
  if (/^\+48\d{9}$/.test(d)) return `+48 ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`;
  if (/^\+(?!48)\d{7,15}$/.test(d)) return d;
  return null;
}
/** Numer do linków sms: / wa.me (same cyfry, z kodem kraju). */
export const phoneDigits = (raw: string | undefined | null) => normalizePhone(raw)?.replace(/\D/g, '') ?? '';

export function inviteLink(email?: string | null): string {
  const e = email?.trim().toLowerCase();
  return e ? `${APP_URL}?${INVITE_PARAM}=${encodeURIComponent(e)}` : APP_URL;
}

/** E-mail z linku zaproszenia (ekran logowania). */
export function readInviteEmail(search: string): string | null {
  const v = new URLSearchParams(search).get(INVITE_PARAM);
  return v && isEmail(v) ? v.trim().toLowerCase() : null;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';

/** Gotowa treść zaproszenia (SMS / WhatsApp / e-mail) z krótką instrukcją instalacji na telefonie. */
export function inviteText(client: Pick<Client, 'name' | 'email'>, coach = 'Sebastian'): string {
  const hi = firstName(client.name) ? `Cześć ${firstName(client.name)}!` : 'Cześć!';
  const email = client.email?.trim().toLowerCase();
  return [
    `${hi} Zapraszam Cię do aplikacji treningowej — znajdziesz w niej plan, treningi seria po serii, wizyty i kontakt ze mną.`,
    '',
    `1. Otwórz link: ${inviteLink(email)}`,
    email ? `2. Załóż konto na adres ${email} (ten, który mam w Twoim profilu) i potwierdź go linkiem z maila.` : '2. Załóż konto na swój adres e-mail i potwierdź go linkiem z maila.',
    '3. Dodaj aplikację do ekranu telefonu: iPhone — Safari → Udostępnij → „Do ekranu początkowego”; Android — Chrome → menu ⋮ → „Dodaj do ekranu głównego”.',
    '',
    `Do zobaczenia na treningu! ${coach}`,
  ].join('\n');
}

export const INVITE_SUBJECT = 'Zaproszenie do aplikacji treningowej';

export const smsHref = (text: string, phone?: string | null) => `sms:${phoneDigits(phone) ? '+' + phoneDigits(phone) : ''}?body=${encodeURIComponent(text)}`;
export const waHref = (text: string, phone?: string | null) => `https://wa.me/${phoneDigits(phone)}?text=${encodeURIComponent(text)}`;
export const mailHref = (text: string, email?: string | null) =>
  `mailto:${email?.trim() ? encodeURIComponent(email.trim()) : ''}?subject=${encodeURIComponent(INVITE_SUBJECT)}&body=${encodeURIComponent(text)}`;

/** Czy podopieczny już coś zapisał sam (czyli ma połączone konto) — gdy lista kont jest niedostępna. */
export function hasClientActivity(c: Client): boolean {
  return !!(
    c.intake ||
    c.checkins?.length ||
    c.selfMeasurements?.length ||
    c.habitLog?.length ||
    c.inbox?.length ||
    c.weeklyReports?.length ||
    c.dayLog?.length ||
    c.consents?.length
  );
}

/** Zaproszenie i konto: połączone / e-mail niepotwierdzony / zaproszony (kiedy) / nie zaproszony. */
export function inviteState(c: Client, account: AccountKnown): InviteState {
  if (account === 'active' || (account === 'unknown' && hasClientActivity(c))) return 'connected';
  if (account === 'unconfirmed') return 'unconfirmed';
  return c.invitedAt ? 'invited' : 'not-invited';
}

export const INVITE_LABEL: Record<InviteState, string> = {
  connected: 'połączył konto',
  unconfirmed: 'e-mail niepotwierdzony',
  invited: 'zaproszony',
  'not-invited': 'nie zaproszony',
};

export type StepId = 'contact' | 'invite' | 'account' | 'intake' | 'plan' | 'billing' | 'visit';
export interface Step {
  id: StepId;
  label: string;
  done: boolean;
  /** Krótko: co już jest albo czego brakuje. */
  note: string;
}

export interface OnboardingInput {
  client: Client;
  account: AccountKnown;
  /** Plany podopiecznego (bez szablonów i treningów dodatkowych). */
  plans: number;
  /** Wywiad zdrowotny trenera (PAR-Q) — czy wypełniony. */
  healthDone: boolean;
  /** Wizyty w kalendarzu (zaplanowane lub odbyte) i treningi zapisane. */
  appointments: number;
  sessions: number;
}

export function intakeDone(c: Client, healthDone: boolean): boolean {
  if (healthDone || c.intake?.completedAt) return true;
  const a = c.intake?.answers;
  return !!a && INTAKE_PARQ.every((k) => (a[k] ?? '').trim() !== '');
}

export function billingDone(c: Client): boolean {
  if (c.payments.length) return true;
  return c.billing === 'klub' || c.billing === 'brak' || (c.billing === 'abonament' && !!c.subRate) || (c.billing === 'pojedyncza' && !!c.singleRate);
}

/** Kroki „Pierwsze kroki” w kolejności; stan liczony wyłącznie z danych. */
export function onboardingSteps(i: OnboardingInput): Step[] {
  const c = i.client;
  const inv = inviteState(c, i.account);
  const phone = normalizePhone(c.phone);
  return [
    {
      id: 'contact',
      label: 'Dane kontaktowe',
      done: isEmail(c.email),
      note: isEmail(c.email) ? [c.email!.trim(), phone].filter(Boolean).join(' · ') : c.email?.trim() ? 'popraw adres e-mail' : 'brak e-maila — bez niego nie połączy konta',
    },
    {
      id: 'invite',
      label: 'Zaproszenie wysłane',
      done: !!c.invitedAt || inv === 'connected' || inv === 'unconfirmed',
      note: c.invitedAt ? `wysłane ${fmtDay(c.invitedAt.slice(0, 10))}` : inv === 'connected' || inv === 'unconfirmed' ? 'konto już założone' : 'link, kod QR, SMS, WhatsApp lub e-mail',
    },
    {
      id: 'account',
      label: 'Konto połączone',
      done: inv === 'connected',
      note: inv === 'connected' ? 'podopieczny widzi swój plan' : inv === 'unconfirmed' ? 'czeka na kliknięcie linku w mailu' : i.account === 'unknown' ? 'widać po pierwszym wpisie podopiecznego' : 'jeszcze nie założył konta',
    },
    {
      id: 'intake',
      label: 'Ankieta i PAR-Q',
      done: intakeDone(c, i.healthDone),
      note: intakeDone(c, i.healthDone) ? 'wypełnione' : 'podopieczny wypełnia ankietę w aplikacji albo Ty wywiad w Profilu',
    },
    { id: 'plan', label: 'Plan przypisany', done: i.plans > 0, note: i.plans > 0 ? `${i.plans} ${i.plans === 1 ? 'plan' : 'plany'}` : 'brak planu' },
    { id: 'billing', label: 'Pakiet lub płatność', done: billingDone(c), note: billingDone(c) ? (c.payments.length ? 'płatność zapisana' : 'rozliczenie ustawione') : 'dodaj pakiet albo pierwszą płatność' },
    {
      id: 'visit',
      label: 'Pierwsza wizyta umówiona',
      done: i.appointments > 0 || i.sessions > 0,
      note: i.appointments > 0 || i.sessions > 0 ? 'w kalendarzu' : 'brak wizyty w kalendarzu',
    },
  ];
}

export const onboardingComplete = (steps: Step[]) => steps.every((s) => s.done);
