import type { Appointment, Client, LibraryExercise, Plan, TrainingSession } from '../domain';

export interface Db {
  clients: Client[];
  plans: Plan[];
  sessions: TrainingSession[];
  appointments: Appointment[];
  library: LibraryExercise[];
}

export type Collection = keyof Db;
type Item<C extends Collection> = Db[C][number];

/** Zmiana w danych: zapis (upsert) lub usunięcie jednego rekordu kolekcji. */
export type Change =
  | { [C in Collection]: { op: 'put'; col: C; item: Item<C> } }[Collection]
  | { op: 'del'; col: Collection; id: string };

export const put = <C extends Collection>(col: C, item: Item<C>): Change => ({ op: 'put', col, item }) as Change;
export const del = (col: Collection, id: string): Change => ({ op: 'del', col, id });

/** Stosuje zmiany do kopii bazy (rekordy identyfikowane po `id`). */
export function applyChanges(db: Db, changes: Change[]): Db {
  const next = { ...db } as Record<Collection, { id: string }[]>;
  for (const ch of changes) {
    const list = next[ch.col];
    if (ch.op === 'del') next[ch.col] = list.filter((x) => x.id !== ch.id);
    else {
      const i = list.findIndex((x) => x.id === ch.item.id);
      next[ch.col] = i >= 0 ? list.map((x, j) => (j === i ? ch.item : x)) : [...list, ch.item];
    }
  }
  return next as unknown as Db;
}

/**
 * Warstwa danych. Implementacja localStorage teraz; Supabase później
 * (każda kolekcja = tabela, `Change` = upsert/delete wiersza).
 */
export interface Repository {
  load(): Promise<Db>;
  apply(changes: Change[]): Promise<void>;
  replaceAll(db: Db): Promise<void>;
}
