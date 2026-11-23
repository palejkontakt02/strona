import type { Client, ISODate, TrainingSession } from '../domain';
import { todayISO } from './dates';
import { loadVsBaseline, type Level } from './load';
import { longestRunFlag } from './running';
import { wellnessTotal } from './wellness';
import { painRising, painStatus } from './painModel';

export interface Alert {
  level: Exclude<Level, 'green'>;
  text: string;
}

const fx = (v: number, n: number) => v.toFixed(n).replace('.', ',');
const fmtD = (iso: ISODate) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });

/**
 * Sygnały ostrzegawcze klienta: obciążenie 7 dni ≥ +50% wobec średniej z 4 poprzednich tygodni (żółty);
 * bieg > 30% dłuższy niż najdłuższy z 30 dni (żółty);
 * wellness ≤ 12/25 lub spadek > 20% vs średnia 4 poprzednich; ból ≥ 4 (≥ 6 czerwony);
 * aktywne urazy; LSI < 90% (< 80% czerwony) z najnowszego wyniku każdego testu;
 */
export function clientAlerts(client: Client, sessions: TrainingSession[], today: ISODate = todayISO(), extra: Alert[] = []): Alert[] {
  const a: Alert[] = [...extra];
  // obciążenie 7 dni wobec własnej średniej z 4 poprzednich tygodni — sygnał „do sprawdzenia”, nie prognoza kontuzji
  // (progi ACWR 0,8–1,3 / 1,5 i monotonia nie przeszły testów w badaniach 2019–2026)
  const lb = loadVsBaseline(sessions, today);
  if (lb.pct != null && lb.pct >= 0.5) a.push({ level: 'yellow', text: `Obciążenie 7 dni +${Math.round(lb.pct * 100)}% wobec średniej z 4 tygodni: sprawdź, jak to znosi` });
  // bieg: pojedynczy bieg dużo dłuższy niż najdłuższy z 30 dni (najlepiej udokumentowany sygnał u biegaczy amatorów)
  const lr = longestRunFlag(sessions, today);
  if (lr && lr.pct > 0.3) a.push({ level: 'yellow', text: `Bieg ${fmtD(lr.date)} o ${Math.round(lr.pct * 100)}% dłuższy niż najdłuższy z 30 dni (${fx(lr.km, 1)} km)` });

  // ból i samopoczucie: tylko świeże dane (14 dni) — stary wynik nie świeci miesiącami
  const since = new Date(new Date(today + 'T12:00:00').getTime() - 14 * 86400000).toISOString().slice(0, 10);
  const desc = [...sessions].sort((x, y) => y.date.localeCompare(x.date)).filter((s) => s.date >= since);
  const ws = desc.filter((s) => wellnessTotal(s.wellness) != null);
  if (ws.length) {
    const last = wellnessTotal(ws[0].wellness)!;
    const prev = ws.slice(1, 5).map((s) => wellnessTotal(s.wellness)!);
    const avg = prev.length ? prev.reduce((x, y) => x + y, 0) / prev.length : null;
    if (last <= 12) a.push({ level: 'red', text: `Wellness ${last}/25 na treningu ${fmtD(ws[0].date)}` });
    else if (avg && last < avg * 0.8)
      a.push({ level: 'yellow', text: `Wellness spadł do ${last}/25 (${fmtD(ws[0].date)}, średnio ${Math.round(avg)})` });
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
    else if (avg && v < avg * 0.8) a.push({ level: 'yellow', text: `Samopoczucie spadło do ${v}/25 (zwykle ${Math.round(avg)}), check-in ${fmtD(lastCi.date)}` });
  }

  // najwyższy ból z 7 dni (dzień bez bólu po treningu z bólem 7/10 nie gasi sygnału), inaczej ostatni zapisany
  const weekAgo = new Date(new Date(today + 'T12:00:00').getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const lp = desc.filter((s) => s.pain != null && s.date >= weekAgo).reduce<(typeof desc)[number] | undefined>((m, s) => (!m || s.pain! > m.pain! ? s : m), undefined) ?? desc.find((s) => s.pain != null);
  // trening przerwany w odtwarzaczu z powodu bólu („Przerwij, bo boli”) — ostatnie 7 dni
  const stop = desc.find((s) => s.stoppedForPain && s.date >= weekAgo);
  if (stop) {
    const sp = stop.stoppedForPain!;
    const where = (sp.spots ?? []).map((p) => (p.side ? `${p.area} ${p.side}` : p.area)).join(', ');
    a.push({ level: sp.level >= 6 ? 'red' : 'yellow', text: `Przerwany trening z bólem ${sp.level}/10${where ? ` (${where})` : ''}${sp.exName ? `, ${sp.exName}` : ''}, ${fmtD(stop.date)}` });
  }
  // model monitorowania bólu: >5 w trakcie, nieustępujący do rana albo rano gorzej — czerwony; 3–5 rano — żółty
  // „sprawdź rano” ma sens tylko 2 dni po treningu (wtedy podopieczny dostaje pytanie); starszy bez wpisu — bez sygnału
  const twoAgo = new Date(new Date(today + 'T12:00:00').getTime() - 2 * 86400000).toISOString().slice(0, 10);
  const ps = desc
    .filter((s) => s.date >= weekAgo && s !== stop)
    .map((s) => ({ s, st: painStatus(s) }))
    .find((x) => x.st && x.st.light !== 'green' && !(x.st.light === 'yellow' && !x.s.painNext && x.s.date < twoAgo));
  if (ps) a.push({ level: ps.st!.light === 'red' ? 'red' : 'yellow', text: `Ból po treningu ${fmtD(ps.s.date)}: ${ps.st!.text}` });
  else if (lp && lp.pain! >= 4 && lp !== stop)
    a.push({ level: lp.pain! >= 6 ? 'red' : 'yellow', text: `Ból ${lp.pain}/10 na treningu ${fmtD(lp.date)}` });
  if (painRising(sessions, today)) a.push({ level: 'yellow', text: 'Ból rośnie drugi tydzień z rzędu' });

  // stan przewlekły (stabilny) nie świeci ciągle — jest w profilu
  const inj = client.injuryLog.filter((i) => i.status === 'aktywny' || i.status === 'w rehabilitacji');
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
