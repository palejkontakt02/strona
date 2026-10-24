import type { Client } from '../domain';
import { extraPlanOf, plansOf, sessionsOf } from '../data/ops';
import { useStore } from '../data/store';
import { Card } from './ui';
import { ImportActivity } from './ImportActivity';
import { fmtShort, fnum } from '../format';
import { todayISO } from '../lib/dates';
import { kmSpike, runVolume, type WeekVolume } from '../lib/running';

/** Biega: profil biegowy, kilometraż w zapisach albo w planie. */
export function isRunner(client: Client, weeks: WeekVolume[]): boolean {
  return !!(client.run?.hrMax || client.run?.t5k || client.run?.lthr) || weeks.some((w) => w.planned > 0 || w.done > 0);
}

const W = 600;

/** Słupki tydzień po tygodniu: plan (obrys) i wykonanie (wypełnienie) obok siebie. */
function PlanDoneBars({ weeks, height = 190 }: { weeks: WeekVolume[]; height?: number }) {
  const L = 6;
  const R = 6;
  const T = 22;
  const B = 26;
  const max = Math.max(1, ...weeks.flatMap((w) => [w.planned, w.done]));
  const bw = (W - L - R) / Math.max(1, weeks.length);
  const h = (v: number) => ((height - T - B) * v) / max;
  const every = weeks.length > 8 ? 2 : 1;
  return (
    <svg className="chart rv-chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`Kilometraż tygodniowy: plan i wykonanie, ostatnie ${weeks.length} tyg.`}>
      <line x1={L} x2={W - R} y1={height - B} y2={height - B} className="grid" />
      {weeks.map((w, i) => {
        const x = L + i * bw;
        const pw = bw * 0.36;
        const now = i === weeks.length - 1;
        const over = w.planned > 0 && w.done > w.planned * 1.15;
        return (
          <g key={w.week}>
            <title>{`Tydzień od ${fmtShort(w.week)}: plan ${fnum(w.planned, 1)} km, zrobione ${fnum(w.done, 1)} km`}</title>
            {w.planned > 0 && <rect x={x + bw * 0.12} y={height - B - h(w.planned)} width={pw} height={Math.max(h(w.planned), 2)} rx={3} className="rv-plan" />}
            <rect x={x + bw * 0.12 + pw + bw * 0.04} y={height - B - h(w.done)} width={pw} height={Math.max(h(w.done), w.done > 0 ? 2 : 0)} rx={3} className={over ? 'rv-over' : now ? 'bar-now' : 'bar'} />
            {w.done > 0 && (
              <text x={x + bw * 0.12 + pw * 1.5 + bw * 0.04} y={height - B - h(w.done) - 6} className="chart-val" textAnchor="middle">
                {fnum(w.done, w.done < 10 ? 1 : 0)}
              </text>
            )}
            {(i % every === (weeks.length - 1) % every) && (
              <text x={x + bw / 2} y={height - 6} className="chart-axis" textAnchor="middle">
                {fmtShort(w.week)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Kilometraż biegu: plan z aktywnego planu (z szacunkiem km z tempa celu) vs zrobione z zapisów, 8–12 tygodni.
 * `compact` — mała karta w aplikacji podopiecznego (8 tyg., bez nagłówka karty trenera).
 * Nie pokazuje się klientom, którzy nie biegają.
 */
export function RunVolume({ client, compact }: { client: Client; compact?: boolean }) {
  const { db } = useStore();
  const today = todayISO();
  const sessions = sessionsOf(db, client.id);
  const extra = extraPlanOf(db, client.id);
  const weeks = runVolume([...plansOf(db, client.id), ...(extra ? [extra] : [])], sessions, client.run, compact ? 8 : 12, today);
  if (!isRunner(client, weeks) || (compact && !weeks.some((w) => w.planned > 0 || w.done > 0))) return null;
  const cur = weeks[weeks.length - 1];
  const prev = weeks[weeks.length - 2];
  const spike = kmSpike(sessions, today);
  const pct = (w: WeekVolume) => (w.planned > 0 ? ` z ${fnum(w.planned, 1)} km planu (${Math.round((w.done / w.planned) * 100)}%)` : '');
  const body = (
    <>
      <PlanDoneBars weeks={weeks} height={compact ? 160 : 190} />
      <p className="legend rv-legend">
        <span>
          <i className="legend-swatch rv-sw-plan" /> plan
        </span>
        <span>
          <i className="legend-swatch rv-sw-done" /> zrobione
        </span>
      </p>
      <p className="small rv-sum">
        Ten tydzień: <b className="num">{fnum(cur.done, 1)} km</b>
        {pct(cur)}
        {prev && (
          <>
            {' '}
            · poprzedni: <b className="num">{fnum(prev.done, 1)} km</b>
            {pct(prev)}
          </>
        )}
      </p>
      {spike && (
        <p className={`small rv-spike ${spike.level === 'red' ? 'rv-red' : 'warn-text'}`}>
          Kilometraż +{Math.round(spike.pct * 100)}% ({Math.round(spike.from)} → {Math.round(spike.to)} km) — {compact ? 'zwiększaj stopniowo, ok. 10% na tydzień.' : 'ryzyko przeciążenia; bezpieczniej ok. 10% na tydzień.'}
        </p>
      )}
    </>
  );
  return compact ? (
    <section className="acard rv-card">
      <span className="eyebrow">Kilometraż — plan i wykonanie</span>
      {body}
    </section>
  ) : (
    <Card title="Bieganie — plan i wykonanie (km / tydz.)" className="rv-card">
      {body}
    </Card>
  );
}

/**
 * Aplikacja podopiecznego (ekran główny): import biegu z zegarka i mała karta kilometrażu — tylko dla biegających.
 * Jedna wstawka w AthleteApp, żeby nie mieszać w jego kodzie.
 */
export function AthleteRunCards({ client, canImport = true }: { client: Client; canImport?: boolean }) {
  const { db } = useStore();
  const extra = extraPlanOf(db, client.id);
  const weeks = runVolume([...plansOf(db, client.id), ...(extra ? [extra] : [])], sessionsOf(db, client.id), client.run, 8);
  if (!isRunner(client, weeks)) return null;
  return (
    <>
      {canImport && <ImportActivity clientId={client.id} />}
      <RunVolume client={client} compact />
    </>
  );
}
