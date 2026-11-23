import { recordRow } from '../../lib/clientCard';
import { useState } from 'react';
import { BarChart, LineChart, type Pt } from '../../components/charts';
import { Card, Empty, Kpi, Seg } from '../../components/ui';
import type { Client } from '../../domain';
import { sessionsOf } from '../../data/ops';
import { useStore } from '../../data/store';
import { put } from '../../data/db';
import { fmtDay, fmtShort, fnum, fx } from '../../format';
import { addDays, todayISO, weekStart } from '../../lib/dates';
import { loadStats, loadVsBaseline, sessionLoad, tonnage, trailingAvg, weekly } from '../../lib/load';
import { num } from '../../lib/parse';
import { e1rmHistory, exerciseE1, exerciseRecords, RECORD_REPS, records, type LiftRecord } from '../../lib/strength';
import { painHistory, painSpotsOf } from '../../lib/analytics';
import { painLabel } from '../../lib/painMap';
import { painStatus } from '../../lib/painModel';
import { PainMap } from '../../components/PainMap';
import { readiness, readinessNorm, wellnessItems } from '../../lib/wellness';
import { fmtClock, fmtKm, longestRunFlag, pace5k, runTotals, zoneHr, zoneHrRange, zoneSourceText, ZONES } from '../../lib/running';
import { setsByMuscle, weeklyMuscleSets } from '../../lib/progressMuscles';
import { RunVolume } from '../../components/RunVolume'; // funkcje: bieg


type Level = 'Podstawowy' | 'Zaawansowany';
const LEVELS = ['Podstawowy', 'Zaawansowany'] as const;
const pctText = (p: number) => `${p >= 0 ? '+' : '−'}${Math.round(Math.abs(p) * 100)}%`;
/** Model monitorowania bólu: 0–2 bezpiecznie, 3–5 akceptowalnie (jeśli ustępuje do rana), powyżej 5 — stop. */
const painTone = (v: number | null | undefined) => (v == null ? undefined : v > 5 ? 'danger' : v >= 3 ? 'warn' : 'ok');

const SHARE: [NonNullable<Client['monitoring']> | '', string][] = [
  ['', 'Podopieczny nie widzi'],
  ['basic', 'Podopieczny widzi: podstawowy'],
  ['all', 'Podopieczny widzi: podstawowy i zaawansowany'],
];

/** Monitoring: u trenera oba poziomy i włącznik widoczności; u podopiecznego (`athlete`) tylko to, co włączył trener. */
export function ClientMonitoring({ client, athlete = false }: { client: Client; athlete?: boolean }) {
  const { db, apply } = useStore();
  const today = todayISO();
  const sessions = sessionsOf(db, client.id);
  // poziom szczegółów zapamiętany dla podopiecznego na tym urządzeniu
  const key = `fitowa-mon-level-${client.id}`;
  const levels: readonly Level[] = athlete && client.monitoring !== 'all' ? ['Podstawowy'] : LEVELS;
  const [levelState, setLevelState] = useState<Level>(() => {
    try {
      return localStorage.getItem(key) === 'Zaawansowany' ? 'Zaawansowany' : 'Podstawowy';
    } catch {
      return 'Podstawowy';
    }
  });
  const level: Level = levels.includes(levelState) ? levelState : 'Podstawowy';
  const setLevel = (v: Level) => {
    setLevelState(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      // brak pamięci przeglądarki
    }
  };

  const share = !athlete && (
    <select
      className="input input-sm mon-share"
      value={client.monitoring ?? ''}
      aria-label="Czy podopieczny widzi monitoring w swojej aplikacji"
      onChange={(e) => {
        const v = e.target.value as Client['monitoring'] | '';
        void apply([put('clients', { ...client, monitoring: v || undefined })], v ? `Podopieczny widzi monitoring (${v === 'all' ? 'podstawowy i zaawansowany' : 'podstawowy'}) w zakładce Postępy.` : 'Monitoring ukryty przed podopiecznym.');
      }}
    >
      {SHARE.map(([v, t]) => (
        <option key={v} value={v}>
          {t}
        </option>
      ))}
    </select>
  );

  if (sessions.length === 0)
    return (
      <>
        {share && <div className="mon-level">{share}</div>}
        <Empty>{athlete ? 'Monitoring pojawi się po pierwszych treningach z oceną trudności i czasem.' : 'Brak treningów. Monitoring pojawi się po pierwszych zapisach z oceną trudności (sRPE) i czasem.'}</Empty>
      </>
    );

  return (
    <>
      <div className="mon-level">
        {levels.length > 1 && <Seg options={levels} value={level} onChange={setLevel} label="Poziom monitoringu" />}
        {share}
        {!athlete && <span className="muted small">{level === 'Podstawowy' ? 'Najważniejsze: regularność, obciążenie, samopoczucie, ból, postęp.' : 'Dla trenera przygotowania motorycznego: wskaźniki obciążenia, objętość na partie, e1RM, samopoczucie pytanie po pytaniu.'}</span>}
      </div>
      {level === 'Podstawowy' ? <Basic client={client} sessions={sessions} today={today} athlete={athlete} /> : <Advanced client={client} sessions={sessions} today={today} />}
    </>
  );
}

type P = { client: Client; sessions: ReturnType<typeof sessionsOf>; today: string; athlete?: boolean };

/** Tygodnie obciążenia (sRPE × min) z linią średniej z 4 poprzednich tygodni. */
function LoadWeeks({ sessions, today }: Omit<P, 'client'>) {
  const all = weekly(sessions, sessionLoad, 16, today);
  const avg = trailingAvg(all).slice(-12);
  return <BarChart pts={all.slice(-12)} line={avg} lineLabel="Średnia z 4 poprzednich tygodni" label="Tygodniowe obciążenie sRPE" />;
}

function Basic({ client, sessions, today, athlete }: P) {
  const lb = loadVsBaseline(sessions, today);
  const thisWeek = sessions.filter((s) => s.date >= weekStart(today)).length;
  const prev4 = sessions.filter((s) => s.date >= addDays(weekStart(today), -28) && s.date < weekStart(today)).length / 4;
  const norm = readinessNorm(client.checkins, sessions, today);
  const lastCi = [...client.checkins].filter((c) => readiness(c) != null).sort((a, b) => b.date.localeCompare(a.date))[0];
  const lastWs = sessions.find((s) => readiness(s.wellness) != null);
  const lastR = lastCi && (!lastWs || lastCi.date >= lastWs.date) ? { v: readiness(lastCi)!, d: lastCi.date } : lastWs ? { v: readiness(lastWs.wellness)!, d: lastWs.date } : null;
  const pain7 = sessions.filter((s) => s.date > addDays(today, -7)).flatMap((s) => [s.pain, s.painNext?.level]).filter((v): v is number => v != null);
  const painRecent = sessions.filter((s) => painStatus(s) && ((s.pain ?? 0) > 0 || (s.painNext?.level ?? 0) > 0)).slice(0, 5);
  const painMax = pain7.length ? Math.max(...pain7) : null;

  const asc = [...sessions].reverse();
  const wellPts = asc.filter((s) => readiness(s.wellness) != null).map((s) => ({ x: s.date, y: Math.round(readiness(s.wellness)! * 10) / 10 }));
  const checkPts = client.checkins.filter((c) => readiness(c) != null).map((c) => ({ x: c.date, y: Math.round(readiness(c)! * 10) / 10 }));
  const painPts = asc.filter((s) => s.pain != null).map((s) => ({ x: s.date, y: s.pain! }));
  const weeklyKm = weekly(sessions, (s) => runTotals(s, true)?.km || null, 12, today);
  const hasRun = weeklyKm.some((p) => p.y > 0) || !!client.run;
  const lr = longestRunFlag(sessions, today);
  const recs = records(sessions).slice(0, 6);

  return (
    <>
      <div className="kpi-grid kpi-strip">
        <Kpi label="Treningi w tym tygodniu" value={String(thisWeek)} sub={`średnio ${fx(prev4, 1)} / tydz. (4 tyg.)`} />
        <Kpi
          label="Obciążenie 7 dni"
          hint="Obciążenie = ocena trudności treningu (sRPE 1–10) × minuty. Porównanie z własną średnią z 4 poprzednich tygodni. To opis zmiany, nie prognoza kontuzji."
          value={`${fnum(lb.week, 0)} AU`}
          sub={lb.pct != null ? `${pctText(lb.pct)} wobec średniej` : 'zbieram dane (3 tygodnie)'}
          tone={lb.pct != null && lb.pct >= 0.5 ? 'warn' : undefined}
        />
        <Kpi
          label="Samopoczucie"
          hint="Średnia z 5 pytań (sen, energia, mięśnie, stres, nastrój; 1–5) z ostatniego check-inu albo treningu, wobec własnej normy z 28 dni."
          value={lastR ? `${fx(lastR.v, 1)}/5` : '—'}
          sub={lastR ? (norm != null ? `norma ${fx(norm, 1)} · ${fmtShort(lastR.d)}` : `zbieram dane · ${fmtShort(lastR.d)}`) : 'brak ankiet'}
          tone={lastR && norm != null && lastR.v < norm - 0.5 ? 'warn' : undefined}
        />
        <Kpi label="Ból (7 dni)" hint="Najwyższy zgłoszony ból 0–10. 0–2 bezpiecznie, 3–5 akceptowalnie, jeśli ustępuje do rana, powyżej 5 — zmień plan." value={painMax != null ? `${painMax}/10` : '—'} sub={painMax == null ? 'bez zgłoszeń' : painMax > 5 ? 'zmień obciążenie' : painMax >= 3 ? 'obserwuj do rana' : 'bezpiecznie'} tone={painTone(painMax)} />
      </div>

      <div className="two-col">
        <Card title="Obciążenie tygodniowe">
          <LoadWeeks sessions={sessions} today={today} />
          <p className="muted small">Słupki: suma sRPE × minuty w tygodniu. Linia: średnia z 4 poprzednich tygodni. Duży skok ponad linię to sygnał do sprawdzenia, jak {athlete ? 'organizm to znosi' : 'podopieczny to znosi'}.</p>
        </Card>
        <Card title={`Samopoczucie (1–5)${norm != null ? ` · norma ${fx(norm, 1)}` : ''}`}>
          {wellPts.length + checkPts.length < 2 ? (
            <Empty>Za mało ankiet.</Empty>
          ) : (
            <LineChart
              label="Samopoczucie"
              series={[...(checkPts.length ? [{ label: 'Check-in', pts: checkPts, tone: 'cyan' as const }] : []), ...(wellPts.length ? [{ label: 'Przed treningiem', pts: wellPts }] : [])]}
              refs={norm != null ? [{ y: Math.round(norm * 10) / 10, label: 'norma', tone: 'muted' }] : []}
              format={(v) => fx(v, 1)}
              minY={1}
            />
          )}
        </Card>
        <Card title="Ból (0–10)">
          {painPts.length < 2 ? (
            <Empty>Za mało danych.</Empty>
          ) : (
            <LineChart
              label="Ból"
              series={[{ label: 'Ból', pts: painPts, tone: 'muted' }]}
              refs={[
                { y: 2, label: '2', tone: 'ok' },
                { y: 5, label: '5', tone: 'danger' },
              ]}
              minY={0}
              format={(v) => fnum(v, 0)}
            />
          )}
          {painRecent.length > 0 && (
            <ul className="rows pain-model">
              {painRecent.map((s) => {
                const st = painStatus(s)!;
                return (
                  <li key={s.id} className="row">
                    <span className={`pm-dot pm-${st.light}`} aria-hidden />
                    <span className="row-time">{fmtShort(s.date)}</span>
                    <span className="grow small">
                      w trakcie {s.pain ?? '—'} · rano {s.painNext ? `${s.painNext.level}${s.painNext.stiff ? ', sztywność' : ''}` : 'brak wpisu'}
                    </span>
                    <span className="small muted">{st.text}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="muted small">Do 2: bezpiecznie. 3–5: w porządku, jeśli rano wraca do normy (podopieczny dostaje pytanie rano). Powyżej 5, nie ustępuje do rana albo rośnie z tygodnia na tydzień: zmień obciążenie.</p>
        </Card>
        {hasRun && (
          <Card title="Bieganie: kilometraż tygodniowy">
            <BarChart pts={weeklyKm} line={trailingAvg(weeklyKm)} lineLabel="Średnia z 4 poprzednich tygodni" label="Kilometraż tygodniowy" format={(v) => fnum(v, 1)} />
            {lr && lr.pct > 0.1 ? (
              <p className={`small ${lr.pct > 0.3 ? 'warn-text' : ''}`}>
                Bieg {fmtShort(lr.date)}: <b>{fmtKm(lr.km)}</b>, o {Math.round(lr.pct * 100)}% dłuższy niż najdłuższy z 30 dni ({fmtKm(lr.prevMax)}). Pojedynczy bieg ponad 10% dłuższy od dotychczasowego najdłuższego wiąże się z większą liczbą przeciążeń.
              </p>
            ) : (
              <p className="muted small">Najważniejsza zasada: pojedynczy bieg nie dłuższy niż o ok. 10% od najdłuższego z ostatnich 30 dni.</p>
            )}
          </Card>
        )}
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

function Advanced({ client, sessions, today }: P) {
  const st = loadStats(sessions, today);
  const lb = loadVsBaseline(sessions, today);
  // ACWR co tydzień (niedziela) z 12 tygodni + dziś — do analizy trendu, bez progów „ryzyka”
  const acwrPts: Pt[] = [];
  for (let i = 11; i >= 1; i--) {
    const at = addDays(weekStart(today), -7 * i + 6);
    const v = loadStats(sessions, at).acwr;
    if (v != null) acwrPts.push({ x: at, y: Math.round(v * 100) / 100 });
  }
  if (st.acwr != null) acwrPts.push({ x: today, y: Math.round(st.acwr * 100) / 100 });
  const weeklyTon = weekly(sessions, tonnage, 12, today);
  const muscles = weeklyMuscleSets(sessions, today);
  const avg4 = setsByMuscle(sessions.filter((s) => s.date >= addDays(weekStart(today), -28) && s.date < weekStart(today)));
  const items = wellnessItems(client.checkins, sessions, today);

  const exNames = (() => {
    const cnt: Record<string, number> = {};
    for (const s of sessions) for (const e of s.exercises) if (exerciseE1(e) != null) cnt[e.name] = (cnt[e.name] || 0) + 1;
    return Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]);
  })();
  const [ex, setEx] = useState<string | null>(null);
  const chosen = ex && exNames.includes(ex) ? ex : exNames[0];
  const hist = chosen ? e1rmHistory(sessions, chosen) : [];
  const exRec = chosen ? exerciseRecords(sessions, chosen) : null;
  const pain = painHistory(sessions, today, 8);
  const weeklyKm = weekly(sessions, (s) => runTotals(s, true)?.km || null, 12, today);
  const hasRun = weeklyKm.some((p) => p.y > 0) || !!client.run;

  return (
    <>
      <div className="kpi-grid kpi-strip">
        <Kpi label="Obciążenie 7 dni / średnia 4 tyg." value={`${fnum(lb.week, 0)} / ${lb.base != null ? fnum(lb.base, 0) : '—'}`} sub={lb.pct != null ? `${pctText(lb.pct)} (bez nakładania okresów)` : 'zbieram dane'} />
        <Kpi
          label="ACWR (7 / 28 dni)"
          hint="Klasyczny stosunek obciążenia 7 dni do średniej z 28 dni. Pokazany do analizy trendu. Badania 2019–2026 nie potwierdziły progów 0,8–1,3 / 1,5 jako prognozy kontuzji, więc bez kolorów ryzyka."
          value={st.acwr != null ? fx(st.acwr, 2) : '—'}
          sub={st.acwr != null ? 'trend, nie prognoza' : 'po 21 dniach'}
        />
        <Kpi label="Monotonia (7 dni)" hint="Średnie dzienne obciążenie / odchylenie (Foster). Przy 2–4 treningach w tygodniu mierzy głównie częstotliwość, dlatego bez alertów." value={st.monotony != null ? fx(st.monotony, 2) : '—'} sub="Foster, bez alertu" />
        <Kpi label="Strain (7 dni)" value={st.strain != null ? fnum(st.strain, 0) : '—'} sub="obciążenie × monotonia" />
      </div>

      <div className="two-col">
        <Card title="Obciążenie tygodniowe (sRPE × min)">
          <LoadWeeks sessions={sessions} today={today} />
        </Card>
        <Card title="ACWR w czasie (trend)">
          {acwrPts.length < 2 ? (
            <Empty>ACWR liczy się po 21 dniach historii.</Empty>
          ) : (
            <LineChart label="ACWR w czasie" series={[{ label: 'ACWR', pts: acwrPts }]} refs={[{ y: 1, label: '1,0 = jak zwykle', tone: 'muted' }]} format={(v) => fx(v, 2)} minY={0} />
          )}
        </Card>
        <Card title="Ciężkie serie na partię mięśniową">
          <table className="table mon-muscles">
            <thead>
              <tr>
                <th>Partia</th>
                <th className="num">Ten tydz.</th>
                <th className="num">Poprzedni</th>
                <th className="num">Średnio 4 tyg.</th>
              </tr>
            </thead>
            <tbody>
              {muscles.map((m) => (
                <tr key={m.muscle}>
                  <td>{m.label}</td>
                  <td className="num">{fnum(m.now, 1)}</td>
                  <td className="num">{fnum(m.prev, 1)}</td>
                  <td className="num">{fnum(avg4[m.muscle] / 4, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Serie robocze bez rozgrzewki; mięśnie główne liczone 1, pomocnicze ½. Orientacyjnie ok. 10–20 serii na partię tygodniowo przy celu sylwetkowym.</p>
        </Card>
        <Card title="Samopoczucie pytanie po pytaniu (1–5)">
          <table className="table">
            <thead>
              <tr>
                <th>Pytanie</th>
                <th className="num">Ostatnie 7 dni</th>
                <th className="num">Norma 28 dni</th>
                <th className="num">Zmiana</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const d = it.now != null && it.norm != null && it.n >= 8 ? it.now - it.norm : null;
                return (
                  <tr key={it.key}>
                    <td>{it.label}</td>
                    <td className="num">{it.now != null ? fx(it.now, 1) : '—'}</td>
                    <td className="num">{it.norm != null ? fx(it.norm, 1) : '—'}</td>
                    <td className={`num ${d != null && d <= -0.75 ? 'warn-text' : ''}`}>{d != null ? `${d >= 0 ? '+' : '−'}${fx(Math.abs(d), 1)}` : it.n < 8 ? 'zbieram' : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small">Pokazuje, które pytanie ciągnie wynik w dół. Pojedynczy słabszy dzień to szum; liczy się spadek przez kilka dni.</p>
        </Card>
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
                    {[...RECORD_REPS.map((n) => [`${n}RM`, recordRow(n, exRec.rm[n])] as const), ['Najlepszy e1RM', exRec.e1] as const].map(([label, r]) => (
                      <RecRow key={label} label={label} r={r} best={label === 'Najlepszy e1RM'} />
                    ))}
                  </tbody>
                </table>
              )}
              <p className="muted small">e1RM: szacunek z serii (Epley z RPE), najdokładniejszy z serii do ok. 10 powtórzeń. Patrz na trend, nie pojedynczy wynik.</p>
              {hist.length > 0 && (
                <p className="muted small">
                  {hist.length} {hist.length === 1 ? 'trening' : hist.length < 5 ? 'treningi' : 'treningów'} z tym ćwiczeniem · ostatnio {fmtDay(hist[hist.length - 1].date)}: {fnum(hist[hist.length - 1].load)} kg × {hist[hist.length - 1].reps} (e1RM {fnum(hist[hist.length - 1].e1, 1)})
                </p>
              )}
            </>
          )}
        </Card>
        <Card title="Gdzie boli: ostatnie 8 tygodni" className="pain-history">
          {pain.length === 0 ? (
            <Empty>Brak zaznaczonych miejsc bólu w ostatnich 8 tygodniach.</Empty>
          ) : (
            <div className="pain-hist-grid">
              <PainMap spots={painSpotsOf(pain)} readOnly />
              <ul className="rows pain-hist-list">
                {pain.map((r) => (
                  <li key={`${r.area}|${r.side ?? ''}`} className="row">
                    <strong className="grow">{painLabel(r)}</strong>
                    <span className="small">
                      {r.count} {r.count === 1 ? 'raz' : 'razy'} · max <b className={`num ${r.max > 5 ? 'danger-text' : r.max >= 3 ? 'warn-text' : ''}`}>{r.max}/10</b> · ostatnio {fmtShort(r.last)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
        {/* bieg: plan vs wykonanie i strefy (same się ukrywają, gdy klient nie biega) */}
        <RunVolume client={client} />
        {hasRun && <RunZones client={client} />}
      </div>
    </>
  );
}

/** Strefy tętna i tempa z profilu biegacza. */
function RunZones({ client }: { client: Client }) {
  const hm = zoneHr(ZONES[0], client.run, client.dob);
  const p5 = pace5k(client.run);
  return (
    <Card title="Bieganie: strefy">
      {!hm && !p5 ? (
        <p className="muted small">Strefy tętna i tempa: wpisz tętno progowe, tętno maks. albo czas na 5 km w Profilu.</p>
      ) : (
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
      )}
    </Card>
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
