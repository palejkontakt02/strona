import { useRef, useState } from 'react';
import { Empty, Icon, Kpi, Seg, Tag } from '../components/ui';
import { allPayments, paymentLabel, setPaymentStatus } from '../data/ops';
import { markPaid } from '../data/payActions';
import { useStore } from '../data/store';
import { fmtDate, normalize, plural, pln } from '../format';
import { isOverdue } from '../lib/billing';
import { todayISO } from '../lib/dates';
import { useNav } from '../nav';
import { ClubsPanel } from './ClubsPanel';
import { AddPaymentButton, BulkSubsModal, ChipRow, DueCell, ReminderModal, RemindButton, hasSubscriptionClients } from './payments/PayParts';
import { PaymentsReport } from './payments/PaymentsReport';

const FILTERS = ['Wszystkie', 'Do zapłaty', 'Zaległe', 'Opłacone'] as const;
const TYPES = ['Każdy typ', 'Pakiety', 'Abonamenty', 'Sesje', 'Inne'] as const;
const TYPE_KEY = { Pakiety: 'pakiet', Abonamenty: 'abonament', Sesje: 'pojedyncza', Inne: 'inna' } as const;

export function PaymentsView() {
  const { db, apply, toast } = useStore();
  const { openClient } = useNav();
  const dbRef = useRef(db);
  dbRef.current = db;
  const [remind, setRemind] = useState<{ clientId: string; paymentId: string } | null>(null);
  const [bulk, setBulk] = useState(false);
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
  const [tab, setTab] = useState<'Od klientów' | 'Od klubów' | 'Raport'>('Od klientów');
  const all = allPayments(db);
  const month = today.slice(0, 7);
  const overdue = all.filter((p) => isOverdue(p, today));
  const unpaid = all.filter((p) => p.status !== 'paid');

  const rows = all
    .filter((p) =>
      filter === 'Wszystkie' ? true : filter === 'Opłacone' ? p.status === 'paid' : filter === 'Zaległe' ? isOverdue(p, today) : p.status !== 'paid',
    )
    .filter((p) => (type === 'Każdy typ' ? true : p.type === TYPE_KEY[type]))
    .filter((p) => normalize(p.client.name).includes(normalize(q.trim())))
    // nieopłacone najpierw, od najdawniejszego terminu; opłacone — od najnowszej wpłaty
    .sort((a, b) =>
      a.status !== b.status
        ? a.status === 'paid' ? 1 : -1
        : a.status === 'paid'
          ? (b.paidDate || b.date).localeCompare(a.paidDate || a.date)
          : (a.dueDate || a.date).localeCompare(b.dueDate || b.date),
    );

  return (
    <div className="page fade page-pay">
      <div className="page-head">
        <h2>Płatności</h2>
        <div className="actions">
          {hasSubscriptionClients(db) && (
            <button className="btn btn-secondary btn-sm" onClick={() => setBulk(true)}>
              <Icon name="money" size={16} /> Wystaw abonamenty
            </button>
          )}
          <AddPaymentButton />
        </div>
      </div>
      <Seg options={['Od klientów', 'Od klubów', 'Raport'] as const} value={tab} onChange={setTab} label="Rozliczenia" />
      <div className="section-gap-sm" />
      {tab === 'Raport' ? (
        <PaymentsReport />
      ) : tab === 'Od klubów' ? (
        <ClubsPanel />
      ) : (
        <>
      <div className="kpi-grid kpi-strip">
        <Kpi label="Wpłaty w tym miesiącu" value={pln(all.filter((p) => p.status === 'paid' && (p.paidDate || p.date).startsWith(month)).reduce((a, p) => a + p.amount, 0))} />
        <Kpi label="Do zapłaty" value={pln(unpaid.reduce((a, p) => a + p.amount, 0))} sub={`${unpaid.length} ${plural(unpaid.length, 'pozycja', 'pozycje', 'pozycji')}`} />
        <Kpi label="Zaległe (po terminie)" value={pln(overdue.reduce((a, p) => a + p.amount, 0))} tone={overdue.length ? 'danger' : undefined} />
        <Kpi label="Podopieczni z zaległością" value={new Set(overdue.map((p) => p.client.id)).size} />
      </div>
      <div className="filters">
        <ChipRow a={FILTERS} aValue={filter} onA={setFilter} b={TYPES} bValue={type} onB={setType} />
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
                <th>Wystawiono</th>
                <th>Opis</th>
                <th className="num">Kwota</th>
                <th>Termin</th>
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
                  <td className="nowrap">
                    <DueCell p={p} />
                  </td>
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
                    <RemindButton client={p.client} p={p} onOpen={setRemind} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
        </>
      )}
      {remind && <ReminderModal {...remind} onClose={() => setRemind(null)} />}
      {bulk && <BulkSubsModal onClose={() => setBulk(false)} latest={() => dbRef.current} />}
    </div>
  );
}
