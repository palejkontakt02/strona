import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Plan, PlanWorkout, RunProfile } from '../domain';
import { planGrid, type GridCell, type GridSlot } from '../lib/planGrid';
import { cardioByName } from '../lib/run';
import { NOT_RUN, planRunTotals, targetText, zoneOf } from '../lib/running';
import { Tag } from './ui';
import { fmtWeekdayDate } from '../lib/planGrid';

/** Przerwa zawsze jako m:ss: „90” → „1:30”, „2” (minuty) → „2:00”; inny zapis bez zmian. */
export function fmtRest(rest: string | undefined): string {
  const t = String(rest ?? '').trim();
  const m = t.match(/^(\d+(?:[.,]\d+)?)\s*(s|sek\.?|min)?$/i);
  if (!m) return t;
  const v = parseFloat(m[1].replace(',', '.'));
  const sec = Math.round(/min/i.test(m[2] ?? '') || (!m[2] && v <= 5) ? v * 60 : v);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/** Tydzień odciążenia: nazwa z „deload”. */
const isDeload = (name: string) => /deload/i.test(name);
const weekLabel = (name: string) => name.replace(/\s*[(–—-]?\s*deload\s*\)?\s*/i, ' ').trim() || name;

/** Szacunek biegu w jednostce: „~8 km · ~50 min” / „~31 km · ~3:10 h”. */
function runText(workouts: PlanWorkout[], profile?: RunProfile): string {
  let km = 0;
  let min = 0;
  for (const k of workouts)
    for (const e of k.exercises) {
      if (!e.name.trim() || !(e.cardio ?? cardioByName(e.name)) || NOT_RUN.test(e.name)) continue;
      const t = planRunTotals(e.groups, profile);
      km += t.km;
      min += t.min;
    }
  if (km < 0.05 && min < 1) return '';
  const kmT = km >= 0.05 ? `~${km >= 10 ? Math.round(km) : String(Math.round(km * 10) / 10).replace('.', ',')} km` : '';
  const h = Math.floor(Math.round(min) / 60);
  const minT = min >= 1 ? (h ? `~${h}:${String(Math.round(min) % 60).padStart(2, '0')} h` : `~${Math.round(min)} min`) : '';
  return [kmT, minT].filter(Boolean).join(' · ');
}

/**
 * Plan jak arkusz: dla każdego treningu (A, B, …) tabela — wiersz na serię, kolumny to tygodnie.
 * Rozgrzewki schowane, widać je po rozwinięciu.
 */
export function PlanTable({
  plan,
  done,
  nextId,
  nextDate,
  profile,
  dob,
  nextExtra,
  onLive,
  onAthlete,
}: {
  plan: Plan;
  done: Set<string>;
  nextId?: string;
  /** Rzeczywista data następnej jednostki (plan cykliczny — daty z tabeli mogą być już przeszłe). */
  nextDate?: string;
  /** Profil biegowy podopiecznego: strefy „Z2” → tętno / tempo, szacunek km. */
  profile?: RunProfile;
  dob?: string;
  /** Dodatek przy „następny” (np. szybkie „Przesuń od dziś”). */
  nextExtra?: ReactNode;
  onLive?: (workoutId: string) => void;
  onAthlete?: (workoutId: string) => void;
}) {
  const [warmOpen, setWarmOpen] = useState<Set<string>>(new Set());
  // wiersze w kolejności tygodnia „następny” (gdy kolejność ćwiczeń zmienia się między tygodniami)
  const refWeek = Math.max(0, plan.weeks.findIndex((w) => w.workouts.some((k) => k.id === nextId)));
  const slots = planGrid(plan, (s) => warmOpen.has(s), false, { refWeek });
  // suma biegu w tygodniu (gdy w tygodniu jest więcej niż jedna jednostka z biegiem)
  const weekRuns = plan.weeks.map((w) => ({ name: w.name, text: runText(w.workouts, profile), units: w.workouts.filter((k) => runText([k], profile)).length }));
  const showWeekRun = weekRuns.some((w) => w.units > 1);
  return (
    <div className="ptab-wrap">
      {showWeekRun && (
        <p className="muted small ptab-runweek">
          Bieg w tygodniu:{' '}
          {weekRuns
            .filter((w) => w.text)
            .map((w) => `${w.name} ${w.text}`)
            .join(' · ')}
        </p>
      )}
      {slots.map((s) => {
        const { name: slot, cols, hasWarm } = s;
        const next = cols.find((c) => c.k.id === nextId);
        const showWarm = warmOpen.has(slot);
        return (
          <section key={slot} className="ptab">
            <div className="ptab-head">
              <strong>{slot}</strong>
              {hasWarm && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-expanded={showWarm}
                  onClick={() => setWarmOpen((o) => (o.has(slot) ? new Set([...o].filter((x) => x !== slot)) : new Set([...o, slot])))}
                >
                  {showWarm ? 'Ukryj rozgrzewki' : 'Pokaż rozgrzewki'}
                </button>
              )}
              {next && (
                <span className="plan-workout-actions">
                  <Tag tone="accent">
                    następny: {next.week.name}
                    {nextDate ? ` · ${fmtWeekdayDate(nextDate)}` : ''}
                  </Tag>
                  {nextExtra}
                  {onLive && (
                    <button className="btn btn-primary btn-sm" onClick={() => onLive(next.k.id)}>
                      ▶ Prowadź
                    </button>
                  )}
                  {onAthlete && (
                    <button className="btn btn-secondary btn-sm" onClick={() => onAthlete(next.k.id)}>
                      Jako zawodnik
                    </button>
                  )}
                </span>
              )}
            </div>
            <GridTable slot={s} nextId={nextId} nextDate={nextDate} done={done} profile={profile} dob={dob} runTotals />
          </section>
        );
      })}
    </div>
  );
}

const WARM_NO: Record<string, string> = { R: 'Rozgrz.', S: 'Schł.', trucht: 'trucht' };

/** Komórka biegu bez przedrostka „R ” / „S ” / „trucht ” (rodzaj odcinka jest w kolumnie „Seria”). */
const runReps = (c: GridCell & { no?: string }) => (c.no && WARM_NO[c.no] ? c.reps.replace(new RegExp(`^${c.no} `), '') : c.reps);

/** Cel odcinka po ludzku z profilu podopiecznego: „Z5” → „171–180 ud./min · ~4:05–4:25/km”. */
function targetHint(load: string, profile?: RunProfile, dob?: string): { short: string; full: string } | null {
  const first = load.split(' · ')[0]?.trim();
  if (!first || first.startsWith('p. ')) return null;
  const full = targetText(first, profile, dob);
  if (!full || full === first) return null;
  const short = zoneOf(first)
    ? full
        .split(' · ')
        .slice(1)
        .join(' · ')
        .replace(/\s*\(z progu \d+\)/, '')
    : full;
  return short ? { short, full } : null;
}

/**
 * Tabela jednego treningu: wiersz na serię; każdy tydzień ma kolumny Powt. | Ciężar | RPE (bieg: odcinek | cel | RPE).
 * Puste w całej tabeli kolumny Ciężar / RPE są ukryte. Bieg w treningu siłowym (hybryda) — jedna scalona komórka „40 min · Z2”.
 */
function GridTable({
  slot,
  nextId,
  nextDate,
  done,
  noRest: noRestProp,
  profile,
  dob,
  runTotals,
}: {
  slot: GridSlot;
  nextId?: string;
  nextDate?: string;
  done?: Set<string>;
  /** Przerwa pod nazwą ćwiczenia zamiast osobnej kolumny (węższa tabela). */
  noRest?: boolean;
  profile?: RunProfile;
  dob?: string;
  /** Szacunek km / czasu biegu w nagłówku tygodnia. */
  runTotals?: boolean;
}) {
  const { cols, rows } = slot;
  const scroll = useRef<HTMLDivElement>(null);
  // telefon / wąsko: przewiń do kolumny „▶ następny” (kolumny ćwiczenia i serii są przyklejone)
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const go = () => {
      if (el.scrollWidth <= el.clientWidth + 1) return;
      const th = el.querySelector<HTMLElement>('thead th.ptab-week.is-next');
      if (!th) return;
      // prawa krawędź przyklejonych kolumn (Ćwiczenie + Seria) — kolumna „następny” zaczyna się tuż za nią
      const stuck = Math.max(0, ...[...el.querySelectorAll<HTMLElement>('thead tr:first-child th.ptab-ex, thead tr:first-child th.ptab-no')].map((x) => x.getBoundingClientRect().right));
      const edge = stuck || el.getBoundingClientRect().left;
      el.scrollLeft = Math.max(0, el.scrollLeft + th.getBoundingClientRect().left - edge);
    };
    go();
    // po wczytaniu fontów szerokości kolumn się zmieniają
    let live = true;
    void document.fonts?.ready.then(() => live && go());
    return () => {
      live = false;
    };
  }, [nextId, cols.length]);
  if (rows.length === 0) return <p className="muted small">Brak ćwiczeń.</p>;
  // sam bieg: nagłówki biegowe; bieg w treningu siłowym — scalona komórka (nagłówki siłowe go nie opisują)
  const run = rows.every((r) => r.cardio);
  const merged = (r: (typeof rows)[number]) => r.cardio && !run;
  const filled = (f: (c: GridCell) => string) => rows.some((r) => !merged(r) && r.lines.some((l) => l.cells.some((c) => c && c !== 'none' && f(c))));
  const hasLoad = filled((c) => c.load);
  const hasRpe = filled((c) => c.rpe);
  const span = 1 + Number(hasLoad) + Number(hasRpe);
  // 4+ tygodnie: przerwa pod nazwą ćwiczenia, żeby tygodnie zmieściły się bez przewijania
  const noRest = noRestProp ?? cols.length >= 4;
  const cls = (id: string, deload: boolean) => `${id === nextId ? 'is-next' : ''} ${done?.has(id) && id !== nextId ? 'is-done' : ''} ${deload ? 'ptab-deload' : ''}`;
  return (
    <div className="ptab-scroll" ref={scroll}>
      <table className={`ptab-table ${noRest ? 'ptab-norest' : ''} ${span === 1 ? 'ptab-span1' : ''}`}>
        <thead>
          <tr>
            <th className="ptab-ex" rowSpan={2}>
              Ćwiczenie
            </th>
            <th className="ptab-no" rowSpan={2}>
              {noRestProp ? 'Nr' : 'Seria'}
            </th>
            {!noRest && (
              <th className="ptab-rest" rowSpan={2}>
                Przerwa
              </th>
            )}
            {cols.map(({ week, k, date }) => {
              const dl = isDeload(week.name);
              const rt = runTotals ? runText([k], profile) : '';
              const shown = k.id === nextId && nextDate ? nextDate : date;
              return (
                <th key={week.id} colSpan={span} className={`ptab-week ${cls(k.id, dl)}`}>
                  {dl ? weekLabel(week.name) : week.name}
                  {k.id === nextId ? ' ▶' : done?.has(k.id) ? ' ✓' : ''}
                  {dl && <span className="ptab-deload-lbl">deload</span>}
                  {shown && <span className="ptab-date">{fmtWeekdayDate(shown)}</span>}
                  {rt && <span className="ptab-date ptab-runsum">{rt}</span>}
                </th>
              );
            })}
          </tr>
          <tr>
            {cols.map(({ week, k }) => {
              const c = cls(k.id, isDeload(week.name));
              return [
                <th key={`${week.id}-r`} className={`ptab-sub ptab-wk ${c}`}>
                  {run ? 'Odcinek' : 'Powt.'}
                </th>,
                hasLoad && (
                  <th key={`${week.id}-l`} className={`ptab-sub ${c}`}>
                    {run ? 'Cel' : 'Ciężar'}
                  </th>
                ),
                hasRpe && (
                  <th key={`${week.id}-p`} className={`ptab-sub ptab-sub-rpe ${c}`}>
                    RPE
                  </th>
                ),
              ];
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) =>
            r.lines.map((line, i) => {
              // bieg: „Rozgrz.” / „Schł.” zamiast numeru pozycji
              const first = line.cells.find((c): c is GridCell & { no?: string } => !!c && c !== 'none');
              const no = r.cardio && first?.no && WARM_NO[first.no] ? WARM_NO[first.no] : r.cardio && first?.no ? first.no : line.no;
              const rest = fmtRest(r.rest);
              return (
                <tr key={`${r.name}-${i}`} className={`${r.linked ? 'ptab-linked' : ''} ${i === 0 ? 'ptab-first' : ''} ${line.no.startsWith('R') || (r.cardio && first?.warm) ? 'ptab-warmline' : ''} ${r.cardio ? 'ptab-runline' : ''}`}>
                  {i === 0 && (
                    <th scope="row" className="ptab-ex" rowSpan={r.lines.length}>
                      <span className="ex-label">{r.label}</span> {r.name}
                      {r.loadPer && <span className="ptab-note">kg: {r.loadPer}</span>}
                      {noRest && rest && <span className="ptab-note">przerwa {rest}</span>}
                      {!noRest && rest && <span className="ptab-restnote">przerwa {rest}</span>}
                      {r.notes && <span className="ptab-note">{r.notes}</span>}
                    </th>
                  )}
                  <td className="ptab-no">{no}</td>
                  {i === 0 && !noRest && (
                    <td className="ptab-rest" rowSpan={r.lines.length}>
                      {rest || '—'}
                    </td>
                  )}
                  {line.cells.map((c, ci) => {
                    const { week, k } = cols[ci];
                    const id = k.id;
                    const base = `${id === nextId ? 'is-next' : ''} ${c && c !== 'none' && c.warm ? 'ptab-warm' : ''} ${isDeload(week.name) ? 'ptab-deload' : ''}`;
                    if (c === 'none')
                      return (
                        <td key={week.id} colSpan={span} className={`ptab-wk ${base} muted`}>
                          —
                        </td>
                      );
                    const hint = r.cardio && c?.load ? targetHint(c.load, profile, dob) : null;
                    const tgt = hint && profile ? <span className="ptab-tgt">{hint.short}</span> : null;
                    if (merged(r))
                      return (
                        <td key={`${week.id}-m`} colSpan={span} className={`ptab-wk ptab-runcell ${base}`} title={hint?.full}>
                          {c && [runReps(c), c.load, c.rpe && `RPE ${c.rpe}`].filter(Boolean).join(' · ')}
                          {tgt}
                        </td>
                      );
                    return [
                      <td key={`${week.id}-r`} className={`ptab-wk ${base}`}>
                        {c && (r.cardio ? runReps(c) : c.reps)}
                      </td>,
                      hasLoad && (
                        <td key={`${week.id}-l`} className={`ptab-load ${base} ${r.cardio ? 'ptab-goal' : ''}`} title={hint?.full}>
                          {c?.load}
                          {tgt}
                        </td>
                      ),
                      hasRpe && (
                        <td key={`${week.id}-p`} className={`ptab-rpe ${base}`}>
                          {c?.rpe}
                        </td>
                      ),
                    ];
                  })}
                </tr>
              );
            }),
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Jeden trening (np. poza planem, podgląd) w tym samym układzie co plan; rozgrzewki po rozwinięciu. */
export function WorkoutTable({ workout, colName = 'Plan', done, doneName = 'Wykonano' }: { workout: PlanWorkout; colName?: string; /** Wykonanie (z zapisu) — druga kolumna obok planu. */ done?: PlanWorkout; doneName?: string }) {
  const [warm, setWarm] = useState(false);
  const name = workout.name || 'Trening';
  const weeks = [{ id: 'w1', name: colName, workouts: [{ ...workout, name }] }, ...(done ? [{ id: 'w2', name: doneName, workouts: [{ ...done, name }] }] : [])];
  const [slot] = planGrid({ id: 'w', clientId: '', name: '', active: false, weeks }, () => warm, !!done);
  if (!slot) return null;
  return (
    <div className={`ptab ptab-one ${done ? 'ptab-two' : ''}`}>
      {slot.hasWarm && (
        <button type="button" className="btn btn-ghost btn-sm ptab-warm-btn" aria-expanded={warm} onClick={() => setWarm(!warm)}>
          {warm ? 'Ukryj rozgrzewki' : 'Pokaż rozgrzewki'}
        </button>
      )}
      <GridTable slot={slot} noRest={done ? true : undefined} />
    </div>
  );
}
