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
