import { useState } from 'react';
import { Empty, Kpi, Seg, Tag } from '../components/ui';
import { allPayments, paymentLabel, setPaymentStatus } from '../data/ops';
import { markPaid } from '../data/payActions';
import { useStore } from '../data/store';
import { fmtDate, normalize, pln } from '../format';
import { isOverdue } from '../lib/billing';
import { todayISO } from '../lib/dates';
import { useNav } from '../nav';
import { ClubsPanel } from './ClubsPanel';

const FILTERS = ['Wszystkie', 'Do zapłaty', 'Zaległe', 'Opłacone'] as const;
const TYPES = ['Każdy typ', 'Pakiety', 'Abonamenty', 'Sesje'] as const;
const TYPE_KEY = { Pakiety: 'pakiet', Abonamenty: 'abonament', Sesje: 'pojedyncza' } as const;

export function PaymentsView() {
  const { db, apply, toast } = useStore();
  const { openClient, openModal } = useNav();
  const today = todayISO();
  // domyślnie to, co trzeba ściągnąć; kafel „Zaległości” z Pulpitu otwiera od razu zaległe
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>(() => {
    try {
      const f = sessionStorage.getItem('payments-filter');
      sessionStorage.removeItem('payments-filter');
      if (f && (FILTERS as readonly string[]).includes(f)) return f as (typeof FILTERS)[number];
    } catch {
      /* bez sessionStorage */
    }
    return 'Do zapłaty';
  });
  const [type, setType] = useState<(typeof TYPES)[number]>('Każdy typ');
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'Od klientów' | 'Od klubów'>('Od klientów');
  const all = allPayments(db);
  const month = today.slice(0, 7);
  const overdue = all.filter((p) => isOverdue(p, today));
  const unpaid = all.filter((p) => p.status !== 'paid');

  const rows = all
    .filter((p) =>
      filter === 'Wszystkie' ? true : filter === 'Opłacone' ? p.status === 'paid' : filter === 'Zaległe' ? isOverdue(p, today) : p.status !== 'paid',
    )
    .filter((p) => (type === 'Każdy typ' ? true : p.type === TYPE_KEY[type]))
    .filter((p) => normalize(p.client.name).includes(normalize(q.trim())));

  return (
    <div className="page fade page-pay">
      <div className="page-head">
        <h2>Płatności</h2>
        <div className="actions">
          <button className="btn btn-secondary btn-sm" onClick={() => openModal({ kind: 'payment', type: 'pakiet' })}>
            + Pakiet
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => openModal({ kind: 'payment', type: 'abonament' })}>
            + Abonament
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => openModal({ kind: 'payment', type: 'pojedyncza' })}>
            + Sesja
          </button>
        </div>
      </div>
      <Seg options={['Od klientów', 'Od klubów'] as const} value={tab} onChange={setTab} label="Rozliczenia" />
      <div className="section-gap-sm" />
      {tab === 'Od klubów' ? (
        <ClubsPanel />
      ) : (
        <>
      <div className="kpi-grid kpi-strip">
        <Kpi label="Wpłaty w tym miesiącu" value={pln(all.filter((p) => p.status === 'paid' && (p.paidDate || p.date).startsWith(month)).reduce((a, p) => a + p.amount, 0))} />
        <Kpi label="Do zapłaty" value={pln(unpaid.reduce((a, p) => a + p.amount, 0))} sub={`${unpaid.length} pozycji`} />
        <Kpi label="Zaległe (po terminie)" value={pln(overdue.reduce((a, p) => a + p.amount, 0))} tone={overdue.length ? 'danger' : undefined} />
        <Kpi label="Podopieczni z zaległością" value={new Set(overdue.map((p) => p.client.id)).size} />
      </div>
      <div className="filters">
        <Seg options={FILTERS} value={filter} onChange={setFilter} label="Status" />
        <Seg options={TYPES} value={type} onChange={setType} label="Typ" />
        <input className="input input-sm" type="search" placeholder="Szukaj klienta…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {rows.length === 0 ? (
        <Empty>Brak płatności.</Empty>
      ) : (
        <div className="card table-wrap">
          <table className="table table-cards">
            <thead>
              <tr>
                <th>Podopieczny</th>
                <th>Data</th>
                <th>Opis</th>
                <th className="num">Kwota</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <button className="link" onClick={() => openClient(p.client.id, 'Płatności')}>
                      {p.client.name}
                    </button>
                  </td>
                  <td className="nowrap">{fmtDate(p.date)}</td>
                  <td>{paymentLabel(p)}</td>
                  <td className="num">{pln(p.amount)}</td>
                  <td>{p.status === 'paid' ? <Tag tone="ok">Opłacone</Tag> : isOverdue(p, today) ? <Tag tone="danger">Zaległe</Tag> : <Tag>Do zapłaty</Tag>}</td>
                  <td className="actions">
                    {p.status === 'paid' ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => apply([setPaymentStatus(p.client, p.id, false, today)])}>
                        Cofnij
                      </button>
                    ) : (
                      <button className="btn btn-secondary btn-sm" onClick={() => void markPaid({ apply, toast }, p.client, p.id, today)}>
                        Oznacz opłacone
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
        </>
      )}
    </div>
  );
}
