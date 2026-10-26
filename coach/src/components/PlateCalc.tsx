import { useState } from 'react';
import { Sheet } from './Sheet';
import { platesFor, platesText } from '../lib/strength';

const fmt = (v: number) => String(Math.round(v * 100) / 100).replace('.', ',');

/** Kalkulator talerzy: ile talerzy na stronę dla ciężaru z serii (gryf 20 kg albo 15 kg). */
export function PlateCalc({ kg, title, onClose }: { kg: number; title?: string; onClose: () => void }) {
  const [bar, setBar] = useState<20 | 15>(20);
  const [val, setVal] = useState(fmt(kg));
  const total = parseFloat(val.replace(',', '.'));
  const ok = Number.isFinite(total) && total > 0;
  const r = ok ? platesFor(total, bar) : null;
  return (
    <Sheet label="Talerze" onClose={onClose}>
      <div className="platecalc">
        <h2>Talerze{title ? <span className="muted small"> · {title}</span> : null}</h2>
        <div className="pc-row">
          <label className="field pc-kg">
            <span>Ciężar razem (kg)</span>
            <input className="input" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} aria-label="Ciężar razem z gryfem (kg)" />
          </label>
          <div className="field">
            <span>Gryf</span>
            <div className="seg" role="radiogroup" aria-label="Gryf">
              {([20, 15] as const).map((b) => (
                <button key={b} type="button" role="radio" aria-checked={bar === b} className={bar === b ? 'active' : ''} onClick={() => setBar(b)}>
                  {fmt(b)} kg
                </button>
              ))}
            </div>
          </div>
        </div>
        {!r ? (
          <p className="muted">Wpisz ciężar w kg.</p>
        ) : r.diff < 0 ? (
          <p className="pc-out" role="status">
            Mniej niż sam gryf ({fmt(bar)} kg).
          </p>
        ) : (
          <>
            <p className="pc-out" role="status">
              <b>{platesText(r.perSide)}</b>
            </p>
            {r.perSide.length > 0 && (
              <div className="pc-bar" aria-hidden="true">
                <span className="pc-sleeve" />
                {r.perSide.map((p, i) => (
                  <span key={i} className={`pc-plate p${String(p).replace('.', '_')}`} style={{ height: `${36 + Math.min(25, p) * 2.4}px` }}>
                    {fmt(p)}
                  </span>
                ))}
                <span className="pc-collar" />
              </div>
            )}
            {r.diff > 0 && (
              <p className="pc-warn">
                {fmt(total)} kg nie da się złożyć dokładnie (najmniejszy talerz 1,25 kg). Najbliżej: {fmt(r.achieved)} kg albo {fmt(r.achieved + 2.5)} kg.
              </p>
            )}
            <p className="muted small">
              Razem {fmt(r.achieved)} kg = gryf {fmt(bar)} kg + 2 × {fmt((r.achieved - bar) / 2)} kg.
            </p>
          </>
        )}
        <button className="btn btn-ghost btn-block" onClick={onClose}>
          Zamknij
        </button>
      </div>
    </Sheet>
  );
}
