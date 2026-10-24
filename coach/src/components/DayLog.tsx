import { useEffect, useRef, useState } from 'react';
import type { Client, DayLog, DayTargets } from '../domain';
import { put } from '../data/db';
import { useStore } from '../data/store';
import { fmtDay, fnum } from '../format';
import { todayISO } from '../lib/dates';
import { numIn } from '../lib/parse';
import { adherence, bump, dayScore, hasTargets, metricHit, METRICS, type MetricKey } from '../lib/comms';
import { Ring } from './ring';
import { Empty } from './ui';

const fmtV = (k: MetricKey, v?: number) => (v == null ? '—' : k === 'steps' ? Math.round(v).toLocaleString('pl-PL') : k === 'water' ? fnum(v, 2) : String(Math.round(v)));
const pctTxt = (p: number | null) => (p == null ? '—' : `${Math.round(p * 100)}%`);
const wdShort = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('pl-PL', { weekday: 'short' }).replace('.', '');

/** Podopieczny: „Dziś” — białko, kcal, kroki, woda względem celów trenera (+/− albo wpis), tydzień w skrócie. */
export function DayLogCard({ client }: { client: Client }) {
  const { saveClientEntry } = useStore();
  const today = todayISO();
  const t = client.targets;
  const saved = (client.dayLog ?? []).find((l) => l.date === today);
  const [draft, setDraft] = useState<DayLog>(saved ?? { date: today });
  const [typing, setTyping] = useState<Partial<Record<MetricKey, string>>>({});
  const [week, setWeek] = useState(false);
  const pending = useRef<DayLog | null>(null);
  const timer = useRef<number>();
  const flush = () => {
    window.clearTimeout(timer.current);
    const d = pending.current;
    pending.current = null;
    if (d) void saveClientEntry(client.id, 'dayLog', d);
  };
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!hasTargets(t)) return null;
  const keys = METRICS.filter(([k]) => (t![k] ?? 0) > 0);
  const set = (k: MetricKey, v: number | undefined) => {
    const next = { ...draft, date: today, [k]: v };
    setDraft(next);
    pending.current = next;
    window.clearTimeout(timer.current);
    // seria stuknięć +/− zapisuje się raz, po chwili
    timer.current = window.setTimeout(flush, 900);
  };
  const sc = dayScore(draft, t);
  const adh = adherence(client.dayLog, t, today, 7);
  return (
    <section className="acard dl-card">
      <div className="between">
        <h3>Dziś: jedzenie i ruch</h3>
        <span className={`tag ${sc.hit === sc.total ? 'tag-ok' : 'tag-neutral'}`}>
          {sc.hit}/{sc.total} celów
        </span>
      </div>
      <ul className="dl-list">
        {keys.map(([k, label, unit, step, max]) => {
          const v = draft[k];
          const target = t![k]!;
          const p = Math.min(1, (v ?? 0) / target);
          const ok = metricHit(k, v, target);
          const over = k === 'kcal' && v != null && v > target * 1.1;
          return (
            <li key={k} className={`dl-row ${ok ? 'ok' : ''} ${over ? 'over' : ''}`}>
              <div className="dl-top">
                <span className="dl-label">{label}</span>
                <span className="dl-num">
                  <b>{fmtV(k, v)}</b> / {fmtV(k, target)} {unit}
                </span>
              </div>
              <div className="dl-bar" role="progressbar" aria-label={`${label}: ${fmtV(k, v)} z ${fmtV(k, target)} ${unit}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)}>
                <i style={{ width: `${p * 100}%` }} />
              </div>
              <div className="dl-ctl">
                <button type="button" className="btn btn-secondary" aria-label={`${label} minus ${fmtV(k, step)}`} onClick={() => set(k, bump(v, -step, max))}>
                  −
                </button>
                <input
                  className="input"
                  inputMode={k === 'water' ? 'decimal' : 'numeric'}
                  value={typing[k] ?? (v == null ? '' : k === 'water' ? fnum(v, 2) : String(v))}
                  placeholder="0"
                  aria-label={`${label} (${unit || 'kroki'})`}
                  onChange={(e) => setTyping({ ...typing, [k]: e.target.value })}
                  onBlur={() => {
                    const s = typing[k];
                    if (s == null) return;
                    setTyping({ ...typing, [k]: undefined });
                    const n = s.trim() ? numIn(s, 0, max) : undefined;
                    if (n !== null) set(k, n == null ? undefined : Math.round(n * 100) / 100);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
                <button type="button" className="btn btn-secondary" aria-label={`${label} plus ${fmtV(k, step)}`} onClick={() => set(k, bump(v, step, max))}>
                  +
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <button className="btn btn-ghost btn-block" aria-expanded={week} onClick={() => setWeek(!week)}>
        {week ? 'Zwiń tydzień' : `Ostatnie 7 dni: ${pctTxt(adh.pct)} celów`}
      </button>
      {week && <WeekStrip client={client} days={7} />}
    </section>
  );
}

/** Pasek dni: koło realizacji celów każdego dnia. */
function WeekStrip({ client, days }: { client: Client; days: number }) {
  const a = adherence(client.dayLog, client.targets, todayISO(), days);
  return (
    <div className={`dl-days ${days > 7 ? 'many' : ''}`} role="group" aria-label={`Ostatnie ${days} dni`}>
      {a.perDay.map((d) => (
        <div key={d.date} className={d.logged ? '' : 'off'} title={`${fmtDay(d.date)}: ${d.hit} z ${d.total} celów${d.logged ? '' : ' (brak wpisu)'}`}>
          <Ring value={d.total ? d.hit / d.total : 0} size={days > 7 ? 22 : 30} stroke={4} label={`${fmtDay(d.date)}: ${d.hit} z ${d.total}`} />
          <span aria-hidden="true">{days > 7 ? new Date(`${d.date}T12:00:00`).getDate() : wdShort(d.date)}</span>
        </div>
      ))}
    </div>
  );
}

/** Trener: cele dzienne i realizacja z 7 / 28 dni. */
export function CoachTargets({ client }: { client: Client }) {
  const { apply, toast } = useStore();
  const t = client.targets ?? {};
  const [edit, setEdit] = useState(!hasTargets(client.targets));
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(METRICS.map(([k]) => [k, t[k] != null ? String(t[k]).replace('.', ',') : ''])));
  const [range, setRange] = useState<7 | 28>(7);
  const save = async () => {
    const next: DayTargets = {};
    for (const [k, label, unit, , max] of METRICS) {
      if (!v[k]?.trim()) continue;
      const n = numIn(v[k], 0, max);
      if (n == null) return toast(`${label}: wpisz liczbę od 0 do ${max.toLocaleString('pl-PL')} ${unit}.`);
      if (n > 0) next[k] = n;
    }
    if (await apply([put('clients', { ...client, targets: hasTargets(next) ? next : undefined })], hasTargets(next) ? 'Cele zapisane — podopieczny zobaczy je w karcie „Dziś”.' : 'Cele usunięte.')) setEdit(false);
  };
  const a = adherence(client.dayLog, client.targets, todayISO(), range);
  return (
    <div className="dl-coach">
      {edit ? (
        <div className="dl-form">
          <div className="dl-form-grid">
            {METRICS.map(([k, label, unit]) => (
              <label key={k} className="field">
                <span>
                  {label}
                  {unit ? ` (${unit})` : ''}
                </span>
                <input className="input" inputMode="decimal" value={v[k]} placeholder="—" onChange={(e) => setV({ ...v, [k]: e.target.value })} aria-label={`Cel: ${label}`} />
              </label>
            ))}
          </div>
          <div className="actions">
            {hasTargets(client.targets) && (
              <button className="btn btn-ghost btn-sm" onClick={() => setEdit(false)}>
                Anuluj
              </button>
            )}
            <button className="btn btn-primary btn-sm" onClick={() => void save()}>
              Zapisz cele
            </button>
          </div>
          <p className="muted small">Puste pole = bez celu. Podopieczny wpisuje wartości w karcie „Dziś”. Cel osiągnięty: kcal ±10%, reszta min. 90%.</p>
        </div>
      ) : (
        <>
          <div className="between">
            <span className="seg seg-sm" role="radiogroup" aria-label="Zakres">
              {([7, 28] as const).map((d) => (
                <button key={d} type="button" role="radio" aria-checked={range === d} className={range === d ? 'active' : ''} onClick={() => setRange(d)}>
                  {d} dni
                </button>
              ))}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => setEdit(true)}>
              Zmień cele
            </button>
          </div>
          {a.loggedDays === 0 ? (
            <Empty>Brak wpisów w ostatnich {range} dniach.</Empty>
          ) : (
            <>
              <p className="small">
                Realizacja celów: <b>{pctTxt(a.pct)}</b> · wpisy {a.loggedDays} z {a.days} dni
              </p>
              <ul className="dl-adh">
                {METRICS.filter(([k]) => t[k]).map(([k, label, unit]) => {
                  const m = a.perMetric[k]!;
                  return (
                    <li key={k}>
                      <span>{label}</span>
                      <span className="muted small">
                        śr. {fmtV(k, m.avg)} / {fmtV(k, t[k])} {unit}
                      </span>
                      <b className={m.hitDays / Math.max(1, m.days) >= 0.7 ? 'ok-text' : m.hitDays / Math.max(1, m.days) < 0.4 ? 'warn-text' : ''}>
                        {m.hitDays}/{m.days} dni
                      </b>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <WeekStrip client={client} days={range} />
        </>
      )}
    </div>
  );
}
