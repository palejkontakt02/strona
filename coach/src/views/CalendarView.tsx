import type { ModalState } from '../components/Modals';
import { Empty, Tag } from '../components/ui';
import type { Client, Session } from '../types';
import { compareSessions, formatLongDate, todayISO } from '../utils';

interface Props {
  clients: Client[];
  openModal: (m: ModalState) => void;
  onOpenClient: (id: string) => void;
}

export function CalendarView({ clients, openModal, onOpenClient }: Props) {
  const today = todayISO();
  const upcoming: (Session & { client: Client })[] = clients
    .flatMap((client) => client.sessions.map((s) => ({ ...s, client })))
    .filter((s) => s.status === 'Zaplanowana' && s.date >= today)
    .sort(compareSessions);

  const byDay = new Map<string, typeof upcoming>();
  for (const s of upcoming) byDay.set(s.date, [...(byDay.get(s.date) ?? []), s]);

  return (
    <div className="page fade">
      <div className="toolbar">
        <h2>Nadchodzące sesje</h2>
        <button className="btn btn-primary" onClick={() => openModal({ type: 'session' })}>
          + Zaplanuj sesję
        </button>
      </div>
      {upcoming.length === 0 && <Empty>Brak zaplanowanych sesji.</Empty>}
      {[...byDay].map(([date, sessions]) => (
        <section className="day-group" key={date}>
          <h4 className="day-title">
            {date === today ? 'Dziś · ' : ''}
            {formatLongDate(date)}
          </h4>
          <div className="card">
            {sessions.map((s) => (
              <div className="cal-row" key={s.id}>
                <span className="cal-time">{s.time}</span>
                <button className="link" onClick={() => onOpenClient(s.client.id)}>
                  {s.client.name}
                </button>
                <span className="muted">{s.type}</span>
                <Tag>{s.status}</Tag>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
