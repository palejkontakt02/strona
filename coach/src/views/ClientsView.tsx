import { useState } from 'react';
import { Avatar, Dot, Icon, Seg, Tag, type Tone } from '../components/ui';
import type { ClientStatus } from '../domain';
import { lastSessionDate, sessionsOf } from '../data/ops';
import { useStore } from '../data/store';
import { ago, ageOf, normalize } from '../format';
import { clientAlerts } from '../lib/alerts';
import { todayISO } from '../lib/dates';
import { CLIENT_TABS, useNav } from '../nav';
import { ClientOverview } from './client/Overview';
import { ClientPlans } from './client/Plans';
import { ClientSessions } from './client/Sessions';
import { ClientMonitoring } from './client/Monitoring';
import { ClientMeasurements } from './client/Measurements';
import { ClientPayments } from './client/Payments';
import { ClientProfile } from './client/Profile';

export const STATUS_TONE: Record<ClientStatus, Tone> = { aktywny: 'accent', pauza: 'neutral', zakończony: 'muted' };
const STATUS_LABEL: Record<ClientStatus, string> = { aktywny: 'Aktywny', pauza: 'Pauza', zakończony: 'Zakończony' };

export function StatusTag({ status }: { status: ClientStatus }) {
  return <Tag tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Tag>;
}

const FILTERS = ['Aktywni', 'Wszyscy'] as const;

export function ClientsView() {
  const { db } = useStore();
  const { clientId, openClient, closeClient, clientTab, setClientTab, openModal, startAthlete } = useNav();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('Aktywni');
  const today = todayISO();

  const q = normalize(query.trim());
  const list = db.clients
    .filter((c) => (filter === 'Aktywni' ? c.status === 'aktywny' : true))
    .filter((c) => normalize(`${c.name} ${c.sport ?? ''}`).includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  const selected = db.clients.find((c) => c.id === clientId);

  return (
    <div className={`master-detail ${selected ? 'show-detail' : ''}`}>
      <aside className="sidebar">
        <input className="input" type="search" placeholder="Szukaj podopiecznego…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="sidebar-row">
          <Seg options={FILTERS} value={filter} onChange={setFilter} label="Filtr" />
          <button className="btn btn-primary btn-sm" onClick={() => openModal({ kind: 'client' })}>
            + Nowy
          </button>
        </div>
        <ul className="client-list">
          {list.map((c) => {
            const alerts = c.status === 'aktywny' ? clientAlerts(c, sessionsOf(db, c.id), today) : [];
            const red = alerts.some((a) => a.level === 'red');
            return (
              <li key={c.id}>
                <button className={`client-card ${c.id === clientId ? 'selected' : ''}`} onClick={() => openClient(c.id, clientTab)}>
                  <Avatar name={c.name} />
                  <div className="client-card-body">
                    <div className="client-card-top">
                      <strong>{c.name}</strong>
                      {alerts.length > 0 ? <Dot tone={red ? 'danger' : 'warn'} /> : <StatusTag status={c.status} />}
                    </div>
                    <div className="muted small ellipsis">{[c.sport, c.goal].filter(Boolean).join(' · ')}</div>
                    <div className="muted small">Ostatni trening: {ago(lastSessionDate(db, c.id))}</div>
                  </div>
                </button>
              </li>
            );
          })}
          {list.length === 0 && <li className="empty">Brak wyników.</li>}
        </ul>
      </aside>

      <section className="detail-pane">
        {selected ? (
          <div className="detail">
            <button className="btn btn-ghost btn-sm back" onClick={closeClient}>
              ‹ Wszyscy podopieczni
            </button>
            <header className="detail-header">
              <Avatar name={selected.name} size={64} />
              <div className="grow">
                <h2>{selected.name}</h2>
                <div className="tags">
                  <StatusTag status={selected.status} />
                  {selected.goal && <Tag outline>{selected.goal}</Tag>}
                </div>
                <div className="muted small">
                  {[
                    ageOf(selected.dob) != null && `${ageOf(selected.dob)} lat`,
                    selected.height && `${selected.height} cm`,
                    selected.sport && (selected.position ? `${selected.sport} (${selected.position})` : selected.sport),
                    selected.level,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              <div className="detail-actions">
                <button className="btn btn-primary" onClick={() => openModal({ kind: 'session', clientId: selected.id })}>
                  Zapisz trening
                </button>
                <button className="btn btn-secondary" onClick={() => startAthlete(selected.id)} title="Widok, który zobaczy zawodnik">
                  <Icon name="play" size={14} /> Tryb zawodnika
                </button>
              </div>
            </header>

            <div className="tabs-scroll">
              <Seg options={CLIENT_TABS} value={clientTab} onChange={setClientTab} label="Zakładki klienta" />
            </div>

            <div className="fade" key={`${selected.id}-${clientTab}`}>
              {clientTab === 'Przegląd' && <ClientOverview client={selected} />}
              {clientTab === 'Plan' && <ClientPlans client={selected} />}
              {clientTab === 'Treningi' && <ClientSessions client={selected} />}
              {clientTab === 'Monitoring' && <ClientMonitoring client={selected} />}
              {clientTab === 'Pomiary i testy' && <ClientMeasurements client={selected} />}
              {clientTab === 'Płatności' && <ClientPayments client={selected} />}
              {clientTab === 'Profil' && <ClientProfile client={selected} />}
            </div>
          </div>
        ) : (
          <p className="empty">Wybierz podopiecznego z listy.</p>
        )}
      </section>
    </div>
  );
}
