import type { Appointment, Client, ISODate, Location, PayMethod, Payment, PaymentType, TrainingSession, YearMonth } from '../domain';
import { shiftMonth } from './billing';

/** Formy wpłaty w kolejności wyświetlania. */
export const PAY_METHODS: readonly PayMethod[] = ['gotówka', 'przelew', 'blik', 'karta', 'inna'];
export const PAY_METHOD_LABEL: Record<PayMethod, string> = { gotówka: 'Gotówka', przelew: 'Przelew', blik: 'BLIK', karta: 'Karta', inna: 'Inna' };

/** Rodzaje w raporcie: typy płatności + wypłaty od klubów. */
export type ReportKind = PaymentType | 'klub';
export const REPORT_KINDS: readonly ReportKind[] = ['pakiet', 'abonament', 'pojedyncza', 'klub', 'inna'];
export const REPORT_KIND_LABEL: Record<ReportKind, string> = { pakiet: 'Pakiet', abonament: 'Abonament', pojedyncza: 'Sesja', klub: 'Klub', inna: 'Inna' };

export interface ReportInput {
  clients: Client[];
  sessions: TrainingSession[];
  locations?: Location[];
  appointments?: Appointment[];
}

/** Jedna wpłata (od klienta albo wypłata klubu) w raporcie / eksporcie. */
export interface ReportRow {
  /** Data księgowa: wpłaty (opłacone) albo wystawienia (nieopłacone). */
  date: ISODate;
  client: string;
  clientId?: string;
  desc: string;
  kind: ReportKind;
  amount: number;
  method?: PayMethod;
  doc?: string;
  status: 'paid' | 'due';
  dueDate?: ISODate;
}

export interface Bucket<K extends string = string> {
  key: K;
  label: string;
  amount: number;
  count: number;
}

export interface MonthReport {
  month: YearMonth;
  /** Suma wpłat w miesiącu (klienci + kluby). */
  total: number;
  count: number;
  byMethod: Bucket<PayMethod | 'brak'>[];
  byKind: Bucket<ReportKind>[];
  byClient: Bucket[];
  /** Zaległości na koniec miesiąca (bieżący miesiąc: na dziś): termin minął, nieopłacone do tego dnia. */
  arrears: { amount: number; count: number; clients: number };
  /** Dzień, na który liczone są zaległości i pakiety (koniec miesiąca albo dziś). */
  asOf: ISODate;
  /** Wartość niewykorzystanych sesji z pakietów na koniec miesiąca. */
  unusedPackages: { sessions: number; value: number; clients: number };
  prevMonth: YearMonth;
  prevTotal: number;
  /** total − prevTotal */
  diff: number;
  /** Zmiana w % względem poprzedniego (null, gdy poprzedni = 0). */
  diffPct: number | null;
}

export const monthEnd = (ym: YearMonth): ISODate => {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

const paidOn = (p: Payment) => p.paidDate || p.date;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Wpłaty w miesiącu (opłacone, wg daty wpłaty) — od klientów i wypłaty od klubów. */
export function paidRows(input: ReportInput, month: YearMonth, label: (p: Payment) => string): ReportRow[] {
  const rows: ReportRow[] = [];
  for (const c of input.clients)
    for (const p of c.payments)
      if (p.status === 'paid' && paidOn(p).startsWith(month))
        rows.push({ date: paidOn(p), client: c.name, clientId: c.id, desc: label(p), kind: p.type, amount: p.amount, method: p.method, doc: p.doc, status: 'paid', dueDate: p.dueDate });
  for (const l of input.locations ?? [])
    for (const po of l.payouts ?? [])
      if (po.paidDate?.startsWith(month))
        rows.push({ date: po.paidDate, client: l.name, desc: `Wypłata klubu za ${po.month.slice(5, 7)}.${po.month.slice(0, 4)}${po.sessions ? ` (${po.sessions} tr.)` : ''}`, kind: 'klub', amount: po.amount, status: 'paid', doc: po.note });
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.client.localeCompare(b.client, 'pl'));
}

/** Wiersze eksportu: wpłaty w miesiącu + nieopłacone wystawione w miesiącu (status „do zapłaty”). */
export function exportRows(input: ReportInput, month: YearMonth, label: (p: Payment) => string): ReportRow[] {
  const rows = paidRows(input, month, label);
  for (const c of input.clients)
    for (const p of c.payments)
      if (p.status !== 'paid' && (p.date || '').startsWith(month))
        rows.push({ date: p.date, client: c.name, clientId: c.id, desc: label(p), kind: p.type, amount: p.amount, method: p.method, doc: p.doc, status: 'due', dueDate: p.dueDate });
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.client.localeCompare(b.client, 'pl'));
}

/** Zaległości na koniec miesiąca (stan „na tamten dzień”, też gdy później opłacone). */
export function arrearsAt(clients: Client[], end: ISODate): { amount: number; count: number; clients: number } {
  let amount = 0;
  let count = 0;
  const who = new Set<string>();
  for (const c of clients)
    for (const p of c.payments) {
      if (!p.dueDate || p.dueDate >= end) continue; // zaległa = termin minął przed końcem dnia `end`
      const paidBy = p.status === 'paid' && paidOn(p) <= end;
      if (paidBy) continue;
      amount += p.amount;
      count++;
      who.add(c.id);
    }
  return { amount: round2(amount), count, clients: who.size };
}

/** Niewykorzystane sesje z pakietów na dzień `end`; wartość wg ceny za sesję z ostatniego pakietu. */
export function unusedPackagesAt(input: ReportInput, end: ISODate): { sessions: number; value: number; clients: number } {
  const apptDate = new Map((input.appointments ?? []).map((a) => [a.id, a.date]));
  let sessions = 0;
  let value = 0;
  let clients = 0;
  for (const c of input.clients) {
    const pkgs = c.payments.filter((p) => p.type === 'pakiet' && (p.date || '') <= end).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    if (!pkgs.length) continue;
    const total = pkgs.reduce((a, p) => a + (p.sessions || 0), 0);
    const used =
      input.sessions.filter((s) => s.clientId === c.id && s.charge === 'pakiet' && s.date <= end).length +
      (c.noShowCharges ?? []).filter((id) => (apptDate.get(id) ?? '') <= end).length;
    const left = total - used;
    if (left <= 0) continue;
    const last = pkgs[pkgs.length - 1];
    const unit = last.sessions ? last.amount / last.sessions : 0;
    sessions += left;
    value += left * unit;
    clients++;
  }
  return { sessions, value: round2(value), clients };
}

function bucketize<K extends string>(rows: ReportRow[], key: (r: ReportRow) => K, labelOf: (k: K, r: ReportRow) => string, order?: readonly K[]): Bucket<K>[] {
  const m = new Map<K, Bucket<K>>();
  for (const r of rows) {
    const k = key(r);
    const b = m.get(k) ?? { key: k, label: labelOf(k, r), amount: 0, count: 0 };
    b.amount = round2(b.amount + r.amount);
    b.count++;
    m.set(k, b);
  }
  const list = [...m.values()];
  return order ? list.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)) : list.sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label, 'pl'));
}

/** Raport miesięczny wpłat. */
export function monthReport(input: ReportInput, month: YearMonth, label: (p: Payment) => string, today?: ISODate): MonthReport {
  const rows = paidRows(input, month, label);
  const total = round2(rows.reduce((a, r) => a + r.amount, 0));
  const prevMonth = shiftMonth(month, -1);
  const prevTotal = round2(paidRows(input, prevMonth, label).reduce((a, r) => a + r.amount, 0));
  const end = monthEnd(month);
  const asOf = today && today < end ? today : end;
  return {
    month,
    total,
    count: rows.length,
    byMethod: bucketize(rows, (r) => r.method ?? 'brak', (k) => (k === 'brak' ? 'Bez formy' : PAY_METHOD_LABEL[k]), [...PAY_METHODS, 'brak'] as const),
    byKind: bucketize(rows, (r) => r.kind, (k) => REPORT_KIND_LABEL[k], REPORT_KINDS),
    byClient: bucketize(rows, (r) => r.clientId ?? `klub:${r.client}`, (_k, r) => r.client),
    arrears: arrearsAt(input.clients, asOf),
    asOf,
    unusedPackages: unusedPackagesAt(input, asOf),
    prevMonth,
    prevTotal,
    diff: round2(total - prevTotal),
    diffPct: prevTotal ? Math.round(((total - prevTotal) / prevTotal) * 1000) / 10 : null,
  };
}

/* ---------- CSV dla księgowej ---------- */

const csvCell = (v: string) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
/** 1234.5 → „1234,50” (bez separatora tysięcy — arkusze czytają to jako liczbę). */
export const csvAmount = (n: number) => n.toFixed(2).replace('.', ',');
/** 2026-10-07 → 07.10.2026 */
const csvDate = (iso?: ISODate) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');

export const CSV_HEADER = ['Data', 'Klient', 'Opis', 'Rodzaj', 'Kwota', 'Forma', 'Dokument', 'Status', 'Termin'];

/** CSV: UTF-8 z BOM, średnik, przecinek dziesiętny, CRLF. */
export function toCsv(rows: ReportRow[]): string {
  const lines = [CSV_HEADER.join(';')];
  for (const r of rows)
    lines.push(
      [
        csvDate(r.date),
        r.client,
        r.desc,
        REPORT_KIND_LABEL[r.kind],
        csvAmount(r.amount),
        r.method ? PAY_METHOD_LABEL[r.method] : '',
        r.doc ?? '',
        r.status === 'paid' ? 'Opłacone' : 'Do zapłaty',
        csvDate(r.dueDate),
      ]
        .map(csvCell)
        .join(';'),
    );
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export const csvFileName = (month: YearMonth) => `fitowa-platnosci-${month}.csv`;
