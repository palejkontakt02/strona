import { useState } from 'react';
import { LocationTag } from '../components/location';
import type { TrainingSession } from '../domain';
import { sessionsOf } from '../data/ops';
import { useStore } from '../data/store';
import { fmtDay, fmtLong, fnum } from '../format';
import { todayISO } from '../lib/dates';
import { sessionLoad, tonnage } from '../lib/load';
import { num } from '../lib/parse';

/** Najbliższe zaplanowane wizyty klienta. */
export function Upcoming({ clientId }: { clientId: string }) {
  const { db } = useStore();
  const today = todayISO();
  const next = db.appointments
    .filter((a) => a.clientId === clientId && a.status === 'planned' && a.date >= today)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
    .slice(0, 4);
  if (next.length === 0) return null;
  return (
    <section className="acard">
      <h3>Najbliższe treningi</h3>
      <ul className="rows">
        {next.map((a) => (
          <li key={a.id} className="row">
            <span className="row-time">{a.time}</span>
            <div className="grow">
              <span className="first-cap">{a.date === today ? 'Dziś' : fmtLong(a.date)}</span>
              <div>
                <LocationTag id={a.locationId} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Historia odbytych treningów ze szczegółami serii. */
export function History({ clientId, onEdit }: { clientId: string; onEdit?: (s: TrainingSession) => void }) {
  const { db } = useStore();
  const sessions = sessionsOf(db, clientId);
  const [limit, setLimit] = useState(8);
  const [open, setOpen] = useState<TrainingSession | null>(null);
  return (
    <section className="acard">
      <h3>Historia treningów</h3>
      {sessions.length === 0 ? (
        <p className="muted small">Tu pojawią się Twoje treningi — zarówno te z trenerem, jak i zrobione samodzielnie.</p>
      ) : (
        <ul className="hist-list">
          {sessions.slice(0, limit).map((s) => (
            <li key={s.id}>
              <button className="hist-item" onClick={() => setOpen(s)}>
                <span className="hist-date">
                  <b>{fmtDay(s.date)}</b>
                </span>
                <span className="grow">
                  <b>{s.workoutName || 'Trening'}</b>
                  <span className="muted small">
                    {s.exercises.length} ćwiczeń
                    {s.duration ? ` · ${s.duration} min` : ''}
                    {s.srpe != null ? ` · RPE ${s.srpe}` : ''}
                  </span>
                </span>
                <span className="wo-go">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {sessions.length > limit && (
        <button className="btn btn-ghost btn-block" onClick={() => setLimit(limit + 10)}>
          Pokaż starsze
        </button>
      )}
      {open && (
        <SessionSheet
          s={open}
          onClose={() => setOpen(null)}
          onEdit={
            onEdit &&
            (() => {
              const s = open;
              setOpen(null);
              onEdit(s);
            })
          }
        />
      )}
    </section>
  );
}

function SessionSheet({ s, onClose, onEdit }: { s: TrainingSession; onClose: () => void; onEdit?: () => void }) {
  const ton = tonnage(s);
  const load = sessionLoad(s);
  return (
    <div className="sheet-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`Trening ${fmtDay(s.date)}`}>
        <div className="between">
          <div>
            <span className="eyebrow first-cap">{fmtLong(s.date)}</span>
            <h2>{s.workoutName || 'Trening'}</h2>
          </div>
          <button className="btn btn-primary btn-sm" onClick={onClose}>
            Zamknij
          </button>
        </div>
        <div className="hist-stats">
          {s.duration != null && (
            <span>
              <b>{s.duration}</b> min
            </span>
          )}
          {s.srpe != null && (
            <span>
              RPE <b>{s.srpe}</b>
            </span>
          )}
          {ton > 0 && (
            <span>
              <b>{fnum(ton / 1000, 1)}</b> t tonażu
            </span>
          )}
          {load != null && (
            <span>
              <b>{fnum(load, 0)}</b> AU
            </span>
          )}
          <LocationTag id={s.locationId} />
        </div>
        <div className="hist-ex">
          {s.exercises.map((e, i) => {
            const work = (e.setsLog ?? []).filter((x) => !x.warmup);
            const warm = (e.setsLog ?? []).filter((x) => x.warmup);
            return (
              <div key={i} className="hist-ex-row">
                <div className="between">
                  <b>
                    {e.label && <span className="ex-label">{e.label}</span>} {e.name}
                  </b>
                </div>
                {work.length > 0 ? (
                  <div className="hist-sets">
                    {warm.length > 0 && <span className="muted">rozgrzewka: {warm.map((x) => `${fnum(x.load)}×${x.reps ?? '?'}`).join(', ')}</span>}
                    {work.map((x, j) => (
                      <span key={j} className="set-chip">
                        {x.load != null ? `${fnum(x.load)} kg` : '—'} × {x.reps ?? '?'}
                        {x.rpe != null && <i> @{fnum(x.rpe)}</i>}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="muted small">
                    {[e.sets && `${e.sets} serie`, e.reps && `× ${e.reps}`, num(e.load) != null && `${fnum(num(e.load))} kg`, e.rpe && `@${e.rpe}`].filter(Boolean).join(' ')}
                  </div>
                )}
                {e.notes && <div className="muted small">{e.notes}</div>}
              </div>
            );
          })}
        </div>
        {s.notes && (
          <div className="hist-note">
            <span className="eyebrow">Notatka</span>
            <p>{s.notes}</p>
          </div>
        )}
        {onEdit && (
          <button className="btn btn-secondary btn-block" onClick={onEdit}>
            ✎ Popraw ten trening
          </button>
        )}
      </div>
    </div>
  );
}
