import { Card, Empty, Icon, Tag } from '../../components/ui';
import type { Client, Plan } from '../../domain';
import { extraPlanOf, plansOf, sessionsOf } from '../../data/ops';
import { useStore } from '../../data/store';
import { fmtDate, plural } from '../../format';
import { currentPlan, doneInPass, nextDate, nextWorkout, planSequence, workoutDate } from '../../lib/plan';
import { fmtWeekdayDate } from '../../lib/planGrid';
import { addDays, daysBetween, todayISO } from '../../lib/dates';
import { planWorkoutSummary } from '../../lib/sessionBadges';
import { useNav } from '../../nav';
import { useState } from 'react';
import type { PlanWorkout, TrainingSession } from '../../domain';
import { WorkoutPreview } from '../../athlete/WorkoutPreview';
import { SessionSheet } from '../../athlete/History';
import { newPlan } from './Plans';

/**
 * Wszystkie treningi podopiecznego w jednym miejscu: jednostki z aktywnego planu i dodatkowe (poza planem).
 * Przy każdej: prowadź (trener), jako zawodnik, edytuj.
 */
export function WorkoutList({ client }: { client: Client }) {
  const { db } = useStore();
  const { openModal, startLive, startAthlete } = useNav();
  const sessions = sessionsOf(db, client.id);
  const plan = currentPlan(plansOf(db, client.id));
  const extra = extraPlanOf(db, client.id);
  const nx = nextWorkout(plan, sessions);
  // „zrobione” jak w zakładce Plan: tylko w bieżącym przejściu planu (przerwany z bólu się nie liczy)
  const inPass = doneInPass(plan, sessions);
  const today = todayISO();
  const nxWeek = plan && nx ? plan.weeks.indexOf(nx.week) : -1;
  const [showPast, setShowPast] = useState(false);
  const allGroups: { plan: Plan; label: string; weekIndex: number; workouts: Plan['weeks'][number]['workouts'] }[] = [
    ...(plan ? plan.weeks.map((w, i) => ({ plan, label: `${plan.name} · ${w.name}`, weekIndex: i, workouts: w.workouts })) : []),
    ...(extra ? [{ plan: extra, label: 'Poza planem', weekIndex: -1, workouts: extra.weeks.flatMap((w) => w.workouts) }] : []),
  ].filter((g) => g.workouts.length);
  // minione tygodnie bieżącego przejścia (przed tygodniem następnej jednostki) — zwinięte
  const isPast = (g: { plan: Plan; weekIndex: number }) => !g.plan.extra && nxWeek > 0 && g.weekIndex < nxWeek;
  const pastN = allGroups.filter(isPast).length;
  const groups = showPast ? allGroups : allGroups.filter((g) => !isPast(g));
  // planowana data kolejnych jednostek w bieżącym przejściu: data z planu przesunięta o pełne przejścia, nie wcześniej niż następna
  const nxDate = plan && nx ? nextDate(plan, nx, today) : undefined;
  const seq = plan ? planSequence(plan).map((x) => x.workout.id) : [];
  const after = new Set(nx ? seq.slice(seq.indexOf(nx.workout.id) + 1) : []);
  const upcomingDate = (g: { plan: Plan; weekIndex: number }, k: PlanWorkout): string | undefined => {
    if (g.plan.extra) return k.date;
    if (!after.has(k.id)) return undefined;
    const d = workoutDate(g.plan, g.weekIndex, k);
    if (!d || !plan || !nx) return undefined;
    // odstęp od następnej jednostki wg planu, liczony od jej realnej daty
    const base = workoutDate(plan, Math.max(0, nxWeek), nx.workout);
    if (!base || !nxDate) return undefined;
    let diff = daysBetween(base, d);
    if (diff <= 0) diff += Math.max(1, plan.weeks.length) * 7;
    return addDays(nxDate, diff);
  };
  const dayText = (d: string) => (d === today ? 'dziś' : d === addDays(today, 1) ? 'jutro' : fmtWeekdayDate(d));
  // Treningi zrobione bez planu (np. wklejone z notatki, „pusty trening”) — też do podglądu i powtórki.
  const adhoc = sessions.filter((s) => !s.planId || !db.plans.some((p) => p.id === s.planId)).slice(0, 12);
  // ostatnie zaliczone wykonanie (bez przerwanych z bólu) i ostatnie w ogóle
  const lastSession = (p: Plan, id: string) => sessions.find((s) => s.planId === p.id && s.workoutId === id && !s.stoppedForPain);
  const lastAny = (p: Plan, id: string) => sessions.find((s) => s.planId === p.id && s.workoutId === id);
  const last = (p: Plan, id: string) => lastSession(p, id)?.date;
  const [preview, setPreview] = useState<{ workout: PlanWorkout; plan: Plan } | null>(null);
  const [shown, setShown] = useState<TrainingSession | null>(null);

  return (
    <Card
      title="Wszystkie treningi"
      action={
        <div className="actions">
          {!plan && (
            <button className="btn btn-ghost btn-sm" onClick={() => openModal({ kind: 'plan', plan: newPlan(client.id), isNew: true })}>
              + Plan
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={() => openModal({ kind: 'assign', clientId: client.id })}>
            + Zadaj trening
          </button>
        </div>
      }
    >
      {groups.length === 0 && adhoc.length === 0 ? (
        <Empty>Brak treningów. Dodaj plan albo trening poza planem.</Empty>
      ) : (
        <>
        {pastN > 0 && (
          <button type="button" className="btn btn-ghost btn-sm wl-past" aria-expanded={showPast} onClick={() => setShowPast(!showPast)}>
            {showPast ? 'Zwiń minione tygodnie' : `Pokaż minione tygodnie (${pastN})`}
          </button>
        )}
        {groups.map((g) => (
          <div key={g.label} className="wl-group">
            <div className="wl-label">{g.label}</div>
            <ul className="rows">
              {g.workouts.map((k) => {
                const n = k.exercises.filter((e) => e.name).length;
                const isNext = !g.plan.extra && nx?.workout.id === k.id;
                // plan: zrobione tylko w bieżącym przejściu (jak w zakładce Plan); poza planem — dowolne wykonanie
                const dn = g.plan.extra || inPass.has(k.id) ? last(g.plan, k.id) : undefined;
                const la = lastAny(g.plan, k.id);
                const stopped = !dn && la?.stoppedForPain ? la : undefined;
                const when = isNext ? nextDate(g.plan, nx, today) : !dn && !stopped ? upcomingDate(g, k) : undefined;
                return (
                  <li key={k.id} className={`row wl-row ${isNext ? 'is-next' : ''}`}>
                    <div className="grow">
                      <strong>{k.name}</strong>{' '}
                      {isNext && <Tag tone="accent">następny</Tag>}{' '}
                      {stopped ? (
                        <Tag tone="warn">
                          <span title="Trening przerwany z powodu bólu — jednostka nie jest zaliczona">przerwany {fmtDate(stopped.date)}</span>
                        </Tag>
                      ) : dn && !isNext ? (
                        <Tag tone="ok">✓ {fmtDate(dn)}</Tag>
                      ) : null}
                      <div className="muted small">{[when && dayText(when), planWorkoutSummary(k, client.run)].filter(Boolean).join(' · ')}</div>
                    </div>
                    <span className="wl-actions">
                      {/* start od razu przy następnym (i dodatkowych); pozostałe — z podglądu */}
                      {n > 0 && (isNext || g.plan.extra) && (
                        <>
                          <button className="btn btn-primary btn-sm" onClick={() => startLive(client.id, undefined, undefined, { planId: g.plan.id, workoutId: k.id })}>
                            ▶ Prowadź
                          </button>
                          <button className="btn btn-secondary btn-sm" onClick={() => startAthlete(client.id, { planId: g.plan.id, workoutId: k.id })}>
                            Jako zawodnik
                          </button>
                        </>
                      )}
                      <button className="btn btn-ghost btn-sm" onClick={() => setPreview({ workout: k, plan: g.plan })} title="Ćwiczenia, serie i start jako trener lub podopieczny">
                        <Icon name="eye" size={15} /> {isNext || g.plan.extra ? 'Podgląd' : 'Podgląd i start'}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => openModal({ kind: 'plan', plan: g.plan, focusWorkoutId: k.id })}>
                        <Icon name="edit" size={15} /> Edytuj
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        </>
      )}
      {adhoc.length > 0 && (
        <div className="wl-group">
          <div className="wl-label">Wykonane bez planu</div>
          <ul className="rows">
            {adhoc.map((s) => (
              <li key={s.id} className="row wl-row">
                <div className="grow">
                  <strong>{s.workoutName || 'Trening'}</strong>{' '}
                  {s.stoppedForPain ? <Tag tone="warn">przerwany {fmtDate(s.date)}</Tag> : <Tag tone="ok">✓ {fmtDate(s.date)}</Tag>}
                  <div className="muted small">
                    {(() => {
                      const ex = s.exercises.length;
                      const sets = s.exercises.reduce((a, e) => a + (e.setsLog?.filter((x) => !x.warmup).length ?? (parseInt(e.sets ?? '', 10) || 0)), 0);
                      return `${ex} ${plural(ex, 'ćwiczenie', 'ćwiczenia', 'ćwiczeń')} · ${sets} ${plural(sets, 'seria', 'serie', 'serii')}`;
                    })()}
                  </div>
                </div>
                <span className="wl-actions">
                  {s.exercises.length > 0 && (
                    <>
                      <button className="btn btn-primary btn-sm" onClick={() => startLive(client.id, undefined, undefined, { repeatSessionId: s.id })}>
                        ▶ Prowadź
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => startAthlete(client.id, { repeatSessionId: s.id })}>
                        Jako zawodnik
                      </button>
                    </>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => setShown(s)}>
                    <Icon name="eye" size={15} /> Podgląd
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => openModal({ kind: 'session', session: s })}>
                    <Icon name="edit" size={15} /> Edytuj
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {preview && (
        <WorkoutPreview
          workout={preview.workout}
          done={last(preview.plan, preview.workout.id)}
          extra={preview.plan.extra}
          session={lastSession(preview.plan, preview.workout.id)}
          onClose={() => setPreview(null)}
          onShowDone={() => setShown(lastSession(preview.plan, preview.workout.id) ?? null)}
          onStart={preview.workout.exercises.some((e) => e.name) ? () => startAthlete(client.id, { planId: preview.plan.id, workoutId: preview.workout.id }) : undefined}
          onTrainer={() => startLive(client.id, undefined, undefined, { planId: preview.plan.id, workoutId: preview.workout.id })}
        />
      )}
      {shown && (
        <SessionSheet
          s={shown}
          onClose={() => setShown(null)}
          onEdit={() => (setShown(null), setPreview(null), openModal({ kind: 'session', session: shown }))}
          onAssign={(other) => (setShown(null), setPreview(null), openModal({ kind: 'assign', clientId: other ? undefined : client.id, sessionId: shown.id }))}
        />
      )}
    </Card>
  );
}
