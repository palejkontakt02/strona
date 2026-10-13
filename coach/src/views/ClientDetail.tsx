import type { ModalState } from '../components/Modals';
import { Avatar, Empty, Kpi, Tag } from '../components/ui';
import type { CoachActions } from '../data/useCoach';
import type { Client } from '../types';
import { compareSessions, formatDate, formatMoney, formatNum, formatShortDate, nextSession } from '../utils';

export const DETAIL_TABS = ['Przegląd', 'Plan', 'Postępy', 'Sesje', 'Płatności'] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];

interface Props {
  client: Client;
  tab: DetailTab;
  onTab: (t: DetailTab) => void;
  actions: CoachActions;
  openModal: (m: ModalState) => void;
}

export function ClientDetail({ client, tab, onTab, actions, openModal }: Props) {
  const meta = [client.age && `${client.age} lat`, client.height && `${client.height} cm`].filter(Boolean).join(' · ');
  return (
    <div className="detail">
      <header className="detail-header">
        <Avatar name={client.name} size={64} />
        <div>
          <h2>{client.name}</h2>
          <div className="tags">
            <Tag>{client.status}</Tag>
            <Tag outline>{client.goal}</Tag>
          </div>
          {meta && <div className="muted small">{meta}</div>}
        </div>
      </header>

      <div className="seg" role="tablist">
        {DETAIL_TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => onTab(t)}>
            {t}
          </button>
        ))}
      </div>

      <div className="fade" key={`${client.id}-${tab}`}>
        {tab === 'Przegląd' && <Overview client={client} />}
        {tab === 'Plan' && <PlanTab client={client} actions={actions} openModal={openModal} />}
        {tab === 'Postępy' && <ProgressTab client={client} openModal={openModal} />}
        {tab === 'Sesje' && <SessionsTab client={client} actions={actions} openModal={openModal} />}
        {tab === 'Płatności' && <PaymentsTab client={client} actions={actions} openModal={openModal} />}
      </div>
    </div>
  );
}

function Overview({ client }: { client: Client }) {
  const done = client.sessions.filter((s) => s.status === 'Odbyta').length;
  const overdue = client.payments.filter((p) => p.status === 'Zaległe').reduce((sum, p) => sum + p.amount, 0);
  const next = nextSession(client.sessions);
  return (
    <>
      <div className="kpi-grid">
        <Kpi
          label="Waga aktualna"
          value={client.currentWeight !== undefined ? `${formatNum(client.currentWeight)} kg` : '—'}
          sub={client.targetWeight !== undefined ? `cel: ${formatNum(client.targetWeight)} kg` : undefined}
        />
        <Kpi label="Sesje odbyte" value={done} sub="łącznie w historii" />
        <Kpi
          label="Zaległe płatności"
          value={formatMoney(overdue)}
          sub={overdue > 0 ? 'wymaga uwagi' : 'wszystko opłacone'}
        />
        <Kpi
          label="Następna sesja"
          value={next ? formatDate(next.date) : '—'}
          sub={next ? `${next.time} · ${next.type}` : 'brak w planie'}
        />
      </div>
      <div className="card contact">
        <h4>Kontakt</h4>
        <div>
          {client.email ? <a href={`mailto:${client.email}`}>{client.email}</a> : <span className="muted">brak e-maila</span>}
        </div>
        <div>
          {client.phone ? <a href={`tel:${client.phone.replace(/\s/g, '')}`}>{client.phone}</a> : <span className="muted">brak telefonu</span>}
        </div>
      </div>
    </>
  );
}

function PlanTab({ client, actions, openModal }: Omit<Props, 'tab' | 'onTab'>) {
  if (client.plan.days.length === 0) {
    return (
      <>
        <h3 className="section-h">{client.plan.name}</h3>
        <Empty>Ten podopieczny nie ma jeszcze planu treningowego.</Empty>
      </>
    );
  }
  return (
    <>
      <h3 className="section-h">{client.plan.name}</h3>
      <div className="plan-days">
        {client.plan.days.map((day) => (
          <div className="card" key={day.id}>
            <div className="card-head">
              <h4>{day.name}</h4>
              <button className="btn btn-secondary btn-sm" onClick={() => openModal({ type: 'exercise', clientId: client.id, dayId: day.id })}>
                + Ćwiczenie
              </button>
            </div>
            {day.exercises.length === 0 ? (
              <Empty>Brak ćwiczeń — dodaj pierwsze.</Empty>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th className="col-check" aria-label="Wykonane" />
                    <th>Ćwiczenie</th>
                    <th className="num">Serie × Powt.</th>
                  </tr>
                </thead>
                <tbody>
                  {day.exercises.map((x) => (
                    <tr key={x.id} className={x.done ? 'done' : ''}>
                      <td className="col-check">
                        <input
                          type="checkbox"
                          checked={x.done}
                          aria-label={`Wykonane: ${x.name}`}
                          onChange={(e) => actions.setExerciseDone(client.id, day.id, x.id, e.target.checked)}
                        />
                      </td>
                      <td>{x.name}</td>
                      <td className="num">
                        {x.sets} × {x.reps}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function ProgressTab({ client, openModal }: { client: Client; openModal: (m: ModalState) => void }) {
  const ms = [...client.measurements].sort((a, b) => a.date.localeCompare(b.date));
  const weights = ms.map((m) => m.weight);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const height = (w: number) => (max === min ? 100 : 15 + ((w - min) / (max - min)) * 85);
  return (
    <>
      <div className="toolbar">
        <h3 className="section-h">Waga</h3>
        <button className="btn btn-primary" onClick={() => openModal({ type: 'measurement', clientId: client.id })}>
          + Dodaj pomiar
        </button>
      </div>
      {ms.length === 0 ? (
        <Empty>Brak pomiarów.</Empty>
      ) : (
        <>
          <div className="card bars" aria-label="Wykres wagi">
            {ms.map((m) => (
              <div className="bar-col" key={m.id}>
                <span className="bar-value">{formatNum(m.weight)}</span>
                <div className="bar" style={{ height: `${height(m.weight)}%` }} />
                <span className="bar-label">{formatShortDate(m.date)}</span>
              </div>
            ))}
          </div>
          <div className="card table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th className="num">Waga</th>
                  <th className="num">Klatka</th>
                  <th className="num">Talia</th>
                  <th className="num">Biodra</th>
                  <th>Notatka</th>
                </tr>
              </thead>
              <tbody>
                {[...ms].reverse().map((m) => (
                  <tr key={m.id}>
                    <td>{formatDate(m.date)}</td>
                    <td className="num">{formatNum(m.weight)} kg</td>
                    <td className="num">{m.chest ?? '—'}</td>
                    <td className="num">{m.waist ?? '—'}</td>
                    <td className="num">{m.hips ?? '—'}</td>
                    <td className="muted">{m.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function SessionsTab({ client, actions, openModal }: Omit<Props, 'tab' | 'onTab'>) {
  const sessions = [...client.sessions].sort(compareSessions).reverse();
  return (
    <>
      <div className="toolbar">
        <h3 className="section-h">Sesje</h3>
        <button className="btn btn-primary" onClick={() => openModal({ type: 'session', clientId: client.id })}>
          + Zaplanuj sesję
        </button>
      </div>
      {sessions.length === 0 ? (
        <Empty>Brak sesji.</Empty>
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Godzina</th>
                <th>Typ</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>{formatDate(s.date)}</td>
                  <td>{s.time}</td>
                  <td>{s.type}</td>
                  <td>
                    <Tag>{s.status}</Tag>
                  </td>
                  <td className="actions">
                    {s.status === 'Zaplanowana' && (
                      <>
                        <button className="btn btn-secondary btn-sm" onClick={() => actions.setSessionStatus(client.id, s.id, 'Odbyta')}>
                          Odbyta
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => actions.setSessionStatus(client.id, s.id, 'Odwołana')}>
                          Odwołaj
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function PaymentsTab({ client, actions, openModal }: Omit<Props, 'tab' | 'onTab'>) {
  const payments = [...client.payments].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <>
      <div className="toolbar">
        <h3 className="section-h">Płatności</h3>
        <button className="btn btn-primary" onClick={() => openModal({ type: 'payment', clientId: client.id })}>
          + Dodaj płatność
        </button>
      </div>
      {payments.length === 0 ? (
        <Empty>Brak płatności.</Empty>
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Opis</th>
                <th className="num">Kwota</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{formatDate(p.date)}</td>
                  <td>{p.description}</td>
                  <td className="num">{formatMoney(p.amount)}</td>
                  <td>
                    <Tag>{p.status}</Tag>
                  </td>
                  <td className="actions">
                    <PaymentToggle onToggle={(s) => actions.setPaymentStatus(client.id, p.id, s)} status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function PaymentToggle({
  status,
  onToggle,
}: {
  status: Client['payments'][number]['status'];
  onToggle: (s: 'Opłacone' | 'Zaległe') => void;
}) {
  return status === 'Zaległe' ? (
    <button className="btn btn-secondary btn-sm" onClick={() => onToggle('Opłacone')}>
      Oznacz opłacone
    </button>
  ) : (
    <button className="btn btn-ghost btn-sm" onClick={() => onToggle('Zaległe')}>
      Cofnij
    </button>
  );
}
