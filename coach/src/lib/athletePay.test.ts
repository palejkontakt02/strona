import { describe, expect, it } from 'vitest';
import type { Payment } from '../domain';
import { paidInYear, paidItems } from './athletePay';

const pay = (p: Partial<Payment>): Payment => ({ id: Math.random().toString(36).slice(2), type: 'pojedyncza', amount: 100, date: '2026-10-01', status: 'paid', ...p });

describe('historia wpłat podopiecznego', () => {
  const payments = [
    pay({ id: 'a', type: 'abonament', month: '2026-10', amount: 400, date: '2026-10-01', paidDate: '2026-10-03', method: 'przelew' }),
    pay({ id: 'b', type: 'pakiet', sessions: 10, amount: 1200, date: '2026-11-02', paidDate: '2026-11-02', doc: 'FV 12/2026' }),
    pay({ id: 'c', amount: 150, date: '2026-11-10', status: 'due' }),
    pay({ id: 'd', amount: 120, date: '2025-12-20' }),
  ];
  const items = paidItems({ payments });
  it('tylko opłacone, od najnowszej wpłaty; data wpłaty, a bez niej data płatności', () => {
    expect(items.map((x) => [x.id, x.date])).toEqual([['b', '2026-11-02'], ['a', '2026-10-03'], ['d', '2025-12-20']]);
    expect(items[0]).toMatchObject({ label: 'pakiet 10 sesji', doc: 'FV 12/2026' });
    expect(items[1]).toMatchObject({ label: 'abonament październik', method: 'przelew' });
  });
  it('suma w roku', () => {
    expect(paidInYear(items, '2026')).toBe(1600);
    expect(paidInYear(items, '2025')).toBe(120);
  });
});
