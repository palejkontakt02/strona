import type { ISODate, Payment } from '../domain';
import { fmtDate, pln } from '../format';
import { daysBetween, todayISO } from './dates';
import { plural } from '../format';

/** Dane trenera potrzebne w przypomnieniu (podzbiór TrainerProfile z data/trainerProfile). */
export interface ReminderTrainer {
  name?: string;
  phone?: string;
  bankAccount?: string;
  bankName?: string;
  blikPhone?: string;
}

const TYPE_TITLE = { pakiet: 'Pakiet', abonament: 'Abonament', pojedyncza: 'Sesja', inna: 'Płatność' } as const;

/** „11.2026” — miesiąc, którego dotyczy płatność (abonament: jego miesiąc; inaczej termin albo data). */
export function payPeriod(p: Payment): string {
  const ym = (p.type === 'abonament' && p.month) || (p.dueDate || p.date || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym)) return '';
  return `${ym.slice(5, 7)}.${ym.slice(0, 4)}`;
}

/** Krótki opis do tytułu przelewu: własna nazwa albo typ („Abonament”, „Pakiet 10 sesji”). */
export function payShortDesc(p: Payment, label: string): string {
  if (p.type === 'abonament') return 'Abonament';
  return label.trim() || TYPE_TITLE[p.type];
}

/** Tytuł przelewu: „Anna Kowalska – Abonament – 11.2026”. */
export function transferTitle(clientName: string, p: Payment, label: string): string {
  return [clientName.trim(), payShortDesc(p, label), payPeriod(p)].filter(Boolean).join(' – ');
}

/** Ile dni po terminie (0 = w terminie / bez terminu). */
export function daysOverdue(p: Payment, today: ISODate = todayISO()): number {
  if (p.status === 'paid' || !p.dueDate) return 0;
  return Math.max(0, daysBetween(p.dueDate, today));
}

/** „3 dni po terminie”, „1 dzień po terminie”. */
export function overdueText(n: number): string {
  return `${n} ${plural(n, 'dzień', 'dni', 'dni')} po terminie`;
}

/** „przypomniano dziś / wczoraj / 2 dni temu”. */
export function remindedText(iso?: ISODate, today: ISODate = todayISO()): string {
  if (!iso) return '';
  const d = daysBetween(iso.slice(0, 10), today);
  return `przypomniano ${d <= 0 ? 'dziś' : d === 1 ? 'wczoraj' : `${d} dni temu`}`;
}

/** Numer konta czytelnie: grupy po 4 cyfry (26 cyfr: „12 3456 …”). */
export function fmtAccount(acc: string): string {
  const d = acc.replace(/\s+/g, '').toUpperCase();
  if (/^(PL)?\d{26}$/.test(d)) {
    const pl = d.startsWith('PL') ? 'PL' : '';
    const n = d.slice(pl.length);
    return pl + n.slice(0, 2) + ' ' + n.slice(2).replace(/(\d{4})(?=\d)/g, '$1 ');
  }
  return acc.trim();
}

/** Gotowa treść przypomnienia o płatności. */
export function reminderText(clientName: string, p: Payment, label: string, t: ReminderTrainer, today: ISODate = todayISO()): string {
  const first = clientName.trim().split(/\s+/)[0] || '';
  const late = daysOverdue(p, today);
  const due = p.dueDate ? (late > 0 ? `termin minął ${fmtDate(p.dueDate)}` : `termin: ${fmtDate(p.dueDate)}`) : '';
  const lines = [
    `Cześć${first ? ` ${first}` : ''}! Przypominam o płatności: ${label} – ${pln(p.amount)}${due ? ` (${due})` : ''}.`,
  ];
  const pay: string[] = [];
  if (t.bankAccount?.trim()) {
    pay.push(`Przelew: ${fmtAccount(t.bankAccount)}${t.bankName?.trim() ? ` (${t.bankName.trim()})` : ''}${t.name?.trim() ? `, odbiorca: ${t.name.trim()}` : ''}`);
    pay.push(`Tytuł przelewu: ${transferTitle(clientName, p, label)}`);
  }
  if (t.blikPhone?.trim()) pay.push(`BLIK na telefon: ${t.blikPhone.trim()}`);
  if (pay.length) lines.push('', ...pay);
  lines.push('', `Dziękuję!${t.name?.trim() ? ` ${t.name.trim().split(/\s+/)[0]}` : ''}`);
  return lines.join('\n');
}

/** Link „sms:” z treścią (numer z +48, gdy podano 9 cyfr). */
export function smsHref(phone: string | undefined, body: string): string {
  let n = (phone ?? '').replace(/[^\d+]/g, '');
  if (/^\d{9}$/.test(n)) n = '+48' + n;
  else if (/^48\d{9}$/.test(n)) n = '+' + n;
  return `sms:${n}?body=${encodeURIComponent(body)}`;
}
