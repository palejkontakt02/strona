import type { Client, ISODate, Payment } from '../domain';
import { plural } from '../format';
import type { PackageStatus } from './billing';

/** Płatności w aplikacji podopiecznego (karta „Płatności” w zakładce Trener). Czyste funkcje — testy: podopieczny.test.ts. */

const zl = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 });
export const fmtZl = (n: number) => `${zl.format(n).replace(/ /g, ' ')} zł`;
/** „07.11” */
export const dm = (d: ISODate) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
const monthName = (ym: string) => new Date(`${ym}-15T12:00:00`).toLocaleDateString('pl-PL', { month: 'long' });

/** Krótka nazwa płatności: „abonament listopad”, „pakiet 10 sesji”, „sesja 28.10”. */
export function payLabel(p: Payment): string {
  if (p.type === 'abonament') return p.month ? `abonament ${monthName(p.month)}` : 'abonament';
  if (p.type === 'pakiet') return p.sessions ? `pakiet ${p.sessions} ${plural(p.sessions, 'sesja', 'sesje', 'sesji')}` : 'pakiet';
  if (p.type === 'pojedyncza') return `sesja ${dm(p.date)}`;
  return p.desc?.trim() || 'płatność';
}

export interface DueItem {
  id: string;
  amount: number;
  label: string;
  dueDate?: ISODate;
  overdue: boolean;
}

/** Nieopłacone płatności: najpierw zaległe, potem wg terminu. */
export function dueItems(client: Pick<Client, 'payments'>, today: ISODate): DueItem[] {
  return (client.payments ?? [])
    .filter((p) => p.status !== 'paid' && p.amount > 0)
    .map((p) => ({ id: p.id, amount: p.amount, label: payLabel(p), dueDate: p.dueDate, overdue: !!p.dueDate && p.dueDate < today }))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
}

/** „Do zapłaty: 600 zł · abonament listopad · termin 07.11” */
export function dueLine(d: DueItem): string {
  return [`Do zapłaty: ${fmtZl(d.amount)}`, d.label, d.dueDate ? `termin ${dm(d.dueDate)}` : ''].filter(Boolean).join(' · ');
}

/** Data ważności pakietu, jeśli trener ją wpisał (pole opcjonalne płatności). */
export function packageValidTo(payments: Payment[]): ISODate | undefined {
  const last = payments.filter((p) => p.type === 'pakiet').sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0] as (Payment & { validTo?: string; validUntil?: string; expires?: string }) | undefined;
  const v = last?.validTo ?? last?.validUntil ?? last?.expires;
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
}

/** „Pakiet: zostały 3 z 10 (ważny do 30.11)”, „Pakiet: został 1 z 10”, „Pakiet wykorzystany”. */
export function packageLine(st: PackageStatus | null, validTo?: ISODate): string | null {
  if (!st) return null;
  const valid = validTo ? ` (ważny do ${dm(validTo)})` : '';
  if (st.left <= 0) return `Pakiet wykorzystany${st.left < 0 ? ` — ${-st.left} ${plural(-st.left, 'trening', 'treningi', 'treningów')} ponad pakiet` : ''}`;
  const of = st.left > st.size ? st.total : st.size;
  const verb = st.left === 1 ? 'został' : plural(st.left, 'został', 'zostały', 'zostało');
  return `Pakiet: ${verb} ${st.left} z ${of}${valid}`;
}

/** Tytuł przelewu: „Anna Nowak – abonament listopad 2026”. */
export function transferTitle(clientName: string, p: Pick<Payment, 'type' | 'month' | 'date' | 'sessions' | 'desc'>): string {
  const base = payLabel(p as Payment);
  const year = p.type === 'abonament' && p.month ? ` ${p.month.slice(0, 4)}` : '';
  return `${clientName.trim()} – ${base}${year}`.slice(0, 140);
}

export type PaidVia = 'przelew' | 'BLIK';

/** Wiadomość do trenera: „Zapłacone: 600 zł abonament listopad (przelew)”. */
export function paidMessage(d: Pick<DueItem, 'amount' | 'label'>, via: PaidVia): string {
  return `Zapłacone: ${fmtZl(d.amount)} ${d.label} (${via})`;
}

/** Czy podopieczny już zgłosił tę wpłatę (ta sama wiadomość w rozmowie). */
export function reportedAt(client: Pick<Client, 'inbox'>, d: Pick<DueItem, 'amount' | 'label'>): string | null {
  const head = `Zapłacone: ${fmtZl(d.amount)} ${d.label} (`;
  return (client.inbox ?? []).filter((n) => n.text.startsWith(head)).at(-1)?.at ?? null;
}

/** Numer konta czytelnie: grupy po 4 cyfry (26 cyfr NRB: 2 + 6×4). */
export function fmtAccount(v: string): string {
  const d = v.replace(/\s/g, '');
  if (!/^(PL)?\d{26}$/i.test(d)) return v.trim();
  const n = d.replace(/^PL/i, '');
  return `${/^PL/i.test(d) ? 'PL ' : ''}${n.slice(0, 2)} ${n.slice(2).replace(/(\d{4})(?=\d)/g, '$1 ')}`;
}
