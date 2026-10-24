import { printReport } from '../../lib/print';
import { ClientHabits, ClientInbox, ClientTargets } from './Habits';
import { CoachReports } from '../../components/WeeklyReport';
import { CoachPhotos } from '../../components/ProgressPhotos';
import { Card, Dot, Empty, Kpi, Tag } from '../../components/ui';
import type { Client } from '../../domain';
import { lastSessionDate, plansOf, sessionsOf } from '../../data/ops';
import { useStore } from '../../data/store';
import { ago, fmtDate, fx, pln } from '../../format';
import { clientAlerts } from '../../lib/alerts';
import { healthFlags, trainerNotesOf } from './Health';
import { packageStatus } from '../../lib/billing';
import { addDays, todayISO } from '../../lib/dates';
import { acwrZone, loadStats } from '../../lib/load';
import { currentPlan, nextWorkout } from '../../lib/plan';
import { useNav } from '../../nav';
import { APPT_STATUS } from '../CalendarView';
import { BILLING_LABEL } from '../../components/location';


export function ClientOverview({ client }: { client: Client }) {
  const { db } = useStore();
  const { setClientTab, openModal } = useNav();
  const today = todayISO();
  const sessions = sessionsOf(db, client.id);
  const st = loadStats(sessions, today);
  const zone = acwrZone(st.acwr);
  const alerts = clientAlerts(client, sessions, today, healthFlags(trainerNotesOf(db.trainer_notes, client.id).health, client.intake));
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
      {(() => {
        const h = trainerNotesOf(db.trainer_notes, client.id).health;
        const txt = [h?.contraindications, h?.restrictions].filter(Boolean).join(' · ');
        return txt ? (
          <div className="coach-note" role="note">
            <span className="eyebrow">Unikać / ograniczenia (z wywiadu)</span>
            <p>{txt}</p>
          </div>
        ) : null;
      })()}
      <div className="report-row">
        <button
          className="btn btn-ghost btn-sm"
          title="Raport treningowy do druku / PDF — np. dla lekarza lub fizjoterapeuty"
          onClick={() => printReport(client, sessions, { plan: currentPlan(plansOf(db, client.id)) })}
        >
          🖨 Raport dla lekarza / fizjo
        </button>
      </div>
      <ClientInbox client={client} />
      <div className="kpi-grid kpi-strip">
        <Kpi label="Ostatni trening" value={ago(lastSessionDate(db, client.id))} sub={`${last4w} w ostatnich 4 tyg.`} />
        <Kpi
          label="ACWR"
          hint="Obciążenie z ostatnich 7 dni względem średniej z 4 tygodni (obciążenie = RPE treningu × minuty). 0,8–1,3 — bezpiecznie, powyżej 1,5 — za szybki wzrost."
          value={st.acwr != null ? fx(st.acwr, 2) : '—'}
          sub={zone.label}
          tone={zone.level === 'red' ? 'danger' : zone.level === 'yellow' ? 'warn' : zone.level === 'green' ? 'ok' : undefined}
        />
        <Kpi
          label={client.billing === 'pakiet' || (!client.billing && pk) ? 'Pakiet' : 'Rozliczenie'}
          value={pk && (client.billing === 'pakiet' || !client.billing) ? (pk.left < 0 ? `${-pk.left} ponad` : `zostało ${pk.left}`) : BILLING_LABEL[client.billing ?? 'brak']}
          sub={unpaid ? `do zapłaty ${pln(unpaid)}` : (client.billing === 'pakiet' || !client.billing) && !pk ? 'brak wykupionego pakietu' : 'wszystko opłacone'}
          tone={pk && pk.left <= 2 && client.billing === 'pakiet' ? 'warn' : unpaid ? 'warn' : undefined}
        />
        <Kpi
          label="Następna wizyta"
          value={next ? fmtDate(next.date) : '—'}
          sub={
            <>
              {next ? `${next.time} · ${APPT_STATUS[next.status].label}` : 'brak w kalendarzu'}{' '}
              <button className="link small" onClick={() => openModal({ kind: 'appt', clientId: client.id })}>
                + zaplanuj
              </button>
            </>
          }
        />
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
      <div className="two-col comms-cols">
        <Card
          title={
            <>
              Raporty tygodnia {(client.weeklyReports ?? []).some((r) => !r.seenAt) && <Tag tone="warn">{(client.weeklyReports ?? []).filter((r) => !r.seenAt).length} nowe</Tag>}
            </>
          }
          className="wr-panel"
        >
          <CoachReports client={client} />
        </Card>
        <Card title="Zdjęcia sylwetki" className="pp-panel">
          <CoachPhotos client={client} />
        </Card>
      </div>
      <div className="section-gap-sm" />
      <ClientHabits client={client} />
      <div className="section-gap-sm" />
      <ClientTargets client={client} />
    </>
  );
}
