import { applyChanges, normalizeDb, type Db, type Repository } from './db';
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
  let db: Db = read() ?? createSeed();
  write(db);
  return {
    // Zawsze od świeżej kopii z localStorage: druga karta mogła w międzyczasie coś zapisać.
    async load() {
      db = read() ?? db;
      return db;
    },
    async apply(changes) {
      db = applyChanges(read() ?? db, changes);
      write(db);
    },
    async replaceAll(next) {
      db = next;
      write(db);
    },
    async saveCheckin(clientId, checkin) {
      db = read() ?? db;
      db = {
        ...db,
        clients: db.clients.map((c) =>
          c.id === clientId ? { ...c, checkins: [...c.checkins.filter((x) => x.date !== checkin.date), checkin].slice(-200) } : c,
        ),
      };
      write(db);
    },
    async saveHabitDay(clientId, date, done) {
      db = read() ?? db;
      db = { ...db, clients: db.clients.map((c) => (c.id === clientId ? { ...c, habitLog: withDay(c.habitLog, date, done) } : c)) };
      write(db);
    },
    async addClientNote(clientId, note) {
      db = read() ?? db;
      db = { ...db, clients: db.clients.map((c) => (c.id === clientId ? { ...c, inbox: [...(c.inbox ?? []), note].slice(-200) } : c)) };
      write(db);
    },
  };
}
