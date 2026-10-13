import { useState } from 'react';
import { BarChart, LineChart, type Pt } from '../../components/charts';
import { Card, Empty, Kpi } from '../../components/ui';
import type { Client } from '../../domain';
import { sessionsOf } from '../../data/ops';
import { useStore } from '../../data/store';
import { fmtDay, fnum, fx } from '../../format';
import { addDays, todayISO, weekStart } from '../../lib/dates';
import { acwrZone, loadStats, sessionLoad, tonnage, weekly } from '../../lib/load';
import { num } from '../../lib/parse';
import { e1Series, exerciseE1, records } from '../../lib/strength';
import { readiness, readinessNorm, wellnessTotal } from '../../lib/wellness';

const toneOf = (l: string | null) => (l === 'red' ? 'danger' : l === 'yellow' ? 'warn' : l === 'green' ? 'ok' : undefined);

export function ClientMonitoring({ client }: { client: Client }) {
  const { db } = useStore();
  const today = todayISO();
  const sessions = sessionsOf(db, client.id);
  const st = loadStats(sessions, today);
  const zone = acwrZone(st.acwr);

  const weeklyLoad = weekly(sessions, sessionLoad, 12, today);
  const weeklyTon = weekly(sessions, tonnage, 12, today);

  // ACWR liczony na każdy tydzień (niedziela) z ostatnich 12 tygodni + dziś.
  const acwrPts: Pt[] = [];
  for (let i = 11; i >= 1; i--) {
    const at = addDays(weekStart(today), -7 * i + 6);
    const v = loadStats(sessions, at).acwr;
    if (v != null) acwrPts.push({ x: at, y: Math.round(v * 100) / 100 });
  }
  if (st.acwr != null) acwrPts.push({ x: today, y: Math.round(st.acwr * 100) / 100 });

  const asc = [...sessions].reverse();
  const wellPts = asc.filter((s) => wellnessTotal(s.wellness) != null).map((s) => ({ x: s.date, y: wellnessTotal(s.wellness)! }));
  const checkPts = client.checkins.filter((c) => readiness(c) != null).map((c) => ({ x: c.date, y: readiness(c)! * 5 }));
  const painPts = asc.filter((s) => s.pain != null).map((s) => ({ x: s.date, y: s.pain! }));
  const norm = readinessNorm(client.checkins, sessions, today);

  const exNames = (() => {
    const cnt: Record<string, number> = {};
    for (const s of sessions) for (const e of s.exercises) if (exerciseE1(e) != null) cnt[e.name] = (cnt[e.name] || 0) + 1;
    return Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]);
  })();
  const [ex, setEx] = useState<string | null>(null);
  const chosen = ex && exNames.includes(ex) ? ex : exNames[0];
  const recs = records(sessions).slice(0, 8);

  if (sessions.length === 0) return <Empty>Brak treningów — monitoring pojawi się po pierwszych zapisach z sRPE i czasem trwania.</Empty>;

  return (
    <>
      <div className="kpi-grid">
        <Kpi label="ACWR" value={st.acwr != null ? fx(st.acwr, 2) : '—'} sub={zone.label} tone={toneOf(zone.level)} />
        <Kpi label="Obciążenie ostre / przewlekłe" value={`${fnum(st.acute, 0)} / ${fnum(st.chronic, 0)}`} sub="AU: 7 dni / średnia tyg. z 28 dni" />
        <Kpi label="Monotonia" value={st.monotony != null ? fx(st.monotony, 2) : '—'} sub={st.monotony != null && st.monotony > 2 ? 'wysoka (>2)' : '7 dni'} tone={st.monotony != null && st.monotony > 2 ? 'warn' : undefined} />
        <Kpi label="Strain" value={st.strain != null ? fnum(st.strain, 0) : '—'} sub="ostre × monotonia" />
      </div>

      <div className="two-col">
        <Card title="Obciążenie tygodniowe (sRPE × min)">
          <BarChart pts={weeklyLoad} label="Tygodniowe obciążenie sRPE" />
        </Card>
        <Card title="ACWR w czasie">
          {acwrPts.length < 2 ? (
            <Empty>ACWR liczy się po 21 dniach historii.</Empty>
          ) : (
            <LineChart
              label="ACWR w czasie"
              series={[{ label: 'ACWR', pts: acwrPts }]}
              refs={[
                { y: 0.8, label: '0,8', tone: 'warn' },
                { y: 1.3, label: '1,3', tone: 'warn' },
                { y: 1.5, label: '1,5', tone: 'danger' },
              ]}
              format={(v) => fx(v, 2)}
              minY={0}
            />
          )}
        </Card>
        <Card title={`Wellness i gotowość${norm != null ? ` · norma 28 dni: ${fx(norm, 1)}/5` : ''}`}>
          <LineChart
            label="Wellness"
            series={[
              { label: 'Wellness z treningu (5–25)', pts: wellPts },
              ...(checkPts.length ? [{ label: 'Check-in ×5', pts: checkPts, tone: 'cyan' as const }] : []),
            ]}
            format={(v) => fnum(v, 0)}
          />
        </Card>
        <Card title="Ból (0–10)">
          {painPts.length < 2 ? <Empty>Za mało danych.</Empty> : <LineChart label="Ból" series={[{ label: 'Ból', pts: painPts, tone: 'muted' }]} refs={[{ y: 4, label: '4', tone: 'warn' }]} minY={0} format={(v) => fnum(v, 0)} />}
        </Card>
        <Card title="Tonaż tygodniowy (kg)">
          <BarChart pts={weeklyTon} label="Tonaż tygodniowy" format={(v) => (v >= 1000 ? `${fnum(v / 1000, 1)}t` : String(Math.round(v)))} />
        </Card>
        <Card title="Szacowane 1RM (e1RM)">
          {exNames.length === 0 ? (
            <Empty>Brak ćwiczeń z ciężarem i powtórzeniami.</Empty>
          ) : (
            <>
              <div className="chips">
                {exNames.slice(0, 8).map((n) => (
                  <button key={n} className={`chip ${n === chosen ? 'active' : ''}`} onClick={() => setEx(n)}>
                    {n}
                  </button>
                ))}
              </div>
              <LineChart label={`e1RM ${chosen}`} series={[{ label: chosen, pts: e1Series(sessions, chosen) }]} format={(v) => `${fnum(v, 1)}`} />
            </>
          )}
        </Card>
      </div>

      <Card title="Ostatnie rekordy">
        {recs.length === 0 ? (
          <Empty>Brak rekordów.</Empty>
        ) : (
          <ul className="rows">
            {recs.map((r, i) => (
              <li key={i} className="row">
                <span className="row-time">{fmtDay(r.date)}</span>
                <strong className="grow">{r.name}</strong>
                <span className="small">
                  {fnum(num(r.load))} kg × {String(r.reps)}
                </span>
                <span className="tag tag-ok">
                  e1RM {fnum(r.e1, 1)} (+{fnum(r.gain, 1)})
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
