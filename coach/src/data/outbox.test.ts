import { describe, expect, it } from 'vitest';
import { put, del, type Change, type Db } from './db';
import { Outbox, enqueue, isNetworkError, readOutbox } from './outbox';

/** Pamięć zamiast localStorage. */
function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

const netErr = () => ({ message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' });
const rlsErr = () => ({ message: 'new row violates row-level security policy', code: '42501' });

/** Udawana baza: `offline` = każdy zapis kończy się błędem sieci; zapisane zmiany w `sent`. */
function fakeRepo() {
  const r = {
    offline: false,
    reject: new Set<string>(),
    sent: [] as Change[],
    async apply(changes: Change[]) {
      for (const ch of changes) {
        if (r.offline) throw netErr();
        if (ch.op === 'put' && r.reject.has((ch.item as { id: string }).id)) throw rlsErr();
        r.sent.push(ch);
      }
    },
  };
  return r;
}

const sess = (id: string, note = '') => put('sessions', { id, clientId: 'c1', date: '2026-10-24', charge: 'brak', exercises: [], notes: note } as never);
const emptyDb = (): Db => ({ clients: [], plans: [], sessions: [], appointments: [], library: [], locations: [], trainer_notes: [] });

describe('kolejka offline', () => {
  it('ten sam rekord = jeden wpis z najnowszą wersją, kolejność pierwszego zapisu zostaje', () => {
    const box = enqueue(enqueue([], [sess('a', '1'), sess('b')]), [sess('a', '2'), del('appointments', 'x')]);
    expect(box.map((c) => (c.op === 'put' ? `${c.col}:${c.item.id}:${(c.item as { notes?: string }).notes}` : `del:${c.id}`))).toEqual(['sessions:a:2', 'sessions:b:', 'del:x']);
  });

  it('rozpoznaje brak sieci, a nie odmowę bazy', () => {
    expect(isNetworkError(netErr(), true)).toBe(true);
    expect(isNetworkError(new TypeError('Load failed'), true)).toBe(true);
    expect(isNetworkError(rlsErr(), true)).toBe(false);
    expect(isNetworkError(rlsErr(), false)).toBe(false);
    expect(isNetworkError({ message: 'cokolwiek' }, false)).toBe(true);
    expect(isNetworkError({ message: 'JWT expired', code: 'PGRST301' }, true)).toBe(false);
  });

  it('bez sieci: zapis trafia do kolejki (także po przeładowaniu), po powrocie sieci wysyła po kolei', async () => {
    const st = memStorage();
    const repo = fakeRepo();
    const counts: number[] = [];
    const box = new Outbox(repo, 'client:u1', (n) => counts.push(n), st);
    repo.offline = true;
    expect(await box.submit([sess('a', '1')])).toBe('queued');
    expect(await box.submit([sess('b')])).toBe('queued');
    expect(await box.submit([sess('a', '2')])).toBe('queued');
    expect(box.items).toHaveLength(2);
    // inna karta / ponowne uruchomienie aplikacji: kolejka z localStorage, osobno dla konta
    expect(readOutbox('client:u1', st)).toHaveLength(2);
    expect(readOutbox('client:u2', st)).toHaveLength(0);
    const again = new Outbox(repo, 'client:u1', undefined, st);
    // przeładowanie danych z serwera nie gubi czekających zapisów
    const merged = again.merge(emptyDb());
    expect(merged.sessions.map((s) => `${s.id}:${s.notes}`)).toEqual(['a:2', 'b:']);
    // nadal offline — nic nie znika
    expect((await again.flush()).offline).toBe(true);
    expect(again.items).toHaveLength(2);
    repo.offline = false;
    const r = await again.flush();
    expect(r).toMatchObject({ sent: 2, offline: false, failed: [] });
    expect(repo.sent.map((c) => (c.op === 'put' ? `${c.item.id}:${(c.item as { notes?: string }).notes}` : ''))).toEqual(['a:2', 'b:']);
    expect(again.items).toHaveLength(0);
    expect(readOutbox('client:u1', st)).toHaveLength(0);
    expect(counts.at(-1)).toBe(2);
  });

  it('gdy kolejka czeka, nowy zapis idzie za nią (starsza wersja nie nadpisze nowszej)', async () => {
    const repo = fakeRepo();
    const box = new Outbox(repo, 's', undefined, memStorage());
    repo.offline = true;
    await box.submit([sess('a', 'stara'), sess('b')]);
    repo.offline = false;
    expect(await box.submit([sess('a', 'nowa')])).toBe('sent');
    expect(repo.sent.map((c) => (c.op === 'put' ? `${c.item.id}:${(c.item as { notes?: string }).notes}` : ''))).toEqual(['a:nowa', 'b:']);
    expect(box.items).toHaveLength(0);
  });

  it('odmowa bazy: bez kolejki — błąd od razu; w kolejce — wpis usunięty, reszta wysłana', async () => {
    const repo = fakeRepo();
    const box = new Outbox(repo, 's', undefined, memStorage());
    repo.reject.add('zly');
    await expect(box.submit([sess('zly')])).rejects.toMatchObject({ code: '42501' });
    expect(box.items).toHaveLength(0);
    repo.offline = true;
    await box.submit([sess('zly'), sess('ok')]);
    repo.offline = false;
    const r = await box.flush();
    expect(r.sent).toBe(1);
    expect(r.failed).toHaveLength(1);
    expect(box.items).toHaveLength(0);
  });

  it('zapis w trakcie wysyłki tego samego rekordu zostaje do następnej wysyłki', async () => {
    const repo = fakeRepo();
    const box = new Outbox(repo, 's', undefined, memStorage());
    repo.offline = true;
    await box.submit([sess('a', '1')]);
    repo.offline = false;
    const p = box.flush();
    // w trakcie wysyłki użytkownik zapisuje ponownie
    const q = box.submit([sess('a', '2')]);
    await p;
    expect(await q).toBe('sent');
    expect(repo.sent.map((c) => (c.op === 'put' ? (c.item as { notes?: string }).notes : ''))).toEqual(['1', '2']);
    expect(box.items).toHaveLength(0);
  });
});
