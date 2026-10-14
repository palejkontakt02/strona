import { Avatar, Card, Dot, Empty, Icon, IconBtn, Kpi, Tag } from '../components/ui';
import { allPayments, clientById, lastSessionDate, paymentLabel, sessionsOf, setPaymentStatus } from '../data/ops';
import { useStore } from '../data/store';
import { ago, fmtDate, fmtDay, fmtLong, plural, pln } from '../format';
import { clientAlerts } from '../lib/alerts';
import { isOverdue, packageStatus, PACKAGE_WARN_AT } from '../lib/billing';
import { addDays, daysBetween, todayISO } from '../lib/dates';
import { useNav } from '../nav';
import { ApptStatusTag } from './CalendarView';
import { LocationTag, locStyle } from '../components/location';
import { clubAmount, clubOutstanding, clubSessions } from '../lib/club';

export function Dashboard() {
  const { db, apply } = useStore();
  const { openClient, openModal, startLive, go } = useNav();
  const clubs = db.locations.filter((l) => l.kind === 'klub');
  const today = todayISO();
  const active = db.clients.filter((c) => c.status === 'aktywny');

  const todayAppts = db.appointments.filter((a) => a.date === today && a.status !== 'cancel').sort((a, b) => a.time.localeCompare(b.time));
  const week = db.sessions.filter((s) => s.date > addDays(today, -7) && s.date <= today).length;
  const payments = allPayments(db);
  const month = today.slice(0, 7);
  const paidThisMonth = payments.filter((p) => p.status === 'paid' && (p.paidDate || p.date).startsWith(month)).reduce((a, p) => a + p.amount, 0);
  const overdue = payments.filter((p) => isOverdue(p, today));
  const due = payments.filter((p) => p.status !== 'paid').sort((a, b) => (a.dueDate || a.date).localeCompare(b.dueDate || b.date));

  const alerts = active.flatMap((c) => clientAlerts(c, sessionsOf(db, c.id), today).map((a) => ({ ...a, client: c })));
  alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === 'red' ? -1 : 1));

  const packages = active
    .map((c) => ({ c, pk: packageStatus(c, sessionsOf(db, c.id)) }))
    .filter((x) => x.pk && x.pk.left <= PACKAGE_WARN_AT && (x.c.billing === 'pakiet' || !x.c.billing))
    .sort((a, b) => a.pk!.left - b.pk!.left);

  const idle = active
    .map((c) => ({ c, last: lastSessionDate(db, c.id) }))
    .filter((x) => !x.last || daysBetween(x.last, today) >= 10)
    .sort((a, b) => (a.last || '').localeCompare(b.last || ''));

  const recent = [...db.sessions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);

  return (
    <div className="page fade">
      <div className="page-head">
        <div>
          <h2>Pulpit</h2>
          <p className="muted first-cap">{fmtLong(today)}</p>
        </div>
      </div>

      <div className="kpi-grid">
        <Kpi label="Aktywni klienci" value={active.length} sub={`${db.clients.length} łącznie`} />
        <Kpi label="Treningi – 7 dni" value={week} sub={plural(week, 'trening', 'treningi', 'treningów')} />
        <Kpi label="Wpłaty w tym miesiącu" value={pln(paidThisMonth)} />
        <Kpi label="Zaległości" value={pln(overdue.reduce((a, p) => a + p.amount, 0))} sub={overdue.length ? `${overdue.length} ${plural(overdue.length, 'płatność', 'płatności', 'płatności')} po terminie` : 'brak'} tone={overdue.length ? 'danger' : undefined} />
      </div>

      <div className="dash-grid">
        <Card title="Dziś w kalendarzu" className="span-2">
          {todayAppts.length === 0 ? (
            <Empty>Brak wizyt na dziś.</Empty>
          ) : (
            <ul className="rows">
              {todayAppts.map((a) => {
                const c = clientById(db, a.clientId);
                return (
                  <li key={a.id} className="row">
                    <span className="row-time">{a.time}</span>
                    <button className="link grow" onClick={() => c && openClient(c.id)}>
                      {c?.name ?? '—'}
                    </button>
                    <span className="hide-mobile">
                      <LocationTag id={a.locationId} short />
                    </span>
                    <span className={a.status === 'planned' ? 'hide-mobile' : ''}>
                      <ApptStatusTag status={a.status} />
                    </span>
                    {a.status === 'planned' ? (
                      <>
                        <button className="btn btn-primary btn-sm" onClick={() => startLive(a.clientId, a.id)} title="Prowadź trening na żywo, seria po serii">
                          <Icon name="play" size={14} /> Prowadź
                        </button>
                        <IconBtn icon="edit" label="Zapisz trening po fakcie" onClick={() => openModal({ kind: 'session', appt: a, clientId: a.clientId, date: a.date })} />
                      </>
                    ) : (
                      <span className="btn-sm-placeholder" />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title={`Sygnały ostrzegawcze${alerts.length ? ` (${alerts.length})` : ''}`}>
          {alerts.length === 0 ? (
            <Empty>Wszystko w normie.</Empty>
          ) : (
            <ul className="rows">
              {alerts.map((a, i) => (
                <li key={i} className="row row-top">
                  <Dot tone={a.level === 'red' ? 'danger' : 'warn'} />
                  <div className="grow">
                    <button className="link" onClick={() => openClient(a.client.id, 'Monitoring')}>
                      {a.client.name}
                    </button>
                    <div className="small muted">{a.text}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Do zapłaty">
          {due.length === 0 ? (
            <Empty>Wszystko opłacone.</Empty>
          ) : (
            <ul className="rows">
              {due.slice(0, 8).map((p) => (
                <li key={p.id} className="row">
                  <div className="grow">
                    <button className="link" onClick={() => openClient(p.client.id, 'Płatności')}>
                      {p.client.name}
                    </button>
                    <div className="small muted">
                      {paymentLabel(p)} · termin {fmtDate(p.dueDate || p.date)}
                    </div>
                  </div>
                  <strong className="nowrap">{pln(p.amount)}</strong>
                  {isOverdue(p, today) && <Tag tone="danger">Zaległe</Tag>}
                  <IconBtn icon="check" label="Oznacz opłacone" onClick={() => apply([setPaymentStatus(p.client, p.id, true, today)], 'Oznaczono jako opłacone.')} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {(() => {
          const notes = db.clients.flatMap((c) => (c.inbox ?? []).filter((n) => !n.read).map((n) => ({ c, n }))).sort((a, b) => b.n.at.localeCompare(a.n.at));
          if (!notes.length) return null;
          return (
            <Card title={`Notatki od podopiecznych (${notes.length})`}>
              <ul className="rows">
                {notes.slice(0, 6).map(({ c, n }) => (
                  <li key={n.id} className="row row-top">
                    <div className="grow">
                      <button className="link" onClick={() => openClient(c.id, 'Przegląd')}>
                        {c.name}
                      </button>
                      <span className="muted small"> · {new Date(n.at).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      <div className="small ellipsis-2">{n.text}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })()}
        {clubs.length > 0 && (
          <Card title="Rozliczenia z klubami" action={<button className="btn btn-ghost btn-sm" onClick={() => go('Płatności')}>Szczegóły</button>}>
            <ul className="rows">
              {clubs.map((c) => {
                const out = clubOutstanding(c, db.sessions, today);
                const curList = clubSessions(db.sessions, c.id, today.slice(0, 7));
                const cur = curList.length;
                return (
                  <li key={c.id} className="row row-top">
                    <span className="loc-dot" style={locStyle(c)} />
                    <div className="grow">
                      <strong>{c.name}</strong>
                      <div className="small muted">
                        w tym miesiącu {cur} {plural(cur, 'trening', 'treningi', 'treningów')} · {pln(clubAmount(c, curList))}
                      </div>
                    </div>
                    {out.amount > 0 ? <Tag tone="warn">do wypłaty {pln(out.amount)}</Tag> : <Tag tone="ok">rozliczone</Tag>}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        <Card title="Kończące się pakiety">
          {packages.length === 0 ? (
            <Empty>Brak.</Empty>
          ) : (
            <ul className="rows">
              {packages.map(({ c, pk }) => (
                <li key={c.id} className="row">
                  <Avatar name={c.name} size={30} />
                  <button className="link grow" onClick={() => openClient(c.id, 'Płatności')}>
                    {c.name}
                  </button>
                  <Tag tone={pk!.left <= 0 ? 'danger' : 'warn'}>{pk!.left < 0 ? `${-pk!.left} ponad pakiet` : `zostało ${pk!.left}`}</Tag>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Bez treningu 10+ dni">
          {idle.length === 0 ? (
            <Empty>Wszyscy trenują regularnie.</Empty>
          ) : (
            <ul className="rows">
              {idle.map(({ c, last }) => (
                <li key={c.id} className="row">
                  <Avatar name={c.name} size={30} />
                  <button className="link grow" onClick={() => openClient(c.id)}>
                    {c.name}
                  </button>
                  <span className="small muted">{ago(last)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Ostatnie treningi" className="span-2">
          {recent.length === 0 ? (
            <Empty>Brak zapisanych treningów.</Empty>
          ) : (
            <ul className="rows">
              {recent.map((s) => {
                const c = clientById(db, s.clientId);
                return (
                  <li key={s.id} className="row">
                    <span className="row-time">{fmtDay(s.date)}</span>
                    <div className="grow">
                      <button className="link" onClick={() => c && openClient(c.id, 'Treningi')}>
                        {c?.name}
                      </button>
                      <div className="small muted">{s.workoutName || 'Trening'}</div>
                    </div>
                    {s.srpe != null && s.duration != null && <span className="small muted nowrap">{s.srpe * s.duration} AU</span>}
                    <IconBtn icon="edit" label="Edytuj trening" onClick={() => openModal({ kind: 'session', session: s })} />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
