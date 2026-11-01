import type { Client, CoachReply, ISODate, TrainingSession } from '../domain';
import { addDays } from './dates';

/* „Nowa wiadomość do…” — ta sama wiadomość trenera do wielu podopiecznych (Wiadomości). */

export type Audience = 'active' | 'picked' | 'club' | 'idle7';

export const AUDIENCE_LABEL: Record<Audience, string> = {
  active: 'Wszyscy aktywni',
  picked: 'Wybrani',
  club: 'Klub / miejsce',
  idle7: 'Bez treningu 7+ dni',
};

/** Ostatni trening podopiecznego (data) z listy treningów. */
function lastDates(sessions: TrainingSession[]): Map<string, ISODate> {
  const m = new Map<string, ISODate>();
  for (const s of sessions) if (!m.has(s.clientId) || s.date > m.get(s.clientId)!) m.set(s.clientId, s.date);
  return m;
}

/**
 * Odbiorcy: tylko aktywni podopieczni (pauza / zakończeni — nie). `idle7` — ostatni trening 7+ dni temu
 * albo jeszcze żadnego; `club` — domyślne miejsce treningów = `locationId`; `picked` — z listy `ids`.
 */
export function audience(clients: Client[], sessions: TrainingSession[], kind: Audience, today: ISODate, opts: { locationId?: string; ids?: string[] } = {}): Client[] {
  const active = clients.filter((c) => c.status === 'aktywny');
  const last = kind === 'idle7' ? lastDates(sessions.filter((s) => s.date <= today)) : null;
  const out = active.filter((c) => {
    if (kind === 'picked') return (opts.ids ?? []).includes(c.id);
    if (kind === 'club') return !!opts.locationId && c.locationId === opts.locationId;
    if (kind === 'idle7') {
      const d = last!.get(c.id);
      return !d || d <= addDays(today, -7);
    }
    return true;
  });
  return out.sort((a, b) => a.name.localeCompare(b.name, 'pl'));
}

/** {imię} → imię podopiecznego (pierwszy wyraz nazwy). */
export function fillName(text: string, c: Pick<Client, 'name'>): string {
  const first = c.name.trim().split(/\s+/)[0] || '';
  return text.replace(/\{imi[eę]\}/gi, first);
}

/** Podopieczni z odpowiedzią trenera dopisaną na końcu rozmowy (jeden zapis dla wszystkich). */
export function broadcastClients(list: Client[], text: string, now = new Date(), id = (c: Client) => `bc-${now.getTime().toString(36)}-${c.id}`): Client[] {
  const body = text.trim();
  if (!body) return [];
  return list.map((c) => {
    const r: CoachReply = { id: id(c), at: now.toISOString(), text: fillName(body, c).slice(0, 2000) };
    return { ...c, replies: [...(c.replies ?? []), r].slice(-200) };
  });
}
