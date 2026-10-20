import { fmtShort } from '../format';

export interface Pt {
  x: string;
  y: number;
}

const W = 600;

/** Wykres słupkowy (np. tygodniowe obciążenie). */
export function BarChart({ pts, height = 180, label, format = (v: number) => String(Math.round(v)) }: { pts: Pt[]; height?: number; label: string; format?: (v: number) => string }) {
  const L = 8;
  const R = 8;
  const T = 18;
  const B = 24;
  const max = Math.max(1, ...pts.map((p) => p.y));
  const bw = (W - L - R) / Math.max(1, pts.length);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label}>
      {pts.map((p, i) => {
        const h = ((height - T - B) * p.y) / max;
        const x = L + i * bw + bw * 0.18;
        const y = height - B - h;
        const last = i === pts.length - 1;
        return (
          <g key={p.x}>
            <rect x={x} y={y} width={bw * 0.64} height={Math.max(h, p.y > 0 ? 2 : 0)} rx={3} className={last ? 'bar-now' : 'bar'} />
            {p.y > 0 && (
              <text x={x + bw * 0.32} y={y - 5} className="chart-val" textAnchor="middle">
                {format(p.y)}
              </text>
            )}
            {(pts.length <= 7 || i % 2 === (pts.length - 1) % 2) && (
              <text x={x + bw * 0.32} y={height - 6} className="chart-axis" textAnchor="middle">
                {fmtShort(p.x)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export interface Series {
  label: string;
  pts: Pt[];
  tone?: 'accent' | 'cyan' | 'green' | 'muted';
}

export interface RefLine {
  y: number;
  label: string;
  tone: 'ok' | 'warn' | 'danger' | 'muted';
}

/** Wykres liniowy z osią czasu i liniami odniesienia. */
export function LineChart({
  series: rawSeries,
  refs = [],
  height = 200,
  label,
  format = (v: number) => v.toLocaleString('pl-PL', { maximumFractionDigits: 1 }),
  minY,
}: {
  series: Series[];
  refs?: RefLine[];
  height?: number;
  label: string;
  format?: (v: number) => string;
  minY?: number;
}) {
  // punkty bez poprawnej daty (np. stary pomiar z pustą datą) nie psują osi
  const series = rawSeries.map((s) => ({ ...s, pts: s.pts.filter((p) => /^\d{4}-\d{2}-\d{2}/.test(p.x) && Number.isFinite(p.y)) }));
  const all = series.flatMap((s) => s.pts);
  if (all.length < 2) return <p className="empty">Za mało danych do wykresu.</p>;
  const R = 12;
  const T = 12;
  const B = 24;
  const xs = all.map((p) => new Date(p.x).getTime());
  const t0 = Math.min(...xs);
  const t1 = Math.max(...xs);
  const ys = [...all.map((p) => p.y), ...refs.map((r) => r.y)];
  let y0 = minY ?? Math.min(...ys);
  let y1 = Math.max(...ys);
  if (y1 === y0) {
    y0 -= 1;
    y1 += 1;
  }
  const pad = (y1 - y0) * 0.08;
  y0 = minY ?? y0 - pad;
  y1 += pad;
  const ticks = [y0 + (y1 - y0) * 0.1, (y0 + y1) / 2, y1 - (y1 - y0) * 0.1];
  // lewy margines pod najdłuższą etykietę osi Y (na telefonie tekst jest większy — patrz styles.css)
  const L = Math.max(44, 14 + Math.max(...ticks.map((t) => format(t).length)) * 12);
  const X = (x: string) => L + (t1 === t0 ? (W - L - R) / 2 : ((new Date(x).getTime() - t0) / (t1 - t0)) * (W - L - R));
  const Y = (y: number) => T + (1 - (y - y0) / (y1 - y0)) * (height - T - B);
  const sortedX = [...new Set(all.map((p) => p.x))].sort();
  return (
    <figure className="chart-fig">
      <svg className="chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={Y(t)} y2={Y(t)} className="grid" />
            <text x={L - 6} y={Y(t) + 4} className="chart-axis" textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}
        {refs.map((r) => (
          <g key={r.label}>
            <line x1={L} x2={W - R} y1={Y(r.y)} y2={Y(r.y)} className={`ref ref-${r.tone}`} />
            <text x={W - R} y={Y(r.y) - 4} className={`chart-axis ref-text-${r.tone}`} textAnchor="end">
              {r.label}
            </text>
          </g>
        ))}
        {/* daty pod osią: pierwsza, środkowa, ostatnia — bez tych, które nachodziłyby na sąsiednią */}
        {[sortedX[0], sortedX[sortedX.length - 1], sortedX[Math.floor(sortedX.length / 2)]]
          .filter((v, i, a) => a.indexOf(v) === i)
          .filter((v, i, a) => a.slice(0, i).every((u) => Math.abs(X(u) - X(v)) > 80))
          .map((x) => (
          <text key={x} x={X(x)} y={height - 6} className="chart-axis" textAnchor={sortedX.length > 1 && x === sortedX[0] ? 'start' : sortedX.length > 1 && x === sortedX[sortedX.length - 1] ? 'end' : 'middle'}>
            {fmtShort(x)}
          </text>
        ))}
        {series.map((s) => {
          const pts = [...s.pts].sort((a, b) => a.x.localeCompare(b.x));
          return (
            <g key={s.label} className={`line line-${s.tone ?? 'accent'}`}>
              <polyline points={pts.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')} />
              {pts.map((p) => (
                <circle key={p.x} cx={X(p.x)} cy={Y(p.y)} r={3}>
                  <title>{`${fmtShort(p.x)}: ${format(p.y)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      {series.length > 1 && (
        <figcaption className="legend">
          {series.map((s) => (
            <span key={s.label}>
              <i className={`legend-swatch line-${s.tone ?? 'accent'}`} /> {s.label}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}
