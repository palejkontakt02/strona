import { Card, Dot, Empty, Kpi } from '../../components/ui';
import type { Client } from '../../domain';
import { lastSessionDate, plansOf, sessionsOf } from '../../data/ops';
import { useStore } from '../../data/store';
import { ago, fmtDate, fx, pln } from '../../format';
import { clientAlerts } from '../../lib/alerts';
import { packageStatus } from '../../lib/billing';
import { addDays, todayISO } from '../../lib/dates';
import { acwrZone, loadStats } from '../../lib/load';
import { currentPlan, nextWorkout } from '../../lib/plan';
import { useNav } from '../../nav';
import { APPT_STATUS } from '../CalendarView';

const BILLING_LABEL = { pakiet: 'Pakiet', abonament: 'Abonament', pojedyncza: 'Sesje pojedyncze', brak: 'Bez rozliczeń' } as const;

export function ClientOverview({ client }: { client: Client }) {
  const { db } = useStore();
  const { setClientTab } = useNav();
  const today = todayISO();
  const sessions = sessionsOf(db, client.id);
  const st = loadStats(sessions, today);
  const zone = acwrZone(st.acwr);
  const alerts = clientAlerts(client, sessions, today);
  const pk = packageStatus(client, sessions);
  const last4w = sessions.filter((s) => s.date > addDays(today, -28)).length;
  const next = db.appointments
    .filter((a) => a.clientId === client.id && a.status === 'planned' && a.date >= today)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
  const plan = currentPlan(plansOf(db, client.id));
  const nx = nextWorkout(plan, sessions);
  const unpaid = client.payments.filter((p) => p.status !== 'paid').reduce((a, p) => a + p.amount, 0);

  return (
    <>
      <div className="kpi-grid">
        <Kpi label="Ostatni trening" value={ago(lastSessionDate(db, client.id))} sub={`${last4w} w ostatnich 4 tyg.`} />
        <Kpi
          label="ACWR"
          value={st.acwr != null ? fx(st.acwr, 2) : '—'}
          sub={zone.label}
          tone={zone.level === 'red' ? 'danger' : zone.level === 'yellow' ? 'warn' : zone.level === 'green' ? 'ok' : undefined}
        />
        <Kpi
          label={client.billing === 'pakiet' || (!client.billing && pk) ? 'Pakiet' : 'Rozliczenie'}
          value={pk && (client.billing === 'pakiet' || !client.billing) ? (pk.left < 0 ? `${-pk.left} ponad` : `zostało ${pk.left}`) : BILLING_LABEL[client.billing ?? 'brak']}
          sub={unpaid ? `do zapłaty ${pln(unpaid)}` : 'wszystko opłacone'}
          tone={pk && pk.left <= 2 && client.billing === 'pakiet' ? 'warn' : unpaid ? 'warn' : undefined}
        />
        <Kpi label="Następna wizyta" value={next ? fmtDate(next.date) : '—'} sub={next ? `${next.time} · ${APPT_STATUS[next.status].label}` : 'brak w kalendarzu'} />
      </div>

      <div className="two-col">
        <Card title="Sygnały">
          {alerts.length === 0 ? (
            <Empty>Brak sygnałów ostrzegawczych.</Empty>
          ) : (
            <ul className="rows">
              {alerts.map((a, i) => (
                <li key={i} className="row">
                  <Dot tone={a.level === 'red' ? 'danger' : 'warn'} />
                  <span>{a.text}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Następny trening z planu" action={<button className="btn btn-ghost btn-sm" onClick={() => setClientTab('Plan')}>Plan</button>}>
          {nx ? (
            <>
              <p className="lead">
                {nx.workout.name} <span className="muted">· {nx.week.name}</span>
              </p>
              <p className="muted small">
                {plan?.name} · jednostka {nx.index + 1} z {nx.total}
              </p>
              <ul className="plain small">
                {nx.workout.exercises.map((e) => (
                  <li key={e.id}>{e.name}</li>
                ))}
              </ul>
            </>
          ) : (
            <Empty>Brak planu treningowego.</Empty>
          )}
        </Card>

        <Card title="Kontakt">
          <div className="stack-sm">
            {client.phone ? <a href={`tel:${client.phone.replace(/\s/g, '')}`}>{client.phone}</a> : <span className="muted">brak telefonu</span>}
            {client.email ? <a href={`mailto:${client.email}`}>{client.email}</a> : <span className="muted">brak e-maila</span>}
          </div>
        </Card>

        <Card title="Notatki" action={<button className="btn btn-ghost btn-sm" onClick={() => setClientTab('Profil')}>Edytuj</button>}>
          {client.notes || client.injuries ? (
            <div className="stack-sm">
              {client.injuries && <p className="small"><strong>Urazy:</strong> {client.injuries}</p>}
              {client.notes && <p className="small pre">{client.notes}</p>}
            </div>
          ) : (
            <Empty>Brak notatek.</Empty>
          )}
        </Card>
      </div>
    </>
  );
}
