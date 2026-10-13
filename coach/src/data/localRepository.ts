import { applyChanges, type Db, type Repository } from './db';
import { createSeed } from './seed';

const KEY = 'panel-trenera:v1';

function read(): Db | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Db) : null;
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
    async load() {
      return db;
    },
    async apply(changes) {
      db = applyChanges(db, changes);
      write(db);
    },
    async replaceAll(next) {
      db = next;
      write(db);
    },
  };
}
