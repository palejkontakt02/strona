import type { Billing, Client, ISODate, Payment, TrainingSession } from '../domain';
import { addDays, todayISO } from './dates';
import { plural } from '../format';

export interface PackageStatus {
  total: number;
  used: number;
  /** Ujemne = „ponad pakiet”. */
  left: number;
  /** Rozmiar ostatnio kupionego pakietu. */
  size: number;
}

/** Pozostało = Σ sesji z płatności „pakiet” − liczba treningów z charge = „pakiet”. */
export function packageStatus(client: Client, sessions: TrainingSession[]): PackageStatus | null {
  const pays = client.payments.filter((p) => p.type === 'pakiet');
  if (pays.length === 0) return null;
  const total = pays.reduce((a, p) => a + (p.sessions || 0), 0);
  // + nieobecności / późne odwołania pobrane z pakietu
  const used = sessions.filter((s) => s.charge === 'pakiet').length + (client.noShowCharges?.length ?? 0);
  const last = [...pays].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  return { total, used, left: total - used, size: last.sessions || 0 };
}

/** Ostrzeżenie przy ≤ 2 pozostałych treningach. */
export const PACKAGE_WARN_AT = 2;

/** Zaległa = nieopłacona i termin minął. */
export function isOverdue(p: Payment, today: ISODate = todayISO()): boolean {
  return p.status !== 'paid' && !!p.dueDate && p.dueDate < today;
}

/** Domyślne rozliczenie treningu: billing klienta, potem pakiet z saldem → abonament → pojedyncza → brak. */
export function defaultCharge(client: Client, sessions: TrainingSession[]): Billing {
  if (client.billing) return client.billing;
  const pk = packageStatus(client, sessions);
  if (pk && pk.left > 0) return 'pakiet';
  if (client.subRate) return 'abonament';
  if (client.singleRate) return 'pojedyncza';
  return pk ? 'pakiet' : 'brak';
}

/**
 * Płatność za sesję pojedynczą tworzona przy zapisie treningu.
 * Domyślnie „zapłacone od razu” (paidDate = data treningu), inaczej „due” z terminem +7 dni.
 */
export function singleSessionPayment(
  id: string,
  date: ISODate,
  amount: number,
  paidNow: boolean,
  desc: string,
): Payment {
  const p: Payment = {
    id,
    type: 'pojedyncza',
    desc,
    amount,
    date,
    dueDate: addDays(date, 7),
    status: paidNow ? 'paid' : 'due',
  };
  if (paidNow) p.paidDate = date;
  return p;
}

/** Komunikat po zapisie treningu z pakietu (left = saldo przed zapisem). */
export function packageMessage(leftBefore: number): string {
  const left = leftBefore - 1;
  if (left === 0) return 'Zapisano. To był ostatni trening z pakietu.';
  if (left < 0) return `Zapisano. ${overPackage(-left)} — czas na nowy pakiet.`;
  return `Zapisano. ${plural(left, 'Został', 'Zostały', 'Zostało')} ${left} ${plural(left, 'trening', 'treningi', 'treningów')} w pakiecie.`;
}

/** „1 trening ponad pakiet”, „3 treningi ponad pakiet”, „5 treningów ponad pakiet”. */
export function overPackage(n: number): string {
  return `${n} ${plural(n, 'trening', 'treningi', 'treningów')} ponad pakiet`;
}

/**
 * Podpowiedź przy formularzu: `left` — saldo z zapisanymi treningami,
 * `consumes` — czy zapis zużyje kolejne wejście (nowy trening albo zmiana rozliczenia na pakiet).
 */
export function packageHint(left: number | null, consumes: boolean): string {
  if (left == null) return 'Klient nie ma wykupionego pakietu.';
  const after = left - (consumes ? 1 : 0);
  if (after < 0) return `Pakiet wykorzystany — po zapisie: ${overPackage(-after)}.`;
  return consumes ? `W pakiecie zostało ${left} (po zapisie: ${after}).` : `W pakiecie zostało ${left}.`;
}

/* ---------- abonamenty miesięczne hurtem (#13) ---------- */

/** „2026-10” → „2026-11” (n może być ujemne). */
export function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/** Domyślny miesiąc do wystawienia: od 20. dnia — następny, wcześniej — bieżący. */
export function defaultSubMonth(today: ISODate = todayISO()): string {
  const ym = today.slice(0, 7);
  return Number(today.slice(8, 10)) >= 20 ? shiftMonth(ym, 1) : ym;
}

/** Domyślny termin: 7. dzień miesiąca; gdy już minął — za 7 dni. */
export function defaultSubDue(month: string, today: ISODate = todayISO()): ISODate {
  const d = `${month}-07`;
  return d < today ? addDays(today, 7) : d;
}

export interface SubCandidate {
  client: Client;
  /** Kwota z profilu (subRate); 0 = brak stawki. */
  amount: number;
  /** Ma już abonament za ten miesiąc — pomijany. */
  issued: boolean;
  /** Domyślnie zaznaczony: aktywny, ze stawką, bez abonamentu za ten miesiąc. */
  checked: boolean;
}

/** Klienci rozliczani abonamentem (bez zakończonych), z informacją, czy mają już abonament za `month`; `fallback` — cena z profilu trenera. */
export function subscriptionCandidates(clients: Client[], month: string, fallback = 0): SubCandidate[] {
  return clients
    .filter((c) => c.billing === 'abonament' && c.status !== 'zakończony')
    .map((client) => {
      const issued = client.payments.some((p) => p.type === 'abonament' && p.month === month);
      const amount = client.subRate || fallback || 0;
      return { client, amount, issued, checked: !issued && amount > 0 && client.status === 'aktywny' };
    })
    .sort((a, b) => Number(a.issued) - Number(b.issued) || a.client.name.localeCompare(b.client.name, 'pl'));
}

/** Nowa płatność „abonament” do zapłaty. */
export function subscriptionPayment(id: string, month: string, amount: number, dueDate: ISODate, today: ISODate): Payment {
  return { id, type: 'abonament', amount, month, date: today, dueDate, status: 'due' };
}
