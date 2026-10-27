import { useEffect, useState } from 'react';
import type { Client } from '../domain';
import { supabase } from './supabase';

/** Konto w aplikacji (Supabase Auth), widoczne tylko dla trenera. */
export interface Account {
  email: string;
  confirmed: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  is_trainer: boolean;
}

export type AccountsState = { status: 'off' } | { status: 'loading' } | { status: 'missing' } | { status: 'error'; message: string } | { status: 'ok'; list: Account[] };

let cache: AccountsState | null = null;
let pending: Promise<AccountsState> | null = null;
const listeners = new Set<(s: AccountsState) => void>();

async function fetchAccounts(): Promise<AccountsState> {
  const { data, error } = await supabase.rpc('trainer_accounts');
  if (error) {
    // Funkcja jeszcze nie dodana w SQL Editor (PGRST202) albo inny błąd.
    if (error.code === 'PGRST202' || /trainer_accounts/.test(error.message)) return { status: 'missing' };
    return { status: 'error', message: error.message };
  }
  return { status: 'ok', list: (data ?? []) as Account[] };
}

export function refreshAccounts() {
  pending ??= fetchAccounts().then((s) => {
    cache = s;
    pending = null;
    listeners.forEach((l) => l(s));
    return s;
  });
  return pending;
}

/** Lista kont (tylko w chmurze); odświeża się przy powrocie do aplikacji. */
export function useAccounts(cloud: boolean): AccountsState {
  const [state, setState] = useState<AccountsState>(cloud ? (cache ?? { status: 'loading' }) : { status: 'off' });
  useEffect(() => {
    if (!cloud) return;
    listeners.add(setState);
    if (!cache) void refreshAccounts();
    const onVis = () => document.visibilityState === 'visible' && void refreshAccounts();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      listeners.delete(setState);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [cloud]);
  return state;
}

export type AccountStatus = 'none' | 'unconfirmed' | 'active' | 'no-email';

/** Stan konta podopiecznego: dopasowanie po e-mailu z profilu. */
export function accountOf(client: Client, list: Account[]): { status: AccountStatus; account?: Account } {
  const email = client.email?.trim().toLowerCase();
  if (!email) return { status: 'no-email' };
  const account = list.find((a) => a.email === email);
  if (!account) return { status: 'none' };
  return { status: account.confirmed ? 'active' : 'unconfirmed', account };
}

export const ACCOUNT_LABEL: Record<AccountStatus, string> = {
  active: 'ma konto',
  unconfirmed: 'e-mail niepotwierdzony',
  none: 'brak konta',
  'no-email': 'brak e-maila w profilu',
};

/** Stan konta dla checklisty i zaproszeń (lib/onboarding.ts): 'unknown', gdy lista kont jest niedostępna. */
export function accountKnown(client: Client, state: AccountsState): import('../lib/onboarding').AccountKnown {
  return state.status === 'ok' ? accountOf(client, state.list).status : 'unknown';
}
