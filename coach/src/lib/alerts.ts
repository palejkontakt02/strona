import type { Client, ISODate, TrainingSession } from '../domain';
import { todayISO } from './dates';
import { loadStats, type Level } from './load';
import { wellnessTotal } from './wellness';

export interface Alert {
  level: Exclude<Level, 'green'>;
  text: string;
}

const fx = (v: number, n: number) => v.toFixed(n).replace('.', ',');
const fmtD = (iso: ISODate) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });

/**
 * Sygnały ostrzegawcze klienta: ACWR > 1,5 (czerwony) / > 1,3 (żółty); monotonia > 2;
 * wellness ≤ 12/25 lub spadek > 20% vs średnia 4 poprzednich; ból ≥ 4 (≥ 6 czerwony);
 * aktywne urazy; LSI < 90% (< 80% czerwony) z najnowszego wyniku każdego testu.
 */
export function clientAlerts(client: Client, sessions: TrainingSession[], today: ISODate = todayISO()): Alert[] {
  const a: Alert[] = [];
  const st = loadStats(sessions, today);
  if (st.acwr != null && st.acwr > 1.5) a.push({ level: 'red', text: `ACWR ${fx(st.acwr, 2)} – gwałtowny wzrost obciążeń` });
  else if (st.acwr != null && st.acwr > 1.3)
    a.push({ level: 'yellow', text: `ACWR ${fx(st.acwr, 2)} – obciążenie rośnie szybko` });
  if (st.monotony != null && st.monotony > 2)
    a.push({ level: 'yellow', text: `Monotonia ${fx(st.monotony, 1)} – mało zróżnicowane obciążenia` });

  const desc = [...sessions].sort((x, y) => y.date.localeCompare(x.date));
  const ws = desc.filter((s) => wellnessTotal(s.wellness) != null);
  if (ws.length) {
    const last = wellnessTotal(ws[0].wellness)!;
    const prev = ws.slice(1, 5).map((s) => wellnessTotal(s.wellness)!);
    const avg = prev.length ? prev.reduce((x, y) => x + y, 0) / prev.length : null;
    if (last <= 12) a.push({ level: 'red', text: `Wellness ${last}/25 na ostatnim treningu` });
    else if (avg && last < avg * 0.8)
      a.push({ level: 'yellow', text: `Wellness spadł do ${last}/25 (średnio ${Math.round(avg)})` });
  }

  // check-in samopoczucia z ostatnich 2 dni (także bez treningu), jeśli nowszy niż ostatni trening z wellness
  const ci = [...client.checkins].filter((c) => wellnessTotal(c) != null).sort((x, y) => y.date.localeCompare(x.date));
  const lastCi = ci[0];
  const twoDaysAgo = new Date(new Date(today + 'T12:00:00').getTime() - 2 * 86400000).toISOString().slice(0, 10);
  if (lastCi && lastCi.date >= twoDaysAgo && (!ws.length || lastCi.date > ws[0].date)) {
    const v = wellnessTotal(lastCi)!;
    const prev = ci.slice(1, 8).map((c) => wellnessTotal(c)!);
    const avg = prev.length ? prev.reduce((x, y) => x + y, 0) / prev.length : null;
    if (v <= 12) a.push({ level: 'red', text: `Samopoczucie ${v}/25 (check-in ${fmtD(lastCi.date)})` });
    else if (avg && v < avg * 0.8) a.push({ level: 'yellow', text: `Samopoczucie spadło do ${v}/25 (zwykle ${Math.round(avg)}) — check-in ${fmtD(lastCi.date)}` });
  }

  const lp = desc.find((s) => s.pain != null);
  if (lp && lp.pain! >= 4)
    a.push({ level: lp.pain! >= 6 ? 'red' : 'yellow', text: `Ból ${lp.pain}/10 na treningu ${fmtD(lp.date)}` });

  const inj = client.injuryLog.filter((i) => i.status !== 'wyleczony');
  if (inj.length) a.push({ level: 'yellow', text: `Aktywne urazy: ${inj.map((i) => i.name).join(', ')}` });

  const latest: Record<string, Client['tests'][number]> = {};
  for (const t of client.tests) {
    if (t.lsi == null) continue;
    if (!latest[t.name] || latest[t.name].date < t.date) latest[t.name] = t;
  }
  for (const t of Object.values(latest)) {
    if (t.lsi! < 90) a.push({ level: t.lsi! < 80 ? 'red' : 'yellow', text: `${t.name}: LSI ${String(t.lsi).replace('.', ',')}% (cel ≥90%)` });
  }
  return a;
}
