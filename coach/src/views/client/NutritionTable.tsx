import { useState } from 'react';
import { ShotSheet, ShotThumb } from '../../athlete/Nutrition';
import type { Client } from '../../domain';
import { fmtDay, plural } from '../../format';
import { todayISO } from '../../lib/dates';
import { hasFood, lastDays, MACROS, macroStatus, weeklyAverages } from '../../lib/nutrition';

const nf = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 });
const fmt = (v?: number) => (v == null ? '—' : nf.format(v));
const wd = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('pl-PL', { weekday: 'short' }).replace('.', '');

/** Trener: jedzenie z ostatnich 14 dni (kcal / B / T / W, zrzut z Fitatu) i średnie tygodniowe. */
export function NutritionTable({ client }: { client: Client }) {
  const today = todayISO();
  const [shot, setShot] = useState<{ ref: string; date: string } | null>(null);
  const rows = lastDays(client.dayLog, today, 14);
  if (!rows.some((r) => hasFood(r.log))) return null;
  const t = client.targets;
  const weeks = weeklyAverages(client.dayLog, today, 2);
  const cell = (k: (typeof MACROS)[number][0], v?: number) => {
    const st = macroStatus(k, v, t?.[k]);
    return <td className={`num ${st === 'low' || st === 'high' ? 'nt-warn' : ''}`}>{fmt(v)}</td>;
  };
  return (
    <div className="nt">
      <h4 className="nt-title">Jedzenie — ostatnie 14 dni</h4>
      <div className="nt-avg" role="group" aria-label="Średnie tygodniowe">
        {weeks.map((w, i) => (
          <div key={w.from} className="nt-avg-box">
            <span className="muted small">
              {i === 0 ? 'Ostatnie 7 dni' : 'Tydzień wcześniej'} · {w.days} {plural(w.days, 'wpis', 'wpisy', 'wpisów')}
            </span>
            <div className="nt-avg-vals">
              {MACROS.map(([k, , short, unit]) => (
                <span key={k} className={(() => {
                  const st = macroStatus(k, w.avg[k], t?.[k]);
                  return st === 'low' || st === 'high' ? 'nt-warn' : '';
                })()}>
                  <b>{fmt(w.avg[k])}</b>
                  <small>
                    {k === 'kcal' ? unit : `${short} ${unit}`}
                    {t?.[k] ? ` / ${fmt(t[k])}` : ''}
                  </small>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="nt-scroll">
        <table className="nt-table">
          <thead>
            <tr>
              <th scope="col">Dzień</th>
              <th scope="col" className="num">kcal</th>
              <th scope="col" className="num" title="Białko (g)">B</th>
              <th scope="col" className="num" title="Tłuszcze (g)">T</th>
              <th scope="col" className="num" title="Węglowodany (g)">W</th>
              <th scope="col">
                <span className="nt-sr">Zrzut</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ date, log }) => (
              <tr key={date} className={hasFood(log) ? '' : 'nt-empty'}>
                <th scope="row">
                  <span className="nt-wd">{wd(date)}</span> {fmtDay(date)}
                </th>
                {cell('kcal', log?.kcal)}
                {cell('protein', log?.protein)}
                {cell('fat', log?.fat)}
                {cell('carbs', log?.carbs)}
                <td className="nt-shot">{log?.shot && <ShotThumb refId={log.shot} alt={`Zrzut z Fitatu, ${fmtDay(date)}`} onOpen={() => setShot({ ref: log.shot!, date })} className="nt-thumb" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">Średnie liczone z dni z wpisem. Bursztyn — wyraźnie poniżej (&lt;80%) albo powyżej (&gt;120%) celu.</p>
      {shot && <ShotSheet refId={shot.ref} title={`Zrzut z Fitatu, ${fmtDay(shot.date)}`} onClose={() => setShot(null)} />}
    </div>
  );
}
