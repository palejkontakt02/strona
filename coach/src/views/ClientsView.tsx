import { useState } from 'react';
import type { ModalState } from '../components/Modals';
import { Avatar, Tag } from '../components/ui';
import type { CoachActions } from '../data/useCoach';
import type { Client } from '../types';
import { formatDate, nextSession, normalize } from '../utils';
import { ClientDetail, type DetailTab } from './ClientDetail';

interface Props {
  clients: Client[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  tab: DetailTab;
  onTab: (t: DetailTab) => void;
  mobileDetail: boolean;
  onBack: () => void;
  actions: CoachActions;
  openModal: (m: ModalState) => void;
}

export function ClientsView(p: Props) {
  const [query, setQuery] = useState('');
  const q = normalize(query.trim());
  const list = p.clients
    .filter((c) => normalize(c.name).includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  const selected = p.clients.find((c) => c.id === p.selectedId);

  return (
    <div className={`master-detail ${p.mobileDetail ? 'show-detail' : ''}`}>
      <aside className="sidebar">
        <input
          className="input"
          type="search"
          placeholder="Szukaj podopiecznego…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn btn-primary btn-block" onClick={() => p.openModal({ type: 'client' })}>
          + Nowy podopieczny
        </button>
        <ul className="client-list">
          {list.map((c) => {
            const next = nextSession(c.sessions);
            return (
              <li key={c.id}>
                <button className={`client-card ${c.id === p.selectedId ? 'selected' : ''}`} onClick={() => p.onSelect(c.id)}>
                  <Avatar name={c.name} />
                  <div className="client-card-body">
                    <div className="client-card-top">
                      <strong>{c.name}</strong>
                      <Tag>{c.status}</Tag>
                    </div>
                    <div className="muted small">{c.goal}</div>
                    <div className="muted small">
                      {next ? `Sesja: ${formatDate(next.date)} ${next.time}` : 'Brak zaplanowanej sesji'}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
          {list.length === 0 && <li className="empty">Brak wyników.</li>}
        </ul>
      </aside>

      <section className="detail-pane">
        <button className="btn btn-ghost back" onClick={p.onBack}>
          ‹ Wszyscy podopieczni
        </button>
        {selected ? (
          <ClientDetail client={selected} tab={p.tab} onTab={p.onTab} actions={p.actions} openModal={p.openModal} />
        ) : (
          <p className="empty">Wybierz podopiecznego z listy.</p>
        )}
      </section>
    </div>
  );
}
