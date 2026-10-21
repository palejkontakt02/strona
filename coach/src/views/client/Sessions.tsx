import { useState } from 'react';
import { SessionSheet } from '../../athlete/History';
import type { TrainingSession } from '../../domain';
import { Empty, IconBtn, Tag } from '../../components/ui';
import type { Client } from '../../domain';
import { isSolo, sessionsOf } from '../../data/ops';
import { needsReview, sessionVideos } from '../../data/videos';
import { useStore } from '../../data/store';
import { fmtDate, fnum } from '../../format';
import { sessionLoad, tonnage } from '../../lib/load';
import { wellnessTotal } from '../../lib/wellness';
import { useNav } from '../../nav';
import { CHARGE_SHORT, LocationTag } from '../../components/location';
import { WorkoutList } from './WorkoutList';


/** Znaczniki przy zapisanym treningu: nagrania (nowe/obejrzane), samodzielnie, komentarz. */
export function SessionBadges({ s }: { s: TrainingSession }) {
  const { db } = useStore();
  const n = sessionVideos(s).length;
  return (
    <>
      {n > 0 && <Tag tone={needsReview(s) ? 'accent' : 'muted'}>{`🎥 ${n}${needsReview(s) ? ' · nowe' : ''}`}</Tag>}{' '}
      {isSolo(db, s) && <Tag tone="muted">samodzielnie</Tag>}{' '}
      {s.coachNote && <Tag tone="muted">💬</Tag>}{' '}
      {s.withIds?.length ? <Tag tone="muted">👥 w parze: {s.withIds.map((id) => db.clients.find((c) => c.id === id)?.name.split(' ')[0] ?? '—').join(', ')}</Tag> : null}
    </>
  );
}

export function ClientSessions({ client }: { client: Client }) {
  const { db } = useStore();
  const { openModal } = useNav();
  const sessions = sessionsOf(db, client.id);
  const { startLive, startAthlete } = useNav();
  const [shown, setShown] = useState<TrainingSession | null>(null);
  return (
    <>
      <div className="toolbar">
        <h3>Zapisane treningi ({sessions.length})</h3>
        <div className="actions">
          <button className="btn btn-secondary" onClick={() => openModal({ kind: 'session', clientId: client.id, paste: true })}>
            📋 Wklej z notatki
          </button>
          <button className="btn btn-primary" onClick={() => openModal({ kind: 'session', clientId: client.id })}>
            + Zapisz wykonany trening
          </button>
        </div>
      </div>
      {sessions.length === 0 ? (
        <Empty>Brak zapisanych treningów.</Empty>
      ) : (
        <>
        {/* telefon: lista z widocznymi przyciskami (tabela przewijana w bok chowała akcje) */}
        <ul className="card rows show-mobile sess-list">
          {sessions.map((s) => {
            const ton = tonnage(s);
            return (
              <li key={s.id} className="row row-top">
                <button className="grow sess-open" onClick={() => setShown(s)}>
                  <strong>{s.workoutName || 'Trening'}</strong> <SessionBadges s={s} />
                  <span className="muted small">
                    {[fmtDate(s.date), s.duration != null && `${s.duration} min`, s.srpe != null && `RPE ${fnum(s.srpe)}`, s.pain != null && s.pain >= 4 && `ból ${s.pain}/10`, ton ? `${fnum(ton, 0)} kg` : null].filter(Boolean).join(' · ')}
                  </span>
                  {s.notes && <span className="muted small ellipsis">„{s.notes}”</span>}
                </button>
                {sessionVideos(s).length > 0 ? (
                  <IconBtn icon="play" label="Przejrzyj nagrania" onClick={() => openModal({ kind: 'review', sessionId: s.id })} />
                ) : (
                  <IconBtn icon="eye" label="Podgląd treningu" onClick={() => setShown(s)} />
                )}
                <IconBtn icon="edit" label="Edytuj trening" onClick={() => openModal({ kind: 'session', session: s })} />
              </li>
            );
          })}
        </ul>
        <div className="card table-wrap hide-mobile">
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
                  <tr key={s.id} className="tr-click" onClick={(e) => !(e.target as HTMLElement).closest('button') && setShown(s)}>
                    <td className="nowrap">{fmtDate(s.date)}</td>
                    <td>
                      {s.workoutName || 'Trening'} <LocationTag id={s.locationId} short /> <SessionBadges s={s} />
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
                      {sessionVideos(s).length > 0 && <IconBtn icon="play" label="Przejrzyj nagrania" onClick={() => openModal({ kind: 'review', sessionId: s.id })} />}
                      <IconBtn icon="eye" label="Podgląd treningu" onClick={() => setShown(s)} />
                      <IconBtn icon="edit" label="Edytuj trening" onClick={() => openModal({ kind: 'session', session: s })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
      <div className="section-gap" />
      <WorkoutList client={client} />
      {shown && (
        <SessionSheet
          s={shown}
          onClose={() => setShown(null)}
          onEdit={() => (setShown(null), openModal({ kind: 'session', session: shown }))}
          onTrainer={shown.exercises.length ? () => startLive(client.id, undefined, undefined, { repeatSessionId: shown.id }) : undefined}
          onRepeat={shown.exercises.length ? () => startAthlete(client.id, { repeatSessionId: shown.id }) : undefined}
          onReview={() => (setShown(null), openModal({ kind: 'review', sessionId: shown.id }))}
          onAssign={(other) => (setShown(null), openModal({ kind: 'assign', clientId: other ? undefined : client.id, sessionId: shown.id }))}
        />
      )}
    </>
  );
}
