import type { Appointment, Client, ISODate, Payment, TrainingSession } from '../domain';
import { packageStatus } from './billing';

/* Zmiana statusu podopiecznego na „zakończony”: przyszłe wizyty, niewykorzystany pakiet, zwrot. */

export interface EndSummary {
  /** Zaplanowane wizyty od dziś (bez zapisanego treningu). */
  future: Appointment[];
  /** Niewykorzystane sesje z pakietu (≥ 0). */
  unused: number;
  /** Wartość niewykorzystanych sesji (cena ostatniego pakietu / liczba sesji × niewykorzystane), zł. */
  value: number;
}

export function endSummary(client: Client, sessions: TrainingSession[], appts: Appointment[], today: ISODate): EndSummary {
  const future = appts
    .filter((a) => a.clientId === client.id && a.status === 'planned' && !a.sessionId && a.date >= today)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const pk = packageStatus(client, sessions.filter((s) => s.clientId === client.id));
  const unused = Math.max(0, pk?.left ?? 0);
  const last = [...client.payments].filter((p) => p.type === 'pakiet' && (p.sessions ?? 0) > 0).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  const per = last && last.sessions ? last.amount / last.sessions : client.pkgPrice && client.pkgSize ? client.pkgPrice / client.pkgSize : 0;
  return { future, unused, value: Math.round(unused * per * 100) / 100 };
}

/**
 * Zwrot za niewykorzystane sesje: pozycja „pakiet” z ujemną liczbą sesji i kwotą (zeruje pozostałe sesje,
 * pomniejsza przychód). Status „opłacona” — zwrot rozliczony.
 */
export function refundPayment(s: EndSummary, today: ISODate, id: string): Payment | null {
  if (s.unused <= 0) return null;
  return { id, type: 'pakiet', amount: -s.value, sessions: -s.unused, date: today, status: 'paid', paidDate: today, desc: `Zwrot za niewykorzystane sesje (${s.unused})` };
}
