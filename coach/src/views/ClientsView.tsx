import { consentWithdrawn, erasureStatus } from '../lib/rodo';
import type { Client as RodoClient } from '../domain';
import { AccountBadge } from '../components/accounts';
import { useAccounts } from '../data/accounts';
import { useState } from 'react';
import { Avatar, Dot, Icon, Seg, Tag, type Tone } from '../components/ui';
import type { ClientStatus } from '../domain';
import { lastSessionDate, sessionsOf } from '../data/ops';
import { useStore } from '../data/store';
import { needsReview } from '../data/videos';
import { ago, ageOf, fmtDay, fmtWeekday, normalize } from '../format';
import { clientAlerts } from '../lib/alerts';
import { healthFlags, trainerNotesOf } from './client/Health';
import { todayISO } from '../lib/dates';
import { CLIENT_TABS, useNav } from '../nav';
import { ClientOverview } from './client/Overview';
import { ClientPlans } from './client/Plans';
import { ClientSessions } from './client/Sessions';
import { ClientMonitoring } from './client/Monitoring';
import { ClientMeasurements } from './client/Measurements';
import { ClientPayments } from './client/Payments';
import { ClientProfile } from './client/Profile';
import { OverviewTable } from './OverviewTable';

const MODES = ['Lista', 'Tabela'] as const;
type Mode = (typeof MODES)[number];
const MODE_KEY = 'fitowa-clients-mode';
function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'Tabela' ? 'Tabela' : 'Lista';
  } catch {
    return 'Lista';
  }
}

export const STATUS_TONE: Record<ClientStatus, Tone> = { aktywny: 'accent', pauza: 'neutral', zakończony: 'muted' };
const STATUS_LABEL: Record<ClientStatus, string> = { aktywny: 'Aktywny', pauza: 'Pauza', zakończony: 'Zakończony' };

export function StatusTag({ status }: { status: ClientStatus }) {
  return <Tag tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Tag>;
}

const FILTERS = ['Aktywni', 'Wszyscy'] as const;

export function ClientsView() {
  const { db, cloud } = useStore();
  const accounts = useAccounts(cloud);
  const { clientId, openClient, closeClient, clientTab, setClientTab, openModal, startAthlete, startLive } = useNav();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('Aktywni');
  // telefon: lista kart albo tabela wszystkich (na komputerze tabela jest w prawym panelu)
  const [mode, setModeState] = useState<Mode>(readMode);
  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* bez localStorage — tylko w tej karcie */
    }
  };
  const today = todayISO();

  const q = normalize(query.trim());
  const list = db.clients
    .filter((c) => (filter === 'Aktywni' ? c.status === 'aktywny' : true))
    // szukanie także po celu, poziomie, urazach, notatkach, kontakcie i miejscu (np. „ACL”, „powrót”, „online”)
    .filter((c) => !q || normalize([c.name, c.sport, c.position, c.goal, c.level, c.injuries, c.notes, c.phone, c.email, db.locations.find((l) => l.id === c.locationId)?.name].filter(Boolean).join(' ')).includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  const selected = db.clients.find((c) => c.id === clientId);

  return (
    <div className={`master-detail ${selected ? 'show-detail' : ''}`}>
      <aside className={`sidebar${mode === 'Tabela' ? ' sidebar-table' : ''}`}>
        <div className="cl-mode">
          <Seg options={MODES} value={mode} onChange={setMode} label="Widok podopiecznych" />
        </div>
        <input className="input" type="search" placeholder="Szukaj: imię, cel, uraz, miejsce…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="sidebar-row">
          <Seg options={FILTERS} value={filter} onChange={setFilter} label="Filtr" />
          <button className="btn btn-primary btn-sm" onClick={() => openModal({ kind: 'client' })}>
            + Nowy
          </button>
        </div>
        <ul className="client-list">
          {list.map((c) => {
            const alerts = c.status === 'aktywny' ? clientAlerts(c, sessionsOf(db, c.id), today, healthFlags(trainerNotesOf(db.trainer_notes, c.id).health, c.intake)) : [];
            const red = alerts.some((a) => a.level === 'red');
            // najbliższa zaplanowana wizyta — tylko do wyświetlenia na karcie
            const next = db.appointments
              .filter((a) => a.clientId === c.id && a.status === 'planned' && a.date >= today)
              .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
            return (
              <li key={c.id}>
                <button className={`client-card ${c.id === clientId ? 'selected' : ''}`} onClick={() => openClient(c.id, clientTab)}>
                  <Avatar name={c.name} />
                  <div className="client-card-body">
                    <div className="client-card-top">
                      <strong>{c.name}</strong>
                      <span className="row-inline">
                        {(() => {
                          const n = db.sessions.filter((x) => x.clientId === c.id && needsReview(x)).length;
                          return n > 0 ? (
                            <Tag tone="accent">
                              <span aria-label="nagrania do obejrzenia"><Icon name="cam" size={13} /> {n}</span>
                            </Tag>
                          ) : null;
                        })()}
                        {(c.inbox ?? []).some((n) => !n.read) && (
                          <Tag tone="warn">
                            <span aria-label="nowe wiadomości"><Icon name="mail" size={13} /> {(c.inbox ?? []).filter((n) => !n.read).length}</span>
                          </Tag>
                        )}
                        {(c.weeklyReports ?? []).some((r) => !r.seenAt) && (
                          <Tag tone="accent">
                            <span aria-label="nowy raport tygodniowy"><Icon name="clipboard" size={13} /> {(c.weeklyReports ?? []).filter((r) => !r.seenAt).length}</span>
                          </Tag>
                        )}
                        {alerts.length > 0 ? <Dot tone={red ? 'danger' : 'warn'} /> : <StatusTag status={c.status} />}
                      </span>
                    </div>
                    <div className="muted small ellipsis">{[c.sport, c.goal].filter(Boolean).join(' · ')}</div>
                    <div className="muted small row-inline client-card-meta">
                      <span className="client-last">Ostatni trening: {ago(lastSessionDate(db, c.id))}</span>
                      {next && (
                        <span className={`client-next ${next.date === today ? 'is-today' : ''}`} title="Najbliższa wizyta">
                          <Icon name="cal" size={13} />
                          {next.date === today ? 'dziś' : `${fmtWeekday(next.date)} ${fmtDay(next.date)}`}, {next.time}
                        </span>
                      )}
                      <AccountBadge client={c} state={accounts} />
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
          {list.length === 0 && <li className="empty">Brak wyników.</li>}
        </ul>
        {mode === 'Tabela' && !selected && (
          <div className="cl-table-mobile">
            <OverviewTable compact />
          </div>
        )}
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
                <button className="btn btn-primary" onClick={() => startLive(selected.id)} title="Prowadź trening 1:1 na żywo, seria po serii">
                  <Icon name="play" size={14} /> Prowadź trening
                </button>
                <button className="btn btn-secondary" onClick={() => startAthlete(selected.id)} title="Widok, który zobaczy zawodnik">
                  Tryb zawodnika
                </button>
                <button
                  className="btn btn-secondary"
                  title="Trening poza planem na wybrany dzień — podopieczny zobaczy go na górze ekranu"
                  onClick={() => openModal({ kind: 'assign', clientId: selected.id })}
                >
                  + Zadaj trening
                </button>
              </div>
            </header>

            <ConsentAlerts client={selected} />

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
          <div className="cl-overview">
            <OverviewTable />
          </div>
        )}
      </section>
    </div>
  );
}

/** RODO: wycofane zgody / prośba o usunięcie konta — bursztynowa informacja dla trenera. */
function ConsentAlerts({ client }: { client: RodoClient }) {
  const items: string[] = [];
  if (consentWithdrawn(client, 'health')) items.push('Wycofał(a) zgodę na dane o zdrowiu — usuń urazy, ankietę i samopoczucie albo zakończ współpracę.');
  if (consentWithdrawn(client, 'media')) items.push('Wycofał(a) zgodę na zdjęcia i nagrania — usuń zdjęcia sylwetki i nagrania techniki.');
  const er = erasureStatus(client);
  if (er.state !== 'none') items.push('Prośba o usunięcie konta — usuń klienta w panelu, konto w Supabase (Authentication → Users) i jego pliki w Storage.');
  if (!items.length) return null;
  return (
    <div className="consent-alert" role="status">
      {items.map((t) => (
        <p key={t}>
          <Icon name="alert" size={14} /> {t}
        </p>
      ))}
    </div>
  );
}
