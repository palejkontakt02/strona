import { useMemo, useState } from 'react';
import { SessionSheet } from '../../athlete/History';
import type { Client, Plan, PlanWorkout, TrainingSession } from '../../domain';
import { Empty, Icon, IconBtn, Tag } from '../../components/ui';
import { isSolo, plansOf, sessionsOf } from '../../data/ops';
import { needsReview, sessionVideos } from '../../data/videos';
import { useStore } from '../../data/store';
import { fmtDate, fnum } from '../../format';
import { sessionLoad, tonnage } from '../../lib/load';
import { wellnessTotal } from '../../lib/wellness';
import { threadForSession } from '../../lib/chat';
import { currentPlan, nextDate, nextWorkout } from '../../lib/plan';
import { addDays, todayISO } from '../../lib/dates';
import { fmtWeekdayDate } from '../../lib/planGrid';
import { records } from '../../lib/strength';
import { fmtTon, matchesFilter, painTone, planCoverage, runRowText, SESSION_FILTERS, stoppedLabel, type SessionFilter } from '../../lib/sessionBadges';
import { useNav } from '../../nav';
import { CHARGE_SHORT, LocationTag } from '../../components/location';
import { WorkoutList } from './WorkoutList';

/** Dodatkowe informacje do znaczników (liczone raz dla całej listy). */
export interface SessionInfo {
  /** Komentarze podopiecznego przypięte do treningu. */
  comments: number;
  /** Nowy rekord (e1RM) w tym treningu. */
  record: boolean;
  /** Pominięte ćwiczenia z planu: „3/5 ćw.”. */
  coverage: { done: number; total: number } | null;
  /** Tydzień planu: „T2”. */
  week?: string;
}

/** Jednostka planu i numer tygodnia zapisanego treningu. */
function planUnit(plans: Plan[], s: TrainingSession): { workout: PlanWorkout; week: number } | null {
  if (!s.planId || !s.workoutId) return null;
  const p = plans.find((x) => x.id === s.planId);
  if (!p || p.extra) return null;
  for (let i = 0; i < p.weeks.length; i++) {
    const k = p.weeks[i].workouts.find((w) => w.id === s.workoutId);
    if (k) return { workout: k, week: i + 1 };
  }
  return null;
}

/**
 * Znaczniki przy zapisanym treningu: przerwany (czerwony), komentarz podopiecznego (bursztyn), nagrania,
 * pominięte ćwiczenia, rekord (zielony), tydzień planu, samodzielnie, komentarz trenera, w parze.
 */
export function SessionBadges({ s, info }: { s: TrainingSession; info?: SessionInfo }) {
  const { db } = useStore();
  const n = sessionVideos(s).length;
  const stop = stoppedLabel(s);
  return (
    <span className="sb-badges">
      {stop && (
        <Tag tone="danger">
          <span className="sb-stop-tag">{stop}</span>
        </Tag>
      )}
      {info && info.comments > 0 && (
        <Tag tone="warn">
          <span title="Komentarz podopiecznego do treningu" aria-label="komentarz podopiecznego">
            <Icon name="chat" size={13} /> {info.comments}
          </span>
        </Tag>
      )}
      {n > 0 && (
        <Tag tone={needsReview(s) ? 'accent' : 'muted'}>
          <span title={needsReview(s) ? 'Nagrania do obejrzenia' : 'Nagrania (obejrzane)'}>
            <Icon name="cam" size={13} /> {`${n}${needsReview(s) ? ' · do obejrzenia' : ''}`}
          </span>
        </Tag>
      )}
      {info?.coverage && (
        <Tag tone="warn">
          <span title="Zrobione ćwiczenia z planu (część pominięta)">{`${info.coverage.done}/${info.coverage.total} ćw.`}</span>
        </Tag>
      )}
      {info?.record && <Tag tone="ok">✓ rekord</Tag>}
      {info?.week && (
        <Tag tone="muted">
          <span title="Tydzień planu">{info.week}</span>
        </Tag>
      )}
      {isSolo(db, s) && <Tag tone="muted">samodzielnie</Tag>}
      {s.coachNote && (
        <Tag tone="muted">
          <span title="Komentarz trenera" aria-label="komentarz trenera">
            <Icon name="chat" size={13} />
          </span>
        </Tag>
      )}
      {s.withIds?.length ? (
        <Tag tone="muted">
          <Icon name="users" size={13} /> w parze: {s.withIds.map((id) => db.clients.find((c) => c.id === id)?.name.split(' ')[0] ?? '—').join(', ')}
        </Tag>
      ) : null}
    </span>
  );
}

/** Ból w wierszu: jeden próg kolorów (bursztyn 4–5, czerwony ≥ 6). */
function PainCell({ s }: { s: TrainingSession }) {
  const lv = s.stoppedForPain?.level ?? s.pain;
  if (lv == null) return <>—</>;
  const t = painTone(lv);
  return <Tag tone={t}>{lv}/10</Tag>;
}

/** Następny trening z aktywnego planu: nazwa, tydzień, realna data i start. */
function NextCard({ client, sessions }: { client: Client; sessions: TrainingSession[] }) {
  const { db } = useStore();
  const { startLive, startAthlete } = useNav();
  const plan = currentPlan(plansOf(db, client.id));
  const nx = nextWorkout(plan, sessions);
  if (!plan || !nx) return null;
  const today = todayISO();
  const d = nextDate(plan, nx, today);
  const date = d && (d === today ? 'dziś' : d === addDays(today, 1) ? 'jutro' : fmtWeekdayDate(d));
  const can = nx.workout.exercises.some((e) => e.name.trim());
  return (
    <div className="card sess-next">
      <div className="sess-next-main">
        <span className="eyebrow">Następny trening</span>
        <strong>{nx.workout.name}</strong>
        <span className="muted small">{[date, nx.week.name, plan.name].filter(Boolean).join(' · ')}</span>
      </div>
      {can && (
        <span className="sess-next-actions">
          <button className="btn btn-primary btn-sm" onClick={() => startLive(client.id, undefined, undefined, { planId: plan.id, workoutId: nx.workout.id })}>
            ▶ Prowadź
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => startAthlete(client.id, { planId: plan.id, workoutId: nx.workout.id })}>
            Jako zawodnik
          </button>
        </span>
      )}
    </div>
  );
}

export function ClientSessions({ client }: { client: Client }) {
  const { db } = useStore();
  const { openModal, startLive, startAthlete } = useNav();
  const sessions = sessionsOf(db, client.id);
  const [shown, setShown] = useState<TrainingSession | null>(null);
  const [filter, setFilter] = useState<SessionFilter>('all');
  const [limit, setLimit] = useState(8);
  const [tLimit, setTLimit] = useState(25);

  const plans = plansOf(db, client.id);
  const info = useMemo(() => {
    // aktualny rekord ćwiczenia (najnowszy dla każdej nazwy) — nie każdy postęp z historii
    const seen = new Set<string>();
    const rec = new Set<string>();
    for (const r of records(sessions)) {
      if (seen.has(r.name)) continue;
      seen.add(r.name);
      rec.add(`${r.date}|${r.name}`);
    }
    const out = new Map<string, SessionInfo>();
    for (const s of sessions) {
      const u = planUnit(plans, s);
      out.set(s.id, {
        comments: threadForSession(client, s.id).filter((m) => m.from === 'client').length,
        record: s.exercises.some((e) => rec.has(`${s.date}|${e.name}`)),
        coverage: u ? planCoverage(s, u.workout) : null,
        week: u ? `T${u.week}` : undefined,
      });
    }
    return out;
  }, [sessions, plans, client]);

  const counts = useMemo(() => {
    const c = {} as Record<SessionFilter, number>;
    for (const f of SESSION_FILTERS) c[f.id] = sessions.filter((s) => matchesFilter(s, f.id, isSolo(db, s))).length;
    return c;
  }, [sessions, db]);
  const list = sessions.filter((s) => matchesFilter(s, filter, isSolo(db, s)));
  const hasTon = list.some((s) => tonnage(s) > 0);
  const hasRun = list.some((s) => runRowText(s));

  return (
    <>
      <NextCard client={client} sessions={sessions} />
      <div className="toolbar">
        <h3>Zapisane treningi ({sessions.length})</h3>
        <div className="actions">
          <button className="btn btn-secondary" onClick={() => openModal({ kind: 'session', clientId: client.id, paste: true })}>
            <Icon name="clipboard" size={16} /> Wklej z notatki
          </button>
          <button className="btn btn-primary" onClick={() => openModal({ kind: 'session', clientId: client.id })}>
            + Zapisz wykonany trening
          </button>
        </div>
      </div>
      {sessions.length > 0 && (
        <div className="chips sess-filters" role="group" aria-label="Filtr treningów">
          {SESSION_FILTERS.filter((f) => f.id === 'all' || counts[f.id] > 0 || filter === f.id).map((f) => (
            <button key={f.id} type="button" className={`chip${filter === f.id ? ' active' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
              {f.id !== 'all' && <span className="sess-filter-n">{counts[f.id]}</span>}
            </button>
          ))}
        </div>
      )}
      {sessions.length === 0 ? (
        <Empty>Brak zapisanych treningów.</Empty>
      ) : list.length === 0 ? (
        <Empty>Brak treningów w tym filtrze.</Empty>
      ) : (
        <>
          {/* telefon: lista z widocznymi przyciskami (tabela przewijana w bok chowała akcje) */}
          <ul className="card rows show-mobile sess-list">
            {list.slice(0, limit).map((s) => {
              const ton = tonnage(s);
              const run = runRowText(s);
              const load = sessionLoad(s);
              const lv = s.stoppedForPain ? null : s.pain;
              return (
                <li key={s.id} className={`row row-top${s.stoppedForPain ? ' sess-stopped' : ''}`}>
                  <button className="grow sess-open" onClick={() => setShown(s)}>
                    <strong>{s.workoutName || 'Trening'}</strong>
                    <SessionBadges s={s} info={info.get(s.id)} />
                    <span className="muted small sess-meta">
                      {[fmtDate(s.date), s.duration != null && `${s.duration}\u00a0min`, s.srpe != null && `sRPE\u00a0${fnum(s.srpe)}`, load != null && `${fnum(load, 0)}\u00a0AU`, run, ton ? fmtTon(ton) : null].filter(Boolean).join(' · ')}
                      {lv != null && lv >= 4 && (
                        <>
                          {' · '}
                          <span className={`pain-${painTone(lv)}`}>ból {lv}/10</span>
                        </>
                      )}
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
            {list.length > limit && (
              <li className="sess-more">
                <button className="btn btn-ghost btn-block" onClick={() => setLimit(limit + 20)}>
                  Pokaż starsze ({list.length - limit})
                </button>
              </li>
            )}
          </ul>
          <div className="card table-wrap hide-mobile sess-table-wrap">
            <table className="table sess-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Trening</th>
                  <th className="num">Czas</th>
                  <th className="num">sRPE</th>
                  <th className="num">AU</th>
                  {hasTon && <th className="num">Tonaż</th>}
                  {hasRun && <th className="num">km / tempo</th>}
                  <th className="num">Wellness</th>
                  <th className="num">Ból</th>
                  <th>Rozliczenie</th>
                  <th>
                    <span className="sr-only">Akcje</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.slice(0, tLimit).map((s) => {
                  const w = wellnessTotal(s.wellness);
                  const ton = tonnage(s);
                  const run = runRowText(s);
                  return (
                    <tr key={s.id} className={`tr-click${s.stoppedForPain ? ' sess-stopped' : ''}`} onClick={(e) => !(e.target as HTMLElement).closest('button') && setShown(s)}>
                      <td className="nowrap">{fmtDate(s.date)}</td>
                      <td className="sess-name">
                        <span className="sess-title">
                          {s.workoutName || 'Trening'} <LocationTag id={s.locationId} short />
                        </span>
                        <SessionBadges s={s} info={info.get(s.id)} />
                        {s.notes && <div className="muted small ellipsis sess-note">{s.notes}</div>}
                      </td>
                      <td className="num nowrap">{s.duration != null ? `${s.duration} min` : '—'}</td>
                      <td className="num">{fnum(s.srpe)}</td>
                      <td className="num">{fnum(sessionLoad(s), 0)}</td>
                      {hasTon && <td className="num nowrap">{ton ? fmtTon(ton) : '—'}</td>}
                      {hasRun && <td className="num nowrap">{run ?? '—'}</td>}
                      <td className="num">{w != null ? `${w}/25` : '—'}</td>
                      <td className="num">
                        <PainCell s={s} />
                      </td>
                      <td className="muted small">{CHARGE_SHORT[s.charge]}</td>
                      <td className="actions nowrap">
                        {sessionVideos(s).length > 0 && <IconBtn icon="play" label="Przejrzyj nagrania" onClick={() => openModal({ kind: 'review', sessionId: s.id })} />}
                        <IconBtn icon="eye" label="Podgląd treningu" onClick={() => setShown(s)} />
                        <IconBtn icon="edit" label="Edytuj trening" onClick={() => openModal({ kind: 'session', session: s })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {list.length > tLimit && (
              <button className="btn btn-ghost btn-block" onClick={() => setTLimit(tLimit + 25)}>
                Pokaż starsze ({list.length - tLimit})
              </button>
            )}
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
