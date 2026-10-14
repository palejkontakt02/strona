import { describe, expect, it } from 'vitest';
import { accountOf, type Account } from '../data/accounts';
import type { Client } from '../domain';

const c = (email?: string): Client => ({ id: 'c', name: 'A', status: 'aktywny', email, payments: [], measurements: [], tests: [], injuryLog: [], checkins: [] });
const acc = (email: string, confirmed: boolean): Account => ({ email, confirmed, created_at: '2026-10-14T10:00:00Z', last_sign_in_at: null, is_trainer: false });

describe('accountOf', () => {
  const list = [acc('kasia@x.pl', true), acc('tomek@x.pl', false)];
  it('matches by e-mail regardless of case and spaces', () => expect(accountOf(c(' Kasia@X.pl '), list).status).toBe('active'));
  it('unconfirmed account', () => expect(accountOf(c('tomek@x.pl'), list).status).toBe('unconfirmed'));
  it('no account / no e-mail', () => {
    expect(accountOf(c('ola@x.pl'), list).status).toBe('none');
    expect(accountOf(c(), list).status).toBe('no-email');
  });
});
