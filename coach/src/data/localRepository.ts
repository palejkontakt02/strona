import { applyChanges, normalizeDb, withEntry, type Db, type Repository } from './db';
import { createSeed } from './seed';
import { withDay } from '../lib/habits';

const KEY = 'panel-trenera:v1';

function read(): Db | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalizeDb(JSON.parse(raw) as Partial<Db>) : null;
  } catch {
    return null;
  }
}

function write(db: Db) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    // brak dostępu do localStorage — dane zostają w pamięci tej karty
  }
}

export function createLocalRepository(): Repository {
  const stored = read();
  let db: Db = stored ?? createSeed();
  if (!stored) write(db);
  // Zapis do localStorage zbijany (duża baza = drogi JSON.stringify), dane w pamięci są źródłem prawdy;
  // przy zamknięciu / schowaniu karty zapisujemy od razu.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (dirty) write(db);
    dirty = false;
  };
  const persist = () => {
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 120);
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
  }
  return {
    // Odczyt z localStorage: druga karta mogła coś zapisać (store przeładowuje po zdarzeniu „storage”).
    async load() {
      flush();
      db = read() ?? db;
      return db;
    },
    async apply(changes) {
      db = applyChanges(db, changes);
      persist();
    },
    async replaceAll(next) {
      db = next;
      dirty = true;
      flush();
    },
    async saveCheckin(clientId, checkin) {
      db = {
        ...db,
        clients: db.clients.map((c) =>
          c.id === clientId ? { ...c, checkins: [...c.checkins.filter((x) => x.date !== checkin.date), checkin].slice(-200) } : c,
        ),
      };
      persist();
    },
    async saveHabitDay(clientId, date, done) {
      db = { ...db, clients: db.clients.map((c) => (c.id === clientId ? { ...c, habitLog: withDay(c.habitLog, date, done) } : c)) };
      persist();
    },
    async saveIntake(clientId, intake) {
      db = { ...db, clients: db.clients.map((c) => (c.id === clientId ? { ...c, intake } : c)) };
      persist();
    },
    async addMeasurement(clientId, m) {
      db = { ...db, clients: db.clients.map((c) => (c.id === clientId ? { ...c, selfMeasurements: [...(c.selfMeasurements ?? []), m].slice(-500) } : c)) };
      persist();
    },
    async saveClientEntry(clientId, kind, entry) {
      db = { ...db, clients: db.clients.map((c) => (c.id === clientId ? { ...c, [kind]: withEntry((c[kind] ?? []) as { id?: string; date?: string }[], entry as { id?: string; date?: string }) } : c)) };
      persist();
    },
    async addClientNote(clientId, note) {
      db = { ...db, clients: db.clients.map((c) => (c.id === clientId ? { ...c, inbox: [...(c.inbox ?? []), note].slice(-200) } : c)) };
      persist();
    },
  };
}
