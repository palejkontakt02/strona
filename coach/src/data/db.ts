import type { Appointment, Checkin, Client, ClientNote, LibraryExercise, Location, Plan, TrainingSession } from '../domain';

export interface Db {
  clients: Client[];
  plans: Plan[];
  sessions: TrainingSession[];
  appointments: Appointment[];
  library: LibraryExercise[];
  locations: Location[];
}

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => !!x && typeof x === 'object' && !Array.isArray(x);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const isDate = (x: unknown) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x);

/** Rekordy z `id`; pomija śmieci (np. zapisane ręcznie przez API), żeby jeden zły wiersz nie zablokował całego panelu. */
function clean<T>(list: unknown, ok: (r: Rec) => boolean, fix: (r: Rec) => Rec = (r) => r): T[] {
  return arr(list)
    .filter((r): r is Rec => isRec(r) && typeof r.id === 'string' && ok(r))
    .map((r) => fix(r) as T);
}

/** Uzupełnia brakujące kolekcje i pola (dane ze starszej wersji aplikacji albo uszkodzone). */
export function normalizeDb(db: Partial<Db>): Db {
  return {
    clients: clean<Client>(db.clients, (r) => typeof r.name === 'string', (r) => ({
      ...r,
      payments: arr(r.payments)
        .filter((p) => isRec(p) && isDate(p.date))
        .map((p) => ({ type: 'pojedyncza', status: 'due', ...(p as Rec), amount: typeof (p as Rec).amount === 'number' ? (p as Rec).amount : 0 })),
      measurements: arr(r.measurements).filter(isRec),
      tests: arr(r.tests).filter(isRec),
      injuryLog: arr(r.injuryLog).filter(isRec),
      checkins: arr(r.checkins).filter((c) => isRec(c) && isDate(c.date)),
      habits: Array.isArray(r.habits)
        ? r.habits
            .filter((h): h is Rec => isRec(h) && typeof h.id === 'string' && typeof h.title === 'string')
            .map((h) => {
              const sc = isRec(h.schedule) ? h.schedule : {};
              const kind = sc.kind === 'week' || sc.kind === 'month' ? sc.kind : 'daily';
              return { ...h, schedule: kind === 'daily' ? { kind } : { kind, days: arr(sc.days).filter((d) => Number.isInteger(d)) } };
            })
        : undefined,
      habitLog: Array.isArray(r.habitLog) ? r.habitLog.filter((d) => isRec(d) && isDate(d.date) && Array.isArray(d.done)) : undefined,
      inbox: Array.isArray(r.inbox)
        ? r.inbox.filter((n): n is Rec => isRec(n) && typeof n.text === 'string').map((n, i) => ({ ...n, id: typeof n.id === 'string' ? n.id : `n${i}`, at: typeof n.at === 'string' ? n.at : '' }))
        : undefined,
      replies: Array.isArray(r.replies)
        ? r.replies.filter((n): n is Rec => isRec(n) && typeof n.text === 'string').map((n, i) => ({ id: typeof n.id === 'string' ? n.id : `r${i}`, at: typeof n.at === 'string' ? n.at : '', text: n.text as string }))
        : undefined,
    })),
    plans: clean<Plan>(db.plans, (r) => typeof r.clientId === 'string', (r) => ({
      ...r,
      weeks: arr(r.weeks).filter(isRec).map((w) => ({ ...w, workouts: arr(w.workouts).filter(isRec).map((k) => ({ ...k, exercises: arr(k.exercises).filter(isRec).map((e) => ({ ...e, groups: arr(e.groups).filter(isRec) })) })) })),
    })),
    sessions: clean<TrainingSession>(db.sessions, (r) => typeof r.clientId === 'string' && isDate(r.date), (r) => ({
      ...r,
      charge: typeof r.charge === 'string' ? r.charge : 'brak',
      exercises: arr(r.exercises).filter((e) => isRec(e) && typeof e.name === 'string').map((e) => ({ ...(e as Rec), setsLog: Array.isArray((e as Rec).setsLog) ? ((e as Rec).setsLog as unknown[]).filter(isRec) : undefined })),
    })),
    appointments: clean<Appointment>(db.appointments, (r) => typeof r.clientId === 'string' && isDate(r.date) && typeof r.time === 'string', (r) => ({
      ...r,
      status: ['planned', 'done', 'cancel', 'noshow'].includes(r.status as string) ? r.status : 'planned',
    })),
    library: clean<LibraryExercise>(db.library, (r) => typeof r.name === 'string'),
    locations: clean<Location>(db.locations, (r) => typeof r.name === 'string', (r) => ({ ...r, payouts: arr(r.payouts).filter(isRec) })),
  };
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
  /** Check-in samopoczucia (klient zapisuje tylko to w swoim profilu). */
  saveCheckin(clientId: string, checkin: Checkin): Promise<void>;
  /** Odhaczone zadania dzienne podopiecznego w danym dniu. */
  saveHabitDay(clientId: string, date: string, done: string[]): Promise<void>;
  /** Notatka od podopiecznego do trenera. */
  addClientNote(clientId: string, note: ClientNote): Promise<void>;
}
