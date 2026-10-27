import type { Appointment } from '../domain';
import { clashes, DEFAULT_APPT_MIN } from './calendar';
import { toMinutes } from './dates';

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * Najczęstsza godzina i długość wizyt klienta (bez odwołanych). Przy remisie — nowsza wizyta.
 * Brak wizyt → null.
 */
export function usualSlot(appts: Appointment[], clientId: string): { time: string; duration: number } | null {
  const own = appts.filter((a) => a.clientId === clientId && a.status !== 'cancel' && /^\d{1,2}:\d{2}$/.test(a.time ?? '')).sort((a, b) => (a.date < b.date ? 1 : -1));
  if (!own.length) return null;
  const top = <T,>(xs: T[]): T => {
    const n = new Map<T, number>();
    for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
    // Map zachowuje kolejność wstawienia (od najnowszej) — przy remisie wygrywa nowsza
    let best = xs[0];
    for (const [x, c] of n) if (c > (n.get(best) ?? 0)) best = x;
    return best;
  };
  return { time: hhmm(top(own.map((a) => toMinutes(a.time)))), duration: top(own.map((a) => a.duration || DEFAULT_APPT_MIN)) };
}

/**
 * Pierwsza wolna pełna godzina tego dnia między `from` a `to` (wizyta musi się skończyć do `to`), bez kolizji.
 * `nowMin` — dziś: tylko godziny od następnej pełnej. Brak wolnej → null.
 */
export function firstFreeHour(appts: Appointment[], date: string, duration = DEFAULT_APPT_MIN, opts: { from?: number; to?: number; nowMin?: number; ignoreIds?: string[] } = {}): string | null {
  const from = opts.from ?? 7;
  const to = opts.to ?? 20;
  const startH = opts.nowMin != null ? Math.max(from, Math.floor(opts.nowMin / 60) + 1) : from;
  const others = opts.ignoreIds?.length ? appts.filter((a) => !opts.ignoreIds!.includes(a.id)) : appts;
  for (let h = startH; h * 60 + duration <= to * 60; h++) {
    const time = hhmm(h * 60);
    if (!clashes({ id: '__new', date, time, duration }, others).length) return time;
  }
  return null;
}

/** Podpowiedź dla nowej wizyty: zwyczaj klienta (jeśli wolne), inaczej pierwsza wolna pełna godzina 7–20. */
export function suggestSlot(appts: Appointment[], clientId: string, date: string, nowMin?: number): { time: string; duration: number } {
  const usual = clientId ? usualSlot(appts, clientId) : null;
  const duration = usual?.duration ?? DEFAULT_APPT_MIN;
  if (usual && !clashes({ id: '__new', date, time: usual.time, duration }, appts).length && (nowMin == null || toMinutes(usual.time) > nowMin)) return usual;
  return { time: firstFreeHour(appts, date, duration, { nowMin }) ?? usual?.time ?? '17:00', duration };
}
