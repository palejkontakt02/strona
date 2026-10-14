import { Empty, IconBtn, Tag } from '../../components/ui';
import type { Client } from '../../domain';
import { sessionsOf } from '../../data/ops';
import { useStore } from '../../data/store';
import { fmtDate, fnum } from '../../format';
import { sessionLoad, tonnage } from '../../lib/load';
import { wellnessTotal } from '../../lib/wellness';
import { useNav } from '../../nav';
import { CHARGE_SHORT, LocationTag } from '../../components/location';
import { WorkoutList } from './WorkoutList';


export function ClientSessions({ client }: { client: Client }) {
  const { db } = useStore();
  const { openModal } = useNav();
  const sessions = sessionsOf(db, client.id);
  return (
    <>
      <WorkoutList client={client} />
      <div className="toolbar section-gap">
        <h3>Zapisane treningi ({sessions.length})</h3>
        <button className="btn btn-primary" onClick={() => openModal({ kind: 'session', clientId: client.id })}>
          + Zapisz trening
        </button>
      </div>
      {sessions.length === 0 ? (
        <Empty>Brak zapisanych treningów.</Empty>
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Trening</th>
                <th className="num">Czas</th>
                <th className="num">sRPE</th>
                <th className="num">AU</th>
                <th className="num">Tonaż</th>
                <th className="num">Wellness</th>
                <th className="num">Ból</th>
                <th className="hide-mobile">Rozliczenie</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const w = wellnessTotal(s.wellness);
                const ton = tonnage(s);
                return (
                  <tr key={s.id}>
                    <td className="nowrap">{fmtDate(s.date)}</td>
                    <td>
                      {s.workoutName || 'Trening'} <LocationTag id={s.locationId} short />
                      {s.notes && <div className="muted small ellipsis" style={{ maxWidth: 260 }}>{s.notes}</div>}
                    </td>
                    <td className="num">{s.duration != null ? `${s.duration} min` : '—'}</td>
                    <td className="num">{fnum(s.srpe)}</td>
                    <td className="num">{fnum(sessionLoad(s), 0)}</td>
                    <td className="num">{ton ? `${fnum(ton, 0)} kg` : '—'}</td>
                    <td className="num">{w != null ? `${w}/25` : '—'}</td>
                    <td className="num">{s.pain != null ? <Tag tone={s.pain >= 6 ? 'danger' : s.pain >= 4 ? 'warn' : 'muted'}>{s.pain}/10</Tag> : '—'}</td>
                    <td className="hide-mobile muted small">{CHARGE_SHORT[s.charge]}</td>
                    <td className="actions">
                      <IconBtn icon="edit" label="Edytuj trening" onClick={() => openModal({ kind: 'session', session: s })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
