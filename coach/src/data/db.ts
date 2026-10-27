import type { Intake } from '../lib/intake';
import type { Appointment, Checkin, Client, ClientNote, DayLog, LibraryExercise, Location, Measurement, Plan, ProgressPhoto, TrainerNotes, TrainingSession, WeeklyReport } from '../domain';

export interface Db {
  clients: Client[];
  plans: Plan[];
  sessions: TrainingSession[];
  appointments: Appointment[];
  library: LibraryExercise[];
  locations: Location[];
  /** Tylko trener: wywiad zdrowotny i prywatne notatki (osobna tabela w bazie). */
  trainer_notes: TrainerNotes[];
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
      intake: isRec(r.intake) && isRec(r.intake.answers)
        ? {
            ...r.intake,
            answers: Object.fromEntries(Object.entries(r.intake.answers as Rec).filter(([, v]) => typeof v === 'string')),
            // pliki: tylko poprawne wpisy (odnośnik do magazynu, nazwa)
            files: Array.isArray(r.intake.files) ? (r.intake.files as unknown[]).filter((f): f is Rec => isRec(f) && typeof f.ref === 'string' && /^(sb|idb):/.test(f.ref) && typeof f.name === 'string') : undefined,
          }
        : undefined,
      selfMeasurements: Array.isArray(r.selfMeasurements) ? r.selfMeasurements.filter((m) => isRec(m) && isDate(m.date)) : undefined,
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
      weeklyReports: Array.isArray(r.weeklyReports) ? r.weeklyReports.filter((x) => isRec(x) && typeof x.id === 'string' && isDate(x.week)) : undefined,
      progressPhotos: Array.isArray(r.progressPhotos) ? r.progressPhotos.filter((x) => isRec(x) && typeof x.id === 'string' && isDate(x.date) && typeof x.ref === 'string' && /^(sb|idb):/.test(x.ref)) : undefined,
      dayLog: Array.isArray(r.dayLog) ? r.dayLog.filter((x) => isRec(x) && isDate(x.date)) : undefined,
      replies: Array.isArray(r.replies)
        ? r.replies.filter((n): n is Rec => isRec(n) && typeof n.text === 'string').map((n, i) => ({ ...n, id: typeof n.id === 'string' ? n.id : `r${i}`, at: typeof n.at === 'string' ? n.at : '', text: n.text as string }))
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
    trainer_notes: clean<TrainerNotes>(db.trainer_notes, (r) => typeof r.clientId === 'string', (r) => ({ ...r, visits: arr(r.visits).filter((v) => isRec(v) && typeof v.text === 'string') })),
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
  /** Pomiar wpisany przez podopiecznego. */
  addMeasurement(clientId: string, m: Measurement): Promise<void>;
  /** Ankieta podopiecznego (zapis całości). */
  saveIntake(clientId: string, intake: Intake): Promise<void>;
  /**
   * Wpis podopiecznego w jego profilu: raport tygodniowy (po `id`), zdjęcie sylwetki (po `id`)
   * albo dzienny zapis makro / kroków (po `date`). Zastępuje wpis o tym samym kluczu.
   */
  saveClientEntry(clientId: string, kind: ClientEntryKind, entry: WeeklyReport | ProgressPhoto | DayLog | import('../domain').ConsentEntry | import('../domain').Absence | import('../domain').ExNote): Promise<void>;
  /** Czyja kolejka zapisów offline na tym urządzeniu (konto); brak = „local”. */
  outboxScope?(): Promise<string>;
  /** Podopieczny potwierdza albo odwołuje wizytę (funkcja client_respond_appointment, sekcja 23). Zwraca zapisaną wizytę. */
  respondAppointment?(id: string, kind: 'confirm' | 'cancel', reason?: string): Promise<Appointment | null>;
  /** Podopieczny: znacznik „trenuje teraz u siebie” (null = koniec). Sekcja 27 w hardening.sql. */
  setAthleteLive?(clientId: string, mark: { name: string; workoutId?: string } | null): Promise<void>;
  /** Lekki odczyt znaczników treningu w toku (trener / podopieczny) — bez pobierania całej bazy. */
  pollLive?(): Promise<{ id: string; liveBy?: import('../domain').LiveMark; athleteLive?: import('../domain').LiveMark }[]>;
}

export type ClientEntryKind = 'weeklyReports' | 'progressPhotos' | 'dayLog' | 'consents' | 'absences' | 'exNotes';

/** Wstawia albo podmienia wpis (raport / zdjęcie po id, dzień po dacie); najwyżej `max` ostatnich. */
export function withEntry<T extends { id?: string; date?: string }>(list: T[] | undefined, entry: T, max = 400): T[] {
  const key = (x: T) => x.id ?? x.date;
  return [...(list ?? []).filter((x) => key(x) !== key(entry)), entry].slice(-max);
}
