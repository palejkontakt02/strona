import { useState } from 'react';
import { Avatar, Card, Dot, Empty, Icon, IconBtn, Kpi, Tag } from '../components/ui';
import { allPayments, clientById, groupOf, lastSessionDate, paymentLabel, sessionsOf } from '../data/ops';
import { put } from '../data/db';
import { needsReview, sessionVideos } from '../data/videos';
import { markPaid } from '../data/payActions';
import { useStore } from '../data/store';
import { ago, fmtDate, fmtDay, fmtLong, plural, pln } from '../format';
import { clientAlerts } from '../lib/alerts';
import { healthFlags, trainerNotesOf } from './client/Health';
import { isOverdue, packageStatus, PACKAGE_WARN_AT } from '../lib/billing';
import { addDays, daysBetween, todayISO } from '../lib/dates';
import { useNav } from '../nav';
import { ApptStatusTag } from './CalendarView';
import { LocationTag, locStyle } from '../components/location';
import { clubAmount, clubOutstanding, clubSessions } from '../lib/club';

export function Dashboard() {
  const { db, apply, toast } = useStore();
  const { openClient, openModal, startLive, go } = useNav();
  const clubs = db.locations.filter((l) => l.kind === 'klub');
  const today = todayISO();
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [showAllToday, setShowAllToday] = useState(false);
  const active = db.clients.filter((c) => c.status === 'aktywny');

  const todayAppts = db.appointments.filter((a) => a.date === today && a.status !== 'cancel').sort((a, b) => a.time.localeCompare(b.time));
  const week = db.sessions.filter((s) => s.date > addDays(today, -7) && s.date <= today).length;
  const payments = allPayments(db);
  const month = today.slice(0, 7);
  const paidThisMonth = payments.filter((p) => p.status === 'paid' && (p.paidDate || p.date).startsWith(month)).reduce((a, p) => a + p.amount, 0);
  const overdue = payments.filter((p) => isOverdue(p, today));
  const due = payments.filter((p) => p.status !== 'paid').sort((a, b) => (a.dueDate || a.date).localeCompare(b.dueDate || b.date));

  const alerts = active.flatMap((c) => clientAlerts(c, sessionsOf(db, c.id), today, healthFlags(trainerNotesOf(db.trainer_notes, c.id).health, c.intake)).map((a) => ({ ...a, client: c })));
  alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === 'red' ? -1 : 1));

  const packages = active
    .map((c) => ({ c, pk: packageStatus(c, sessionsOf(db, c.id)) }))
    .filter((x) => x.pk && x.pk.left <= PACKAGE_WARN_AT && (x.c.billing === 'pakiet' || !x.c.billing))
    .sort((a, b) => a.pk!.left - b.pk!.left);

  const idle = active
    .map((c) => ({ c, last: lastSessionDate(db, c.id) }))
    // nowy podopieczny bez treningów, ale z zaplanowaną wizytą, nie jest „nieaktywny”
    .filter((x) => (!x.last ? !db.appointments.some((a) => a.clientId === x.c.id && a.status === 'planned' && a.date >= today) : daysBetween(x.last, today) >= 10))
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
        <Kpi
          onClick={() => {
            try {
              sessionStorage.setItem('payments-filter', 'Zaległe');
            } catch {
              /* bez sessionStorage — zwykłe przejście */
            }
            go('Płatności');
          }}
          label="Zaległości"
          value={pln(overdue.reduce((a, p) => a + p.amount, 0))} sub={overdue.length ? `${overdue.length} ${plural(overdue.length, 'płatność', 'płatności', 'płatności')} po terminie` : 'brak'} tone={overdue.length ? 'danger' : undefined} />
      </div>

      <div className="dash-grid">
        <Card title={`Dziś w kalendarzu${todayAppts.length > 6 ? ` (${todayAppts.length})` : ''}`} className="span-2 dash-today">
          {todayAppts.length === 0 ? (
            <Empty>Brak wizyt na dziś.</Empty>
          ) : (
            <ul className="rows">
              {/* dużo wizyt: najpierw te, które jeszcze przed Tobą (reszta po rozwinięciu) */}
              {(showAllToday || todayAppts.length <= 8 ? todayAppts : (todayAppts.filter((a) => a.status === 'planned').length ? todayAppts.filter((a) => a.status === 'planned') : todayAppts).slice(0, 6)).map((a) => {
                const c = clientById(db, a.clientId);
                return (
                  <li key={a.id} className="row">
                    <span className="row-time">{a.time}</span>
                    <div className="grow row-main">
                      <button className="link ellipsis" onClick={() => c && openClient(c.id)}>
                        {c?.name ?? '—'}
                      </button>
                      {(() => {
                        const pr = groupOf(db.appointments, a).filter((x) => x.id !== a.id && x.status !== 'cancel');
                        return pr.length ? <span className="muted small nowrap" title="Trening w parze — „Prowadź” otwiera obie osoby">👥 + {pr.map((x) => clientById(db, x.clientId)?.name.split(' ')[0] ?? '—').join(', ')}</span> : null;
                      })()}
                      <LocationTag id={a.locationId} short />
                    </div>
                    <span className={a.status === 'planned' ? 'hide-mobile' : ''}>
                      <ApptStatusTag status={a.status} />
                    </span>
                    {a.status === 'planned' || (a.status === 'done' && !a.sessionId) ? (
                      <>
                        <button className="btn btn-primary btn-sm" onClick={() => startLive(a.clientId, a.id)} title="Prowadź trening na żywo, seria po serii" aria-label="Prowadź trening">
                          <Icon name="play" size={14} /> <span className="hide-xs">Prowadź</span>
                        </button>
                        <IconBtn icon="edit" label="Zapisz trening po fakcie" onClick={() => openModal({ kind: 'session', appt: a, clientId: a.clientId, date: a.date })} />
                      </>
                    ) : a.sessionId && db.sessions.some((x) => x.id === a.sessionId) ? (
                      <IconBtn icon="eye" label="Pokaż zapisany trening" onClick={() => openModal({ kind: 'session', session: db.sessions.find((x) => x.id === a.sessionId)! })} />
                    ) : (
                      <span className="btn-sm-placeholder" />
                    )}
                    <IconBtn icon="cal" label="Szczegóły wizyty (odwołaj, nieobecność, zmiana)" onClick={() => openModal({ kind: 'appt', appt: a })} />
                  </li>
                );
              })}
            </ul>
          )}
          {todayAppts.length > 8 && (
            <button className="btn btn-ghost btn-sm" onClick={() => setShowAllToday(!showAllToday)}>
              {showAllToday ? 'Pokaż mniej' : `Pokaż wszystkie wizyty (${todayAppts.length})`}
            </button>
          )}
        </Card>

        {(() => {
          const notes = db.clients.flatMap((c) => (c.inbox ?? []).filter((n) => !n.read).map((n) => ({ c, n }))).sort((a, b) => (b.n.at || '').localeCompare(a.n.at || ''));
          if (!notes.length) return null;
          return (
            <Card title={`Wiadomości od podopiecznych (${notes.length})`} className="span-2">
              <ul className="rows">
                {notes.slice(0, 6).map(({ c, n }) => (
                  <li key={n.id} className="row row-top">
                    <div className="grow">
                      <button className="link" onClick={() => openClient(c.id, 'Przegląd')}>
                        {c.name}
                      </button>
                      <span className="muted small"> · {new Date(n.at).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      <div className="small ellipsis-2">{n.text}</div>
                      <div className="row-links">
                        <button className="link small" onClick={() => openClient(c.id, 'Przegląd')}>
                          Odpowiedz ›
                        </button>
                        {n.sessionId && db.sessions.some((x) => x.id === n.sessionId) && (
                          <button className="link small" onClick={() => openModal({ kind: 'review', sessionId: n.sessionId! })}>
                            Zobacz trening ›
                          </button>
                        )}
                        <button className="link small muted" onClick={() => apply([put('clients', { ...c, inbox: (c.inbox ?? []).map((x) => (x.id === n.id ? { ...x, read: true } : x)) })])}>
                          ✓ Przeczytane
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              {notes.length > 6 && <p className="muted small">I jeszcze {notes.length - 6} — otwórz podopiecznego, by zobaczyć wszystkie.</p>}
            </Card>
          );
        })()}
        {(() => {
          // nagrania serii, których trener jeszcze nie obejrzał (ostatnie 30 dni)
          const from = addDays(today, -30);
          const todo = db.sessions.filter((x) => x.date >= from && needsReview(x)).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
          if (!todo.length) return null;
          return (
            <Card title={`Nagrania do obejrzenia (${todo.length})`} className="span-2">
              <ul className="rows">
                {todo.slice(0, 8).map((x) => {
                  const c = clientById(db, x.clientId);
                  const n = sessionVideos(x).length;
                  return (
                    <li key={x.id} className="row">
                      <span className="row-time">{fmtDay(x.date)}</span>
                      <div className="grow row-main">
                        <b className="ellipsis">{c?.name ?? '—'}</b>
                        <span className="muted small ellipsis">
                          {x.workoutName || 'Trening'} · 🎥 {n}
                          {x.notes ? ' · ma notatkę' : ''}
                        </span>
                      </div>
                      <button className="btn btn-primary btn-sm" onClick={() => openModal({ kind: 'review', sessionId: x.id })}>
                        <Icon name="play" size={14} /> <span className="hide-xs">Obejrzyj</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>
          );
        })()}
        {(() => {
          // zaplanowane wizyty z ostatnich 2 tygodni, które nie zostały rozliczone
          const from = addDays(today, -14);
          const overdueAppts = db.appointments.filter((a) => a.status === 'planned' && a.date < today && a.date >= from).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
          if (!overdueAppts.length) return null;
          return (
            <Card title={`Do uzupełnienia (${overdueAppts.length})`} className="span-2">
              <p className="muted small">Minione wizyty bez zapisanego treningu — zapisz trening (zejdzie z pakietu / doliczy się klubowi) albo oznacz odwołanie.</p>
              <ul className="rows">
                {overdueAppts.slice(0, 8).map((a) => {
                  const c = clientById(db, a.clientId);
                  return (
                    <li key={a.id} className="row">
                      <span className="row-time">
                        {fmtDay(a.date)} {a.time}
                      </span>
                      <button className="link grow" onClick={() => c && openClient(c.id)}>
                        {c?.name ?? '—'}
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => openModal({ kind: 'session', appt: a, clientId: a.clientId, date: a.date })}>
                        Zapisz trening
                      </button>
                      <IconBtn icon="cal" label="Szczegóły wizyty" onClick={() => openModal({ kind: 'appt', appt: a })} />
                    </li>
                  );
                })}
              </ul>
            </Card>
          );
        })()}

        {(() => {
          // jedna pozycja na osobę (kilka sygnałów w jednej linii), czerwone najpierw
          const groups = [...new Map(alerts.map((a) => [a.client.id, a.client])).values()]
            .map((client) => ({ client, items: alerts.filter((a) => a.client.id === client.id) }))
            .sort((a, b) => Number(b.items.some((x) => x.level === 'red')) - Number(a.items.some((x) => x.level === 'red')));
          return (
            <Card title={`Sygnały ostrzegawcze${groups.length ? ` (${groups.length})` : ''}`} className="dash-alerts">
              {groups.length === 0 ? (
                <Empty>Wszystko w normie.</Empty>
              ) : (
                <ul className="rows">
                  {(showAllAlerts ? groups : groups.slice(0, 5)).map(({ client, items }) => (
                    <li key={client.id} className="row row-top">
                      <Dot tone={items.some((a) => a.level === 'red') ? 'danger' : 'warn'} />
                      <div className="grow">
                        <button className="link" onClick={() => openClient(client.id, 'Monitoring')}>
                          {client.name}
                        </button>
                        <div className="small muted ellipsis-2">{items.map((a) => a.text).join(' · ')}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {groups.length > 5 && (
                <button className="btn btn-ghost btn-sm" onClick={() => setShowAllAlerts(!showAllAlerts)}>
                  {showAllAlerts ? 'Pokaż mniej' : `Pokaż wszystkie (${groups.length})`}
                </button>
              )}
            </Card>
          );
        })()}

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
                  <IconBtn icon="check" label="Oznacz opłacone" onClick={() => void markPaid({ apply, toast }, p.client, p.id, today)} />
                </li>
              ))}
            </ul>
          )}
        </Card>

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
                    {s.srpe != null && s.duration != null && <span className="small muted nowrap" title="Obciążenie treningu = RPE × minuty (AU — jednostki umowne)">{s.srpe * s.duration} AU</span>}
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
