/**
 * Zakładka „Postępy” podopiecznego — sekcje dodatkowe (montowane przez AthleteApp na górze zakładki):
 * podsumowanie miesiąca, serie na partię mięśniową, trend samopoczucia, kamienie milowe.
 * Logika w lib/progress*.ts; tu tylko widok. Czarno-białe: zielony = rekord / osiągnięte, bursztyn = spadek samopoczucia.
 */
import { useMemo, useState, type ReactNode } from 'react';
import type { Client, TrainingSession } from '../../domain';
import { Icon } from '../../components/ui';
import { sessionsOf } from '../../data/ops';
import { useStore } from '../../data/store';
import { fmtDate, fmtDay, fmtShort, fnum, fx, plural } from '../../format';
import { todayISO } from '../../lib/dates';
import { num } from '../../lib/parse';
import { records } from '../../lib/strength';
import { WELLNESS_ITEMS } from '../../lib/wellness';
import { absentWeek } from '../../lib/absence';
import type { Absence } from '../../domain';
import { milestones, monthsRange, monthSummary, shiftMonth, type MilestoneKind, type NextMilestone } from '../../lib/progress';
import { MUSCLE_LABEL, muscleTier, weeklyMuscleSets, type Muscle, type MuscleWeekRow } from '../../lib/progressMuscles';
import { dailyWellness, wellnessChange, wellnessWeeks, type WellnessWeek, type WellKey } from '../../lib/progressWellness';

const NF0 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 });
const NF1 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 });

export function ProgressExtra({ client }: { client: Client }) {
  const { db } = useStore();
  const sessions = sessionsOf(db, client.id);
  const today = todayISO();
  return (
    <div className="pg">
      <MonthCard sessions={sessions} today={today} />
      <MuscleCard sessions={sessions} today={today} />
      <WellnessCard client={client} sessions={sessions} today={today} />
      <MilestonesCard sessions={sessions} today={today} absences={client.absences} />
    </div>
  );
}

/* ---------- podsumowanie miesiąca ---------- */

const monthName = (ym: string) => new Date(ym + '-15T12:00:00').toLocaleDateString('pl-PL', { month: 'long' });
const monthTitle = (ym: string, today: string) => {
  const n = monthName(ym);
  return ym.slice(0, 4) === today.slice(0, 4) ? n : `${n} ${ym.slice(0, 4)}`;
};
const tons = (kg: number) => kg / 1000;

function Chevron({ dir }: { dir: 'l' | 'r' }) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={dir === 'l' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  );
}

function signed(v: number, f: (n: number) => string): string {
  if (Math.abs(v) < 1e-9) return 'tyle samo';
  return `${v > 0 ? '+' : '−'}${f(Math.abs(v))}`;
}

function MonthCard({ sessions, today }: { sessions: TrainingSession[]; today: string }) {
  const months = useMemo(() => monthsRange(sessions, today), [sessions, today]);
  const [idx, setIdx] = useState<number | null>(null);
  const i = idx == null || idx >= months.length ? months.length - 1 : idx;
  const ym = months[i];
  const allRecs = useMemo(() => records(sessions), [sessions]);
  const cur = monthSummary(sessions, ym, allRecs);
  const prevYm = shiftMonth(ym, -1);
  const prev = monthSummary(sessions, prevYm, allRecs);
  const showKm = cur.km > 0 || prev.km > 0;
  const prevName = monthName(prevYm);

  const stats: { label: string; value: string; unit?: string; delta: string }[] = [
    { label: 'Treningi', value: NF0.format(cur.sessions), delta: `${prevName}: ${NF0.format(prev.sessions)} · ${signed(cur.sessions - prev.sessions, NF0.format)}` },
    { label: 'Tonaż', value: NF1.format(tons(cur.tonnage)), unit: 't', delta: `${prevName}: ${NF1.format(tons(prev.tonnage))}\u00a0t · ${signed(tons(cur.tonnage - prev.tonnage), (v) => NF1.format(v) + '\u00a0t')}` },
  ];
  if (showKm) stats.push({ label: 'Bieg', value: NF1.format(cur.km), unit: 'km', delta: `${prevName}: ${NF1.format(prev.km)}\u00a0km · ${signed(cur.km - prev.km, (v) => NF1.format(v) + '\u00a0km')}` });

  return (
    <section className="acard pg-card" aria-labelledby="pg-month-h">
      <div className="pg-head">
        <h3 id="pg-month-h">Podsumowanie miesiąca</h3>
        <div className="pg-month-nav">
          <button type="button" className="pg-nav-btn" aria-label="Poprzedni miesiąc" disabled={i <= 0} onClick={() => setIdx(i - 1)}>
            <Chevron dir="l" />
          </button>
          <span className="pg-month-name" aria-live="polite">
            {monthTitle(ym, today)}
          </span>
          <button type="button" className="pg-nav-btn" aria-label="Następny miesiąc" disabled={i >= months.length - 1} onClick={() => setIdx(i + 1)}>
            <Chevron dir="r" />
          </button>
        </div>
      </div>
      <div className={`pg-stats pg-stats-${stats.length}`}>
        {stats.map((s) => (
          <div key={s.label} className="pg-stat">
            <span className="pg-stat-label">{s.label}</span>
            <strong className="pg-num pg-stat-val">
              {s.value}
              {s.unit && <small> {s.unit}</small>}
            </strong>
            <span className="pg-stat-delta">{s.delta}</span>
          </div>
        ))}
      </div>
      <h4 className="pg-sub">Rekordy miesiąca</h4>
      {cur.records.length === 0 ? (
        <p className="muted small">{cur.sessions ? 'W tym miesiącu bez nowych rekordów.' : 'Brak treningów w tym miesiącu.'}</p>
      ) : (
        <ul className="pg-list">
          {cur.records.slice(0, 5).map((r) => (
            <li key={r.name} className="pg-rec">
              <span className="pg-rec-ico">
                <Icon name="star" size={16} />
              </span>
              <span className="pg-grow">
                {r.name}
                <span className="muted small"> · {fmtDay(r.date)}</span>
              </span>
              <span className="pg-rec-val">
                <span className="pg-num">
                  {String(r.reps)} × {fnum(num(r.load))} kg
                </span>
                <span className="muted small">+{fx(r.gain, 1)} kg szac. maks.</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------- serie na partię mięśniową ---------- */

const TIER_NAME = ['brak serii', '1–9 serii', '10 i więcej serii'];

function MuscleCard({ sessions, today }: { sessions: TrainingSession[]; today: string }) {
  const rows = useMemo(() => weeklyMuscleSets(sessions, today), [sessions, today]);
  const any = rows.some((r) => r.now > 0 || r.prev > 0);
  const max = Math.max(10, ...rows.flatMap((r) => [r.now, r.prev]));
  const sets = Object.fromEntries(rows.map((r) => [r.muscle, r.now])) as Record<Muscle, number>;
  return (
    <section className="acard pg-card" aria-labelledby="pg-mus-h">
      <h3 id="pg-mus-h">Serie na partię mięśniową</h3>
      <p className="muted small">Ten tydzień · kreska — poprzedni tydzień · mięśnie pomocnicze liczone jako ½ serii</p>
      {!any ? (
        <p className="muted small">Serie pojawią się po pierwszym treningu siłowym w tym albo poprzednim tygodniu.</p>
      ) : (
        <div className="pg-mus">
          <ul className="pg-bars" aria-label="Serie robocze na partię mięśniową w tym tygodniu">
            {rows.map((r) => (
              <MuscleBar key={r.muscle} r={r} max={max} />
            ))}
          </ul>
          <Body sets={sets} />
        </div>
      )}
    </section>
  );
}

function MuscleBar({ r, max }: { r: MuscleWeekRow; max: number }) {
  const t = muscleTier(r.now);
  return (
    <li className="pg-bar-row">
      <span className="pg-bar-label">{r.label}</span>
      <span className="pg-bar-track" aria-hidden>
        <i className={`pg-bar pg-tier-${t}`} style={{ width: `${(r.now / max) * 100}%` }} />
        {r.prev > 0 && <i className="pg-bar-prev" style={{ left: `${(r.prev / max) * 100}%` }} />}
      </span>
      <span className="pg-bar-val">
        <b className="pg-num">{NF1.format(r.now)}</b>
        <span className="muted small"> / {NF1.format(r.prev)}</span>
      </span>
    </li>
  );
}

function Part({ m, sets, children }: { m: Muscle; sets: Record<Muscle, number>; children: ReactNode }) {
  return (
    <g className={`pg-m pg-tier-${muscleTier(sets[m])}`}>
      <title>{`${MUSCLE_LABEL[m]}: ${NF1.format(sets[m])} ${plural(Math.round(sets[m]), 'seria', 'serie', 'serii')}`}</title>
      {children}
    </g>
  );
}

/** Prosta sylwetka przód / tył; odcień partii wg liczby serii w tym tygodniu. */
function Body({ sets }: { sets: Record<Muscle, number> }) {
  const base = (
    <g className="pg-body-base">
      <circle cx={50} cy={15} r={10} />
      <rect x={45} y={25} width={10} height={8} rx={2} />
      <ellipse cx={20} cy={93} rx={5} ry={13} />
      <ellipse cx={80} cy={93} rx={5} ry={13} />
      <path d="M36 92h28l2 14H34z" />
    </g>
  );
  return (
    <div className="pg-body">
      <figure>
        <svg viewBox="0 0 100 200" role="img" aria-label="Sylwetka z przodu">
          {base}
          <ellipse className="pg-body-base" cx={41} cy={170} rx={6} ry={16} />
          <ellipse className="pg-body-base" cx={59} cy={170} rx={6} ry={16} />
          <Part sets={sets} m="barki">
            <ellipse cx={29} cy={42} rx={8} ry={7} />
            <ellipse cx={71} cy={42} rx={8} ry={7} />
          </Part>
          <Part sets={sets} m="klatka">
            <path d="M36 36h13v20c-5 2-10 1-13-2z" />
            <path d="M64 36H51v20c5 2 10 1 13-2z" />
          </Part>
          <Part sets={sets} m="biceps">
            <ellipse cx={23} cy={64} rx={5.5} ry={12} />
            <ellipse cx={77} cy={64} rx={5.5} ry={12} />
          </Part>
          <Part sets={sets} m="brzuch">
            <rect x={39} y={59} width={22} height={31} rx={5} />
          </Part>
          <Part sets={sets} m="czworoglowe">
            <ellipse cx={41} cy={128} rx={8.5} ry={21} />
            <ellipse cx={59} cy={128} rx={8.5} ry={21} />
          </Part>
        </svg>
        <figcaption>Przód</figcaption>
      </figure>
      <figure>
        <svg viewBox="0 0 100 200" role="img" aria-label="Sylwetka z tyłu">
          {base}
          <Part sets={sets} m="barki">
            <ellipse cx={29} cy={42} rx={8} ry={7} />
            <ellipse cx={71} cy={42} rx={8} ry={7} />
          </Part>
          <Part sets={sets} m="plecy">
            <path d="M37 35h26l1 16-6 38H42l-6-38z" />
          </Part>
          <Part sets={sets} m="triceps">
            <ellipse cx={23} cy={64} rx={5.5} ry={12} />
            <ellipse cx={77} cy={64} rx={5.5} ry={12} />
          </Part>
          <Part sets={sets} m="posladki">
            <ellipse cx={42.5} cy={104} rx={8} ry={9} />
            <ellipse cx={57.5} cy={104} rx={8} ry={9} />
          </Part>
          <Part sets={sets} m="dwuglowe">
            <ellipse cx={41} cy={133} rx={7.5} ry={18} />
            <ellipse cx={59} cy={133} rx={7.5} ry={18} />
          </Part>
          <Part sets={sets} m="lydki">
            <ellipse cx={41} cy={170} rx={6.5} ry={15} />
            <ellipse cx={59} cy={170} rx={6.5} ry={15} />
          </Part>
        </svg>
        <figcaption>Tył</figcaption>
      </figure>
      <ul className="pg-key" aria-label="Odcienie">
        {TIER_NAME.map((n, t) => (
          <li key={n}>
            <i className={`pg-tier-${t}`} /> {n}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- trend samopoczucia ---------- */

function WellnessCard({ client, sessions, today }: { client: Client; sessions: TrainingSession[]; today: string }) {
  const daily = useMemo(() => dailyWellness(client.checkins ?? [], sessions), [client.checkins, sessions]);
  const weeks = useMemo(() => wellnessWeeks(daily, today, 8), [daily, today]);
  const filled = weeks.filter((w) => w.days > 0).length;
  const items = WELLNESS_ITEMS.filter(([k]) => weeks.some((w) => w.avg[k] != null));
  return (
    <section className="acard pg-card" aria-labelledby="pg-well-h">
      <h3 id="pg-well-h">Samopoczucie</h3>
      {filled < 2 || !items.length ? (
        <p className="muted small">Trend pojawi się po 2 tygodniach wpisów „Jak się dziś czujesz?” na ekranie Dziś.</p>
      ) : (
        <>
          <p className="muted small">
            Średnie tygodniowe z 8 tygodni ({fmtShort(weeks[0].week)} – dziś) · skala 1–5, wyżej = lepiej
          </p>
          <ul className="pg-well">
            {items.map(([k, label]) => (
              <WellRow key={k} k={k} label={label} weeks={weeks} change={wellnessChange(daily, k, today)} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function WellRow({ k, label, weeks, change }: { k: WellKey; label: string; weeks: WellnessWeek[]; change: ReturnType<typeof wellnessChange> }) {
  const last = [...weeks].reverse().find((w) => w.avg[k] != null);
  return (
    <li className="pg-well-row">
      <div className="pg-well-text">
        <span className="pg-well-label">{label}</span>
        {change ? (
          <span className={`small ${change.attention ? 'pg-warn' : 'muted'}`}>
            {change.attention && <Icon name="alert" size={14} />} {change.text}
          </span>
        ) : (
          <span className="muted small">za mało wpisów do porównania</span>
        )}
      </div>
      <Spark weeks={weeks} k={k} label={label} />
      <b className="pg-num pg-well-val" title="Średnia z ostatniego tygodnia z wpisami">
        {last ? fx(last.avg[k]!, 1) : '—'}
      </b>
    </li>
  );
}

function Spark({ weeks, k, label }: { weeks: WellnessWeek[]; k: WellKey; label: string }) {
  const W = 300;
  const H = 48;
  const P = 5;
  const X = (i: number) => P + (i * (W - 2 * P)) / Math.max(1, weeks.length - 1);
  const Y = (v: number) => P + ((5 - v) / 4) * (H - 2 * P);
  // linia przerywana przy tygodniach bez wpisów
  const segs: string[][] = [];
  let cur: string[] = [];
  weeks.forEach((w, i) => {
    const v = w.avg[k];
    if (v == null) {
      if (cur.length) segs.push(cur);
      cur = [];
    } else cur.push(`${X(i)},${Y(v)}`);
  });
  if (cur.length) segs.push(cur);
  let lastI = -1;
  weeks.forEach((w, i) => {
    if (w.avg[k] != null) lastI = i;
  });
  return (
    <svg className="pg-spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: średnie tygodniowe`}>
      <line x1={P} x2={W - P} y1={Y(3)} y2={Y(3)} className="pg-spark-mid" />
      {segs.map((s, i) => (
        <polyline key={i} points={s.join(' ')} className="pg-spark-line" />
      ))}
      {weeks.map((w, i) =>
        w.avg[k] == null ? null : (
          <circle key={w.week} cx={X(i)} cy={Y(w.avg[k]!)} r={i === lastI ? 4 : 2.5} className={i === lastI ? 'pg-spark-now' : 'pg-spark-pt'}>
            <title>{`tydz. od ${fmtShort(w.week)}: ${fx(w.avg[k]!, 1)}`}</title>
          </circle>
        ),
      )}
    </svg>
  );
}

/* ---------- kamienie milowe ---------- */

function progressText(n: NextMilestone): string {
  const f = n.kind === 'tonnage' || n.kind === 'km' ? (v: number) => NF1.format(Math.floor(v * 10) / 10) : (v: number) => NF0.format(Math.floor(v));
  const unit: Record<MilestoneKind, string> = { sessions: '', tonnage: ' t', km: ' km', streak: ' tyg.' };
  return `${f(n.value)}/${NF0.format(n.target)}${unit[n.kind]}`;
}

function MilestonesCard({ sessions, today, absences }: { sessions: TrainingSession[]; today: string; absences?: Absence[] }) {
  // tygodnie w całości na zgłoszonej nieobecności nie przerywają serii tygodni
  const m = useMemo(() => milestones(sessions, today, absences?.length ? absentWeek(absences) : undefined), [sessions, today, absences]);
  const [all, setAll] = useState(false);
  const shown = all ? m.achieved : m.achieved.slice(0, 5);
  return (
    <section className="acard pg-card" aria-labelledby="pg-ms-h">
      <h3 id="pg-ms-h">Kamienie milowe</h3>
      <h4 className="pg-sub">Następne</h4>
      <ul className="pg-list">
        {m.next.map((n) => (
          <li key={n.kind} className="pg-next">
            <div className="pg-next-top">
              <span className="pg-grow">{n.label}</span>
              <span className="pg-num pg-next-val">{progressText(n)}</span>
            </div>
            <span className="pg-meter" role="progressbar" aria-label={n.label} aria-valuemin={0} aria-valuemax={n.target} aria-valuenow={Math.min(n.value, n.target)}>
              <i style={{ width: `${Math.min(100, (n.value / n.target) * 100)}%` }} />
            </span>
          </li>
        ))}
      </ul>
      {m.next.find((n) => n.kind === 'streak') && <p className="muted small">Seria tygodni: liczy się tydzień z co najmniej jednym treningiem; tydzień zgłoszonej nieobecności jej nie przerywa.</p>}
      {m.achieved.length > 0 && (
        <>
          <h4 className="pg-sub">Osiągnięte</h4>
          <ul className="pg-list">
            {shown.map((a) => (
              <li key={`${a.kind}-${a.target}`} className="pg-done">
                <span className="pg-done-ico">
                  <Icon name="check" size={16} />
                </span>
                <span className="pg-grow">{a.label}</span>
                <span className="muted small pg-num-plain">{fmtDate(a.date)}</span>
              </li>
            ))}
          </ul>
          {m.achieved.length > 5 && (
            <button type="button" className="link small pg-more" onClick={() => setAll(!all)}>
              {all ? 'Pokaż mniej' : `Pokaż wszystkie (${m.achieved.length})`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
