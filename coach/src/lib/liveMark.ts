import type { Client, LiveMark } from '../domain';

/** Znacznik „trener prowadzi trening” uznajemy za aktualny przez 4 h (telefon trenera mógł się rozładować). */
export const LIVE_TTL_MS = 4 * 3600_000;

export function liveMarkActive(m: LiveMark | undefined | null, now = Date.now()): m is LiveMark {
  if (!m) return false;
  const t = Date.parse(m.at);
  return Number.isFinite(t) && now - t < LIVE_TTL_MS;
}

/** Jaki znacznik powinien mieć klient przy danym treningu trenera w toku (null = brak). */
export function wantedMark(run: { name: string; workoutId?: string; editSessionId?: string } | null): Omit<LiveMark, 'at'> | null {
  if (!run || run.editSessionId) return null;
  return { name: run.name, workoutId: run.workoutId || undefined };
}

/** Czy zapisać zmianę znacznika (włączenie, wyłączenie albo inny trening). */
export function markNeedsUpdate(c: Pick<Client, 'liveBy'>, want: Omit<LiveMark, 'at'> | null, now = Date.now()): boolean {
  const active = liveMarkActive(c.liveBy, now);
  if (!want) return !!c.liveBy;
  if (!active) return true;
  return c.liveBy!.workoutId !== want.workoutId || c.liveBy!.name !== want.name;
}
