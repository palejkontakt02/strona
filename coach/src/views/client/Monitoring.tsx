import { useState } from 'react';
import { BarChart, LineChart, type Pt } from '../../components/charts';
import { Card, Empty, Kpi } from '../../components/ui';
import type { Client } from '../../domain';
import { sessionsOf } from '../../data/ops';
import { useStore } from '../../data/store';
import { fmtDay, fmtShort, fnum, fx } from '../../format';
import { addDays, todayISO, weekStart } from '../../lib/dates';
import { acwrZone, loadStats, sessionLoad, tonnage, weekly } from '../../lib/load';
import { num } from '../../lib/parse';
import { e1rmHistory, exerciseE1, exerciseRecords, RECORD_REPS, records, type LiftRecord } from '../../lib/strength';
import { painHistory, painSpotsOf } from '../../lib/analytics';
import { painLabel } from '../../lib/painMap';
import { PainMap } from '../../components/PainMap';
import { readiness, readinessNorm, wellnessTotal } from '../../lib/wellness';
import { fmtClock, fmtKm, pace5k, runTotals, zoneHr, zoneHrRange, zoneSourceText, ZONES } from '../../lib/running';
import { RunVolume } from '../../components/RunVolume'; // funkcje: bieg

const toneOf = (l: string | null) => (l === 'red' ? 'danger' : l === 'yellow' ? 'warn' : l === 'green' ? 'ok' : undefined);

export function ClientMonitoring({ client }: { client: Client }) {
  const { db } = useStore();
  const today = todayISO();
  const sessions = sessionsOf(db, client.id);
  const st = loadStats(sessions, today);
  const zone = acwrZone(st.acwr);

  const weeklyLoad = weekly(sessions, sessionLoad, 12, today);
  const weeklyTon = weekly(sessions, tonnage, 12, today);
  const weeklyKm = weekly(sessions, (s) => runTotals(s, true)?.km || null, 12, today);
  const hasRun = weeklyKm.some((p) => p.y > 0) || !!client.run;

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
  const hist = chosen ? e1rmHistory(sessions, chosen) : [];
  const exRec = chosen ? exerciseRecords(sessions, chosen) : null;
  const pain = painHistory(sessions, today, 8);

  if (sessions.length === 0) return <Empty>Brak treningów — monitoring pojawi się po pierwszych zapisach z sRPE i czasem trwania.</Empty>;

  return (
    <>
      <div className="kpi-grid kpi-strip">
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
        {/* funkcje: bieg — km plan vs wykonanie (sam się ukrywa, gdy klient nie biega) */}
        <RunVolume client={client} />
        {hasRun && (
          <Card title="Bieganie — kilometraż tygodniowy">
            <BarChart pts={weeklyKm} label="Kilometraż tygodniowy" format={(v) => fnum(v, 1)} />
            {(() => {
              // tydzień do tygodnia: skok powyżej ~10–30% zwiększa ryzyko przeciążenia
              const [a, b] = weeklyKm.slice(-2).map((p) => p.y);
              const prev3 = weeklyKm.slice(-4, -1).map((p) => p.y);
              const avg = prev3.reduce((x, y) => x + y, 0) / (prev3.length || 1);
              const jump = avg > 0 ? (b - avg) / avg : 0;
              return (
                <p className={`small ${jump > 0.3 ? 'warn-text' : 'muted'}`}>
                  Ten tydzień: <b>{fmtKm(b || 0)}</b> · poprzedni: {fmtKm(a || 0)} · średnia z 3 tyg.: {fmtKm(avg)}
                  {jump > 0.3 ? ` — o ${Math.round(jump * 100)}% więcej niż zwykle; zwiększaj kilometraż stopniowo (ok. 10% na tydzień).` : ''}
                </p>
              );
            })()}
            {(() => {
              // tętno stref: z progu (LTHR), gdy wpisany, inaczej z tętna maks. albo wieku
              const hm = zoneHr(ZONES[0], client.run, client.dob);
              const p5 = pace5k(client.run);
              if (!hm && !p5) return <p className="muted small">Strefy tętna i tempa: wpisz tętno progowe, tętno maks. albo czas na 5 km w Profilu.</p>;
              return (
                <table className="table zones-table">
                  <thead>
                    <tr>
                      <th>Strefa</th>
                      {hm && <th>Tętno ({zoneSourceText(client.run, client.dob)})</th>}
                      {p5 && <th>Tempo / km</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {ZONES.map((z) => (
                      <tr key={z.z}>
                        <td>
                          <b>{z.z}</b> {z.name}
                        </td>
                        {hm && <td>{(() => { const h = zoneHr(z, client.run, client.dob); return h ? zoneHrRange(h) : '—'; })()}</td>}
                        {p5 && (
                          <td>
                            {fmtClock(p5 * z.pace[0])}–{fmtClock(p5 * z.pace[1])}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
          </Card>
        )}
        <Card title="Tonaż tygodniowy (kg)">
          <BarChart pts={weeklyTon} label="Tonaż tygodniowy" format={(v) => (v >= 1000 ? `${fnum(v / 1000, 1)}t` : String(Math.round(v)))} />
        </Card>
        <Card title="Szacowane 1RM (e1RM) i rekordy" className="rec-card">
          {exNames.length === 0 ? (
            <Empty>Brak ćwiczeń z ciężarem i powtórzeniami.</Empty>
          ) : (
            <>
              <div className="chips">
                {exNames.slice(0, 6).map((n) => (
                  <button key={n} className={`chip ${n === chosen ? 'active' : ''}`} onClick={() => setEx(n)}>
                    {n}
                  </button>
                ))}
              </div>
              {exNames.length > 6 && (
                <select className="input input-sm rec-pick" value={exNames.slice(0, 6).includes(chosen) ? '' : chosen} onChange={(e) => e.target.value && setEx(e.target.value)} aria-label="Ćwiczenie do wykresu e1RM">
                  <option value="">Inne ćwiczenie ({exNames.length - 6})…</option>
                  {exNames.slice(6).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              )}
              <LineChart label={`e1RM ${chosen}`} series={[{ label: chosen, pts: hist.map((h) => ({ x: h.date, y: h.e1 })) }]} format={(v) => `${fnum(v, 1)}`} />
              {exRec && (exRec.e1 || RECORD_REPS.some((n) => exRec.rm[n])) && (
                <table className="table rec-table" aria-label={`Rekordy: ${chosen}`}>
                  <thead>
                    <tr>
                      <th>Rekord</th>
                      <th className="num">Seria</th>
                      <th className="num">e1RM</th>
                      <th className="num">Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...RECORD_REPS.map((n) => [`${n}RM`, exRec.rm[n]] as const), ['Najlepszy e1RM', exRec.e1] as const].map(([label, r]) => (
                      <RecRow key={label} label={label} r={r} best={label === 'Najlepszy e1RM'} />
                    ))}
                  </tbody>
                </table>
              )}
              {exRec && (exRec.e1 || RECORD_REPS.some((n) => exRec.rm[n])) && <p className="muted small">3RM = najcięższa seria na co najmniej 3 powtórzenia (tak samo 1RM, 5RM). e1RM — szacowane maks. z serii (Epley z RPE).</p>}
              {hist.length > 0 && (
                <p className="muted small">
                  {hist.length} {hist.length === 1 ? 'trening' : hist.length < 5 ? 'treningi' : 'treningów'} z tym ćwiczeniem · ostatnio {fmtDay(hist[hist.length - 1].date)}: {fnum(hist[hist.length - 1].load)} kg × {hist[hist.length - 1].reps} (e1RM {fnum(hist[hist.length - 1].e1, 1)})
                </p>
              )}
            </>
          )}
        </Card>
        <Card title="Gdzie boli — ostatnie 8 tygodni" className="pain-history">
          {pain.length === 0 ? (
            <Empty>Brak zaznaczonych miejsc bólu w ostatnich 8 tygodniach. Podopieczny zaznacza je po treningu (mapa ciała), trener — w edycji treningu.</Empty>
          ) : (
            <div className="pain-hist-grid">
              <PainMap spots={painSpotsOf(pain)} readOnly />
              <ul className="rows pain-hist-list">
                {pain.map((r) => (
                  <li key={`${r.area}|${r.side ?? ''}`} className="row">
                    <strong className="grow">{painLabel(r)}</strong>
                    <span className="small">
                      {r.count} {r.count === 1 ? 'raz' : 'razy'} · max <b className={`num ${r.max >= 6 ? 'danger-text' : r.max >= 4 ? 'warn-text' : ''}`}>{r.max}/10</b> · ostatnio {fmtShort(r.last)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
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
                  {String(r.reps)} × {fnum(num(r.load))} kg
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

function RecRow({ label, r, best }: { label: string; r: LiftRecord | null; best?: boolean }) {
  return (
    <tr className={best ? 'rec-best' : undefined}>
      <td>{label}</td>
      <td className="num">{r ? `${fnum(r.load)} kg × ${r.reps}` : '—'}</td>
      <td className="num">{r ? fnum(r.e1, 1) : '—'}</td>
      <td className="num">{r ? fmtShort(r.date) : '—'}</td>
    </tr>
  );
}
