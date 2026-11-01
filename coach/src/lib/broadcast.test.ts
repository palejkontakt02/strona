import { describe, expect, it } from 'vitest';
import type { Client, TrainingSession } from '../domain';
import { audience, broadcastClients, fillName } from './broadcast';

const cl = (id: string, name: string, extra: Partial<Client> = {}): Client => ({ id, name, status: 'aktywny', payments: [], measurements: [], tests: [], injuryLog: [], checkins: [], ...extra });
const ses = (clientId: string, date: string) => ({ id: clientId + date, clientId, date, exercises: [], charge: 'brak' }) as unknown as TrainingSession;

describe('wiadomość do wielu', () => {
  const clients = [cl('a', 'Ania Nowak', { locationId: 'L1' }), cl('b', 'Bartek'), cl('c', 'Celina', { status: 'pauza', locationId: 'L1' }), cl('d', 'Darek', { locationId: 'L1' })];
  const sessions = [ses('a', '2026-11-08'), ses('b', '2026-11-01'), ses('a', '2026-10-01')];
  const T = '2026-11-08';
  it('odbiorcy: tylko aktywni', () => {
    expect(audience(clients, sessions, 'active', T).map((c) => c.id)).toEqual(['a', 'b', 'd']);
    expect(audience(clients, sessions, 'club', T, { locationId: 'L1' }).map((c) => c.id)).toEqual(['a', 'd']);
    expect(audience(clients, sessions, 'club', T).map((c) => c.id)).toEqual([]);
    expect(audience(clients, sessions, 'picked', T, { ids: ['b', 'c'] }).map((c) => c.id)).toEqual(['b']);
  });
  it('bez treningu 7+ dni (także bez żadnego treningu)', () => {
    expect(audience(clients, sessions, 'idle7', T).map((c) => c.id)).toEqual(['b', 'd']);
    expect(audience(clients, sessions, 'idle7', '2026-11-07').map((c) => c.id)).toEqual(['a', 'd']);
  });
  it('{imię} i zapis odpowiedzi', () => {
    expect(fillName('Cześć {imię}! {Imie}', { name: 'Ania Nowak' })).toBe('Cześć Ania! Ania');
    const out = broadcastClients([clients[0]], '  Hej {imię}  ', new Date('2026-11-08T10:00:00Z'));
    expect(out[0].replies?.[0]).toMatchObject({ text: 'Hej Ania', at: '2026-11-08T10:00:00.000Z' });
    expect(broadcastClients([clients[0]], '  ')).toEqual([]);
  });
});
