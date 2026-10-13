import { useState } from 'react';
import type { ModalState } from '../components/Modals';
import { Empty, Kpi, Tag } from '../components/ui';
import type { CoachActions } from '../data/useCoach';
import type { Client } from '../types';
import { formatDate, formatMoney } from '../utils';
import { PaymentToggle } from './ClientDetail';

const FILTERS = ['Wszystkie', 'Zaległe', 'Opłacone'] as const;
type Filter = (typeof FILTERS)[number];

interface Props {
  clients: Client[];
  actions: CoachActions;
  openModal: (m: ModalState) => void;
  onOpenClient: (id: string) => void;
}

export function PaymentsView({ clients, actions, openModal, onOpenClient }: Props) {
  const [filter, setFilter] = useState<Filter>('Wszystkie');
  const all = clients
    .flatMap((client) => client.payments.map((p) => ({ ...p, client })))
    .sort((a, b) => b.date.localeCompare(a.date) || a.client.name.localeCompare(b.client.name, 'pl'));
  const overdue = all.filter((p) => p.status === 'Zaległe');
  const rows = filter === 'Wszystkie' ? all : all.filter((p) => p.status === filter);

  return (
    <div className="page fade">
      <div className="toolbar">
        <h2>Płatności</h2>
        <button className="btn btn-primary" onClick={() => openModal({ type: 'payment' })}>
          + Dodaj płatność
        </button>
      </div>
      <div className="kpi-grid kpi-grid-3">
        <Kpi label="Suma zaległości" value={formatMoney(overdue.reduce((s, p) => s + p.amount, 0))} />
        <Kpi label="Suma wszystkich płatności" value={formatMoney(all.reduce((s, p) => s + p.amount, 0))} />
        <Kpi label="Podopieczni z zaległością" value={new Set(overdue.map((p) => p.client.id)).size} />
      </div>
      <div className="seg">
        {FILTERS.map((f) => (
          <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <Empty>Brak płatności.</Empty>
      ) : (
        <div className="card table-wrap">
          <table className="table">
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
                    <button className="link" onClick={() => onOpenClient(p.client.id)}>
                      {p.client.name}
                    </button>
                  </td>
                  <td>{formatDate(p.date)}</td>
                  <td>{p.description}</td>
                  <td className="num">{formatMoney(p.amount)}</td>
                  <td>
                    <Tag>{p.status}</Tag>
                  </td>
                  <td className="actions">
                    <PaymentToggle status={p.status} onToggle={(s) => actions.setPaymentStatus(p.client.id, p.id, s)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
