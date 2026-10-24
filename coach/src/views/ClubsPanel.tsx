import { Card, Empty, IconBtn, Kpi, Tag } from '../components/ui';
import { locStyle } from '../components/location';
import { put } from '../data/db';
import { useStore } from '../data/store';
import { fmtDate, fmtMonth, pln, uid } from '../format';
import { clubAmount, clubMonths, clubOutstanding, clubSessions } from '../lib/club';
import { todayISO } from '../lib/dates';
import { useNav } from '../nav';

/** Rozliczenia z klubami fitness: ile treningów „przez klub” w miesiącu, ile klub ma wypłacić, co już wypłacił. */
export function ClubsPanel() {
  const { db, apply } = useStore();
  const { openModal } = useNav();
  const today = todayISO();
  const clubs = db.locations.filter((l) => l.kind === 'klub');

  if (clubs.length === 0)
    return (
      <Card>
        <Empty>Nie masz jeszcze żadnego klubu. Dodaj klub i ustaw stawkę, którą wypłaca Ci za trening — potem przy kliencie wybierz rozliczenie „przez klub”.</Empty>
        <button className="btn btn-primary" onClick={() => openModal({ kind: 'location' })}>
          + Dodaj klub
        </button>
      </Card>
    );

  const outstanding = clubs.reduce((a, c) => a + clubOutstanding(c, db.sessions, today).amount, 0);
  const thisMonth = clubs.reduce((a, c) => a + clubAmount(c, clubSessions(db.sessions, c.id, today.slice(0, 7))), 0);
  const year = today.slice(0, 4);
  const paidYear = clubs.reduce((a, c) => a + c.payouts.filter((p) => p.paidDate.startsWith(year)).reduce((b, p) => b + p.amount, 0), 0);

  return (
    <>
      <div className="kpi-grid kpi-grid-3 kpi-strip">
        <Kpi label="Do wypłaty od klubów" value={pln(outstanding)} sub="za zakończone miesiące" tone={outstanding ? 'warn' : undefined} />
        <Kpi label="W tym miesiącu" value={pln(thisMonth)} sub="narasta z każdym treningiem" />
        <Kpi label={`Wypłacono w ${year}`} value={pln(paidYear)} />
      </div>
      <div className="stack">
        {clubs.map((club) => {
          const months = clubMonths(club, db.sessions, today).slice(0, 8);
          const clientsOf = (month: string) => {
            const by: Record<string, number> = {};
            for (const s of clubSessions(db.sessions, club.id, month)) {
              const n = db.clients.find((c) => c.id === s.clientId)?.name.split(' ')[0] ?? '—';
              by[n] = (by[n] || 0) + 1;
            }
            return Object.entries(by)
              .map(([n, k]) => `${n} ${k}`)
              .join(', ');
          };
          return (
            <Card
              key={club.id}
              title={
                <span className="row-inline">
                  <span className="loc-dot" style={locStyle(club)} /> {club.name}
                </span>
              }
              action={<IconBtn icon="edit" label="Edytuj klub" onClick={() => openModal({ kind: 'location', location: club })} />}
            >
              <p className="muted small">
                Stawka: <strong>{pln(club.clubRate)}</strong> za trening · klienci rozliczani przez ten klub:{' '}
                {db.clients.filter((c) => c.billing === 'klub' && c.locationId === club.id).map((c) => c.name).join(', ') || 'brak'}
              </p>
              {months.length === 0 ? (
                <Empty>Brak treningów rozliczanych przez ten klub.</Empty>
              ) : (
                <div className="table-wrap flush">
                  <table className="table table-cards">
                    <thead>
                      <tr>
                        <th>Miesiąc</th>
                        <th className="num">Treningi</th>
                        <th className="num">Kwota</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {months.map((m) => (
                        <tr key={m.month}>
                          <td>
                            <span className="first-cap">{fmtMonth(m.month)}</span>
                            <div className="muted small">{clientsOf(m.month)}</div>
                          </td>
                          <td className="num">{m.sessions}</td>
                          <td className="num">
                            {pln(m.amount)}
                            {m.paid > 0 && m.due > 0 && <div className="muted small">wypłacono {pln(m.paid)}</div>}
                          </td>
                          <td>
                            {m.payout && m.due === 0 ? (
                              <Tag tone="ok">Wypłacono {fmtDate(m.payout.paidDate)}</Tag>
                            ) : m.current ? (
                              <Tag>W trakcie</Tag>
                            ) : m.payout ? (
                              <Tag tone="warn">Dopłata {pln(m.due)}</Tag>
                            ) : (
                              <Tag tone="warn">Do wypłaty</Tag>
                            )}
                          </td>
                          <td className="actions">
                            {m.due > 0 && (
                              <button
                                className={`btn btn-sm ${m.current ? 'btn-ghost' : 'btn-secondary'}`}
                                onClick={() =>
                                  apply(
                                    [put('locations', { ...club, payouts: [...club.payouts, { id: uid(), month: m.month, amount: m.due, sessions: m.sessions, paidDate: today }] })],
                                    `Klub wypłacił ${pln(m.due)} za ${fmtMonth(m.month)}.`,
                                  )
                                }
                              >
                                {m.payout ? 'Oznacz dopłatę' : 'Oznacz wypłacone'}
                              </button>
                            )}
                            {m.payout && (
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => apply([put('locations', { ...club, payouts: club.payouts.filter((p) => p.id !== m.payout!.id) })], 'Cofnięto wypłatę.')}
                              >
                                Cofnij
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          );
        })}
      </div>
      <button className="btn btn-ghost section-gap" onClick={() => openModal({ kind: 'locations' })}>
        Miejsca i kluby…
      </button>
    </>
  );
}
