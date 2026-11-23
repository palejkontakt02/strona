import type { Client, ISODate, TrainingSession, Wellness } from '../domain';
import { todayISO } from './dates';
import { loadVsBaseline, type Level } from './load';
import { longestRunFlag } from './running';
import { WELLNESS_ITEMS, wellnessTotal } from './wellness';
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
 * samopoczucie ≤ 12/25 w 2 dni (czerwony) albo 2 z 3 ostatnich wpisów ≥ 3 pkt poniżej własnej normy (min. 8 wpisów); ból ≥ 4 (≥ 6 czerwony);
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
  // samopoczucie (check-in, a bez niego ankieta z treningu) wobec własnej normy: pojedynczy słabszy dzień to szum —
  // sygnał dopiero przy 2 z 3 ostatnich wpisów wyraźnie poniżej normy; norma z min. 8 wpisów (wcześniej „zbieram dane”)
  const byDay = new Map<string, Wellness>();
  for (const s of sessions) if (s.wellness && wellnessTotal(s.wellness) != null) byDay.set(s.date, s.wellness);
  for (const c of client.checkins) if (wellnessTotal(c) != null) byDay.set(c.date, c);
  const days = [...byDay.entries()].filter(([d]) => d <= today).sort((x, y) => y[0].localeCompare(x[0]));
  const twoDaysAgo = new Date(new Date(today + 'T12:00:00').getTime() - 2 * 86400000).toISOString().slice(0, 10);
  const weekAgoW = new Date(new Date(today + 'T12:00:00').getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const recent = days.slice(0, 3).filter(([d]) => d >= weekAgoW);
  const normDays = days.slice(3).filter(([d]) => d >= new Date(new Date(today + 'T12:00:00').getTime() - 35 * 86400000).toISOString().slice(0, 10));
  const tot = (w: Wellness) => wellnessTotal(w)!;
  const veryLow = recent.find(([d, w]) => d >= twoDaysAgo && tot(w) <= 12);
  if (veryLow) a.push({ level: 'red', text: `Samopoczucie ${tot(veryLow[1])}/25 (${fmtD(veryLow[0])})` });
  else if (recent.length >= 2 && normDays.length >= 8) {
    const norm = normDays.reduce((x, [, w]) => x + tot(w), 0) / normDays.length;
    const below = recent.filter(([, w]) => tot(w) <= norm - 3);
    if (below.length >= 2) {
      // które pytanie ciągnie w dół
      const worst = WELLNESS_ITEMS.map(([k, label]) => {
        const now = recent.reduce((x, [, w]) => x + (w[k] ?? 0), 0) / recent.length;
        const was = normDays.reduce((x, [, w]) => x + (w[k] ?? 0), 0) / normDays.length;
        return { label, diff: now - was };
      }).sort((x, y) => x.diff - y.diff)[0];
      a.push({ level: 'yellow', text: `Samopoczucie poniżej normy ${below.length} z ${recent.length} ostatnich razy (${tot(recent[0][1])}/25, zwykle ${Math.round(norm)})${worst && worst.diff <= -0.5 ? `, najbardziej: ${worst.label.toLowerCase()}` : ''}` });
    }
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
