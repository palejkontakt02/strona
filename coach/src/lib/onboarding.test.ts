import { describe, expect, it } from 'vitest';
import type { Client } from '../domain';
import { INTAKE_PARQ } from './intake';
import {
  billingDone,
  inviteLink,
  inviteState,
  inviteText,
  isEmail,
  mailHref,
  normalizePhone,
  onboardingComplete,
  onboardingSteps,
  readInviteEmail,
  smsHref,
  waHref,
  type OnboardingInput,
} from './onboarding';

const base = (p: Partial<Client> = {}): Client => ({ id: 'c1', name: 'Anna Kowalska', status: 'aktywny', payments: [], measurements: [], tests: [], injuryLog: [], checkins: [], ...p });
const input = (p: Partial<OnboardingInput> = {}, c: Partial<Client> = {}): OnboardingInput => ({ client: base(c), account: 'unknown', plans: 0, healthDone: false, appointments: 0, sessions: 0, ...p });
const done = (i: OnboardingInput) => Object.fromEntries(onboardingSteps(i).map((s) => [s.id, s.done]));

describe('telefon i e-mail', () => {
  it('normalizuje polskie numery do +48', () => {
    expect(normalizePhone('600100200')).toBe('+48 600 100 200');
    expect(normalizePhone('600-100-200')).toBe('+48 600 100 200');
    expect(normalizePhone('+48 600 100 200')).toBe('+48 600 100 200');
    expect(normalizePhone('0048600100200')).toBe('+48 600 100 200');
    expect(normalizePhone('48600100200')).toBe('+48 600 100 200');
    expect(normalizePhone('+44 7700 900123')).toBe('+447700900123');
  });
  it('odrzuca błędne numery', () => {
    expect(normalizePhone('60010020')).toBeNull();
    expect(normalizePhone('+48 600 100 2000')).toBeNull();
    expect(normalizePhone('tel. 600')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
  it('sprawdza e-mail', () => {
    expect(isEmail('anna@x.pl')).toBe(true);
    expect(isEmail(' anna@x.pl ')).toBe(true);
    expect(isEmail('anna@x')).toBe(false);
    expect(isEmail('anna x@y.pl')).toBe(false);
    expect(isEmail(undefined)).toBe(false);
  });
});

describe('zaproszenie', () => {
  it('link z zakodowanym e-mailem i odczyt na ekranie logowania', () => {
    const l = inviteLink(' Anna+fit@X.pl ');
    expect(l).toBe('https://sebastianpalej.pl/app/?zaproszenie=anna%2Bfit%40x.pl');
    expect(readInviteEmail(new URL(l).search)).toBe('anna+fit@x.pl');
    expect(readInviteEmail('?zaproszenie=nie-email')).toBeNull();
    expect(readInviteEmail('')).toBeNull();
    expect(inviteLink(undefined)).toBe('https://sebastianpalej.pl/app/');
  });
  it('tekst po polsku z linkiem, adresem i krokami instalacji', () => {
    const t = inviteText({ name: 'Anna Kowalska', email: 'anna@x.pl' });
    expect(t).toMatch(/^Cześć Anna!/);
    expect(t).toContain(inviteLink('anna@x.pl'));
    expect(t).toContain('anna@x.pl');
    expect(t).toMatch(/Do ekranu początkowego/);
    expect(t).toMatch(/Dodaj do ekranu głównego/);
  });
  it('linki SMS, WhatsApp i e-mail', () => {
    expect(smsHref('a b', '600100200')).toBe('sms:+48600100200?body=a%20b');
    expect(smsHref('a', '')).toBe('sms:?body=a');
    expect(waHref('a&b', '+48 600 100 200')).toBe('https://wa.me/48600100200?text=a%26b');
    expect(waHref('a', undefined)).toBe('https://wa.me/?text=a');
    expect(mailHref('x', 'anna@x.pl')).toMatch(/^mailto:anna%40x\.pl\?subject=Zaproszenie.*&body=x$/);
  });
  it('stan: połączony / niepotwierdzony / zaproszony / nie zaproszony', () => {
    expect(inviteState(base(), 'none')).toBe('not-invited');
    expect(inviteState(base({ invitedAt: '2026-10-01T10:00:00Z' }), 'none')).toBe('invited');
    expect(inviteState(base({ invitedAt: '2026-10-01T10:00:00Z' }), 'unconfirmed')).toBe('unconfirmed');
    expect(inviteState(base(), 'active')).toBe('connected');
    // lista kont niedostępna — połączenie widać po wpisach podopiecznego
    expect(inviteState(base(), 'unknown')).toBe('not-invited');
    expect(inviteState(base({ checkins: [{ id: 'k', date: '2026-10-02' } as Client['checkins'][number]] }), 'unknown')).toBe('connected');
  });
});

describe('checklista „Pierwsze kroki”', () => {
  it('nowy klient bez danych — nic nie zrobione', () => {
    const s = onboardingSteps(input());
    expect(s.map((x) => x.id)).toEqual(['contact', 'invite', 'account', 'intake', 'plan', 'billing', 'visit']);
    expect(s.every((x) => !x.done)).toBe(true);
    expect(s[0].note).toMatch(/brak e-maila/);
  });
  it('kroki liczą się z danych', () => {
    expect(done(input({}, { email: 'anna@x.pl' })).contact).toBe(true);
    expect(done(input({}, { email: 'anna@' })).contact).toBe(false);
    expect(done(input({}, { invitedAt: '2026-10-20T08:00:00Z' })).invite).toBe(true);
    // konto założone bez zaproszenia przez aplikację — zaproszenie też „zrobione”
    expect(done(input({ account: 'active' }))).toMatchObject({ invite: true, account: true });
    expect(done(input({ account: 'unconfirmed' }))).toMatchObject({ invite: true, account: false });
    expect(done(input({ plans: 1 })).plan).toBe(true);
    expect(done(input({ appointments: 1 })).visit).toBe(true);
    expect(done(input({ sessions: 2 })).visit).toBe(true);
  });
  it('ankieta: zakończona, same odpowiedzi PAR-Q albo wywiad trenera', () => {
    expect(done(input({}, { intake: { answers: {}, completedAt: '2026-10-02' } })).intake).toBe(true);
    const parq = Object.fromEntries(INTAKE_PARQ.map((k) => [k, 'nie']));
    expect(done(input({}, { intake: { answers: parq } })).intake).toBe(true);
    expect(done(input({}, { intake: { answers: { parq_heart: 'nie' } } })).intake).toBe(false);
    expect(done(input({ healthDone: true })).intake).toBe(true);
  });
  it('pakiet / płatność', () => {
    expect(billingDone(base())).toBe(false);
    expect(billingDone(base({ billing: 'pakiet' }))).toBe(false);
    expect(billingDone(base({ payments: [{ id: 'p', type: 'pakiet', amount: 800, date: '2026-10-01', status: 'due' }] }))).toBe(true);
    expect(billingDone(base({ billing: 'klub' }))).toBe(true);
    expect(billingDone(base({ billing: 'abonament', subRate: 400 }))).toBe(true);
    expect(billingDone(base({ billing: 'pojedyncza', singleRate: 150 }))).toBe(true);
  });
  it('ukończona, gdy wszystkie kroki zrobione', () => {
    const all = input({ account: 'active', plans: 1, healthDone: true, appointments: 1 }, { email: 'anna@x.pl', billing: 'klub' });
    expect(onboardingComplete(onboardingSteps(all))).toBe(true);
    expect(onboardingComplete(onboardingSteps({ ...all, plans: 0 }))).toBe(false);
  });
});
