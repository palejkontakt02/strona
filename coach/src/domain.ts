/**
 * Model danych panelu trenera (wg specyfikacji „Panel trenera”, p. 3).
 * W odróżnieniu od prototypu: liczby są typowane, a odwołania do jednostek planu
 * używają stabilnych id zamiast indeksów „tydzień|jednostka”.
 * Daty: ISO „RRRR-MM-DD”, miesiące „RRRR-MM”, godziny „HH:MM”.
 */

export type ISODate = string;
export type YearMonth = string;

export type ClientStatus = 'aktywny' | 'pauza' | 'zakończony';
/** `klub` — klient płaci klubowi fitness, a klub wypłaca trenerowi stawkę za każdy trening. */
export type Billing = 'pakiet' | 'pojedyncza' | 'abonament' | 'klub' | 'brak';
export type DominantSide = 'prawa' | 'lewa' | '';

export interface Wellness {
  sleep?: number;
  energy?: number;
  muscle?: number;
  stress?: number;
  mood?: number;
}

export interface Checkin extends Wellness {
  date: ISODate;
}

export type PaymentType = 'pakiet' | 'abonament' | 'pojedyncza';

export interface Payment {
  id: string;
  type: PaymentType;
  amount: number;
  date: ISODate;
  dueDate?: ISODate;
  status: 'due' | 'paid';
  paidDate?: ISODate;
  /** Liczba sesji w pakiecie (tylko `pakiet`). */
  sessions?: number;
  /** Miesiąc abonamentu (tylko `abonament`). */
  month?: YearMonth;
  desc?: string;
}

export interface Measurement {
  id: string;
  date: ISODate;
  weight?: number;
  waist?: number;
  hips?: number;
  chest?: number;
  arm?: number;
  thigh?: number;
  bf?: number;
  note?: string;
  /** Pomiar wpisany przez podopiecznego; trener może go ukryć. */
  by?: 'client';
  hidden?: boolean;
}

export interface TestResult {
  id: string;
  date: ISODate;
  name: string;
  value?: number | string;
  unit?: string;
  left?: number;
  right?: number;
  lsi?: number;
  involved?: 'L' | 'P';
  note?: string;
}

export interface Injury {
  id: string;
  name: string;
  date: ISODate;
  side?: string;
  /** „przewlekły” — stan stabilny na stałe (np. zwyrodnienie), bez ciągłego alertu. */
  status: 'aktywny' | 'w rehabilitacji' | 'przewlekły' | 'wyleczony';
  returnDate?: ISODate;
  note?: string;
}

/** Dane biegowe do stref: tętno maks. i czas na 5 km (np. „25:00”). */
export interface RunProfile {
  hrMax?: number;
  t5k?: string;
}

export interface Client {
  id: string;
  /** Bieganie: strefy tętna i tempa liczone z tych danych. */
  run?: RunProfile;
  /** Domyślne miejsce treningów (studio, klub…). */
  locationId?: string;
  name: string;
  phone?: string;
  email?: string;
  goal?: string;
  level?: string;
  status: ClientStatus;
  dob?: ISODate;
  height?: number;
  sport?: string;
  position?: string;
  dominant?: DominantSide;
  experience?: string;
  daysPerWeek?: number;
  targetDate?: ISODate;
  billing?: Billing;
  singleRate?: number;
  /** Stawka za sesję w parze / grupie (zł) — domyślna kwota, gdy trening jest z partnerem. */
  pairRate?: number;
  subRate?: number;
  pkgSize?: number;
  pkgPrice?: number;
  startDate?: ISODate;
  injuries?: string;
  notes?: string;
  createdAt?: string;
  payments: Payment[];
  measurements: Measurement[];
  tests: TestResult[];
  injuryLog: Injury[];
  checkins: Checkin[];
  /** Zadania dzienne ustawione przez trenera (np. „10 000 kroków”, „mobilność bioder”). */
  habits?: Habit[];
  /** Odhaczone zadania dzień po dniu (zapisuje podopieczny). */
  habitLog?: HabitDay[];
  /** Notatki od podopiecznego do trenera (wysyłane też e-mailem). */
  inbox?: ClientNote[];
  /** Ankieta podopiecznego (zdrowie, styl życia, odżywianie, sport, cele) — wypełnia on sam. */
  intake?: import('./lib/intake').Intake;
  /** Pomiary wpisane przez podopiecznego (zapis przez funkcję w bazie). */
  selfMeasurements?: Measurement[];
  /** Wizyty (nieobecność / późne odwołanie) pobrane z pakietu — id wizyt. */
  noShowCharges?: string[];
  /** Odpowiedzi trenera (wątek z wiadomościami podopiecznego). */
  replies?: CoachReply[];
}

/** Kiedy zadanie obowiązuje: codziennie, w wybrane dni tygodnia (1 = pn … 7 = nd) albo dni miesiąca (1–31). */
export type HabitSchedule = { kind: 'daily' } | { kind: 'week'; days: number[] } | { kind: 'month'; days: number[] };

export interface Habit {
  id: string;
  title: string;
  schedule: HabitSchedule;
  /** Od kiedy obowiązuje (wcześniejsze dni nie liczą się do statystyk). */
  since?: ISODate;
  archived?: boolean;
  /** Od kiedy usunięte — wcześniejsze dni dalej liczą się w statystykach. */
  archivedAt?: ISODate;
}

export interface HabitDay {
  date: ISODate;
  /** Id odhaczonych zadań. */
  done: string[];
}

export interface ClientNote {
  id: string;
  /** Data i godzina (ISO). */
  at: string;
  text: string;
  /** Trener przeczytał. */
  read?: boolean;
  /** Dotyczy treningu (np. notatka z podsumowania). */
  sessionId?: string;
  /** Trener usunął z rozmowy (ukryte u obu stron). */
  hidden?: boolean;
}

/** Odpowiedź trenera na wiadomości podopiecznego (widoczna u podopiecznego). */
export interface CoachReply {
  id: string;
  at: string;
  text: string;
}

/* ---------- Plany ---------- */

export const SET_TYPES = ['Rozgrzewka', 'Top set', 'Robocze', 'Back-off', 'Drop set', 'AMRAP', 'Schłodzenie', 'Przerwa'] as const;
export type SetType = (typeof SET_TYPES)[number];

/**
 * Jeden wiersz planu. `sets` domyślnie 1 (każda seria osobno); po scaleniu
 * (`mergeGroups`) może oznaczać liczbę identycznych serii.
 * `reps`, `load`, `rpe` to teksty z formularza: load może być „100”, „75%”, „-10%” lub pusty.
 */
export interface SetGroup {
  type: SetType;
  sets?: string;
  reps: string;
  load: string;
  rpe: string;
  rest?: string;
  /** Cardio / bieg: cel intensywności — strefa („Z2”, „OWB1”, „BC3”) albo tempo („5:30”, „5:20–5:40”). */
  pace?: string;
}

export interface PlanExercise {
  id: string;
  name: string;
  /** Połączone z poprzednim ćwiczeniem w blok (superseria / obwód): A1, A2, A3 i dopiero przerwa. */
  linked?: boolean;
  rest?: string;
  /** Uwagi, w tym tempo, np. „3-1-X-0”. */
  notes?: string;
  /** Ćwiczenie jednostronne: powtórzenia liczone na każdą stronę (rękę/nogę). */
  perSide?: boolean;
  /** Cardio: w seriach „powt.” = czas (min), „ciężar” = dystans (km). */
  cardio?: boolean;
  groups: SetGroup[];
}

export interface PlanWorkout {
  id: string;
  name: string;
  /** Trening dodatkowy zadany na konkretny dzień (podopieczny widzi go „na dziś / jutro”). */
  date?: ISODate;
  /** Kiedy zadano na ten dzień — trening zrobiony od tego dnia (także wcześniej niż termin) liczy się jako wykonany. */
  assignedAt?: ISODate;
  exercises: PlanExercise[];
}

export interface PlanWeek {
  id: string;
  name: string;
  workouts: PlanWorkout[];
}

export interface Plan {
  id: string;
  clientId: string;
  name: string;
  startDate?: ISODate;
  active: boolean;
  /** Dodatkowe treningi poza planem (osobna lista jednostek; nie wchodzi w kolejność planu). */
  extra?: boolean;
  notes?: string;
  updatedAt?: string;
  weeks: PlanWeek[];
}

/* ---------- Treningi (wykonane sesje) ---------- */

export interface SetLog {
  load?: number;
  reps?: number;
  rpe?: number;
  warmup?: boolean;
  done?: boolean;
  label?: string;
  /** Kompleks, np. „2+1” (reps to suma) — nie liczy się do e1RM. */
  complex?: string;
  /** Nagranie serii: „sb:<ścieżka w Storage>” albo „idb:<id>” (nagranie na tym urządzeniu). */
  video?: string;
  /** Seria na czas: `reps` to sekundy albo minuty (np. deska 30 s). */
  unit?: 's' | 'min';
  /** Ćwiczenie na stronę z różnym wynikiem: `reps` = lewa, `repsR` = prawa. */
  repsR?: number;
  /** Cardio: dystans (km) i średnie tętno (ud./min). */
  dist?: number;
  hr?: number;
}

export interface SessionExercise {
  name: string;
  /** Oznaczenie w planie, np. „A” albo „B2” (blok). */
  label?: string;
  /** Podsumowanie (zapis trenera): serie, powtórzenia, ciężar, RPE jako tekst z formularza. */
  sets?: string;
  reps?: string;
  load?: string;
  rpe?: string;
  rest?: string;
  notes?: string;
  /** Serie zapisane pojedynczo (tryb zawodnika). */
  setsLog?: SetLog[];
  /** Powtórzenia na każdą stronę (ćwiczenie jednostronne). */
  perSide?: boolean;
  /** Cardio: odcinki z czasem, dystansem i tętnem. */
  cardio?: boolean;
}

export interface TrainingSession {
  id: string;
  /** Płatność za sesję pojedynczą utworzona przy zapisie tego treningu. */
  paymentId?: string;
  locationId?: string;
  /** Stawka klubu w chwili zapisu (charge = „klub”) — późniejsza zmiana stawki nie przelicza historii. */
  clubRate?: number;
  clientId: string;
  date: ISODate;
  workoutName?: string;
  charge: Billing;
  /** Czas trwania w minutach. */
  duration?: number;
  /** sRPE 0–10. */
  srpe?: number;
  /** Ból 0–10. */
  pain?: number;
  notes?: string;
  wellness?: Wellness;
  sleepH?: number;
  rhr?: number;
  planId?: string;
  /** Id jednostki (PlanWorkout) z planu. */
  workoutId?: string;
  exercises: SessionExercise[];
  /** Kiedy zapisano (kolejność kilku treningów jednego dnia). */
  createdAt?: string;
  /** Zrobiony samodzielnie (tryb zawodnika), nie z trenerem. */
  solo?: boolean;
  /** Trener obejrzał trening/nagrania (ISO). */
  reviewedAt?: string;
  /** Komentarz trenera widoczny dla podopiecznego. */
  coachNote?: string;
  /** Trening w parze / grupie: z kim (id podopiecznych). */
  withIds?: string[];
}

/* ---------- Kalendarz ---------- */

export type AppointmentStatus = 'planned' | 'done' | 'cancel' | 'noshow';

export interface Appointment {
  id: string;
  clientId: string;
  date: ISODate;
  time: string;
  /** Minuty, domyślnie 60. */
  duration?: number;
  /** Miejsce z listy miejsc; `location` zostaje jako opis (np. sala). */
  locationId?: string;
  location?: string;
  note?: string;
  status: AppointmentStatus;
  sessionId?: string;
  seriesId?: string;
  /** Trening w parze / małej grupie: wizyty z tym samym `groupId` i datą to jeden termin (każdy ma swój status i rozliczenie). */
  groupId?: string;
}

/* ---------- Biblioteka ćwiczeń ---------- */

export const EXERCISE_CATEGORIES = [
  'Dół ciała',
  'Góra – pchanie',
  'Góra – przyciąganie',
  'Core',
  'Dwubój',
  'Plyometria',
  'Kondycja',
  'Mobilność i rehab',
] as const;
export type ExerciseCategory = (typeof EXERCISE_CATEGORIES)[number];

export interface LibraryExercise {
  id: string;
  name: string;
  cat: ExerciseCategory;
  video?: string;
}

/* ---------- Miejsca treningów i kluby ---------- */

export interface ClubPayout {
  id: string;
  /** Miesiąc, za który klub wypłacił. */
  month: YearMonth;
  amount: number;
  sessions: number;
  paidDate: ISODate;
  note?: string;
}

export interface Location {
  id: string;
  name: string;
  /** `własne` — klienci płacą trenerowi; `klub` — klub fitness, może wypłacać za treningi. */
  kind: 'własne' | 'klub';
  /** Kolor oznaczenia (odcień 0–360). */
  hue: number;
  address?: string;
  /** Stawka, którą klub wypłaca trenerowi za jeden trening (zł). */
  clubRate?: number;
  payouts: ClubPayout[];
}

/* ---------- Dane tylko dla trenera (osobna tabela, podopieczny ich nie widzi) ---------- */

/** Wywiad zdrowotny: PAR-Q, choroby, leki, zgoda lekarza, przeciwwskazania. */
export interface HealthIntake {
  /** Odpowiedzi PAR-Q (klucz pytania → tak/nie). */
  parq?: Record<string, boolean>;
  conditions?: string;
  meds?: string;
  /** Ciśnienie spoczynkowe, np. „135/85”. */
  bp?: string;
  /** Zgoda / zalecenia lekarza lub fizjoterapeuty. */
  clearanceBy?: string;
  clearanceDate?: ISODate;
  restrictions?: string;
  /** Czego unikać na treningu (widoczne dla trenera przy prowadzeniu treningu). */
  contraindications?: string;
  /** Kiedy wypełniony / zaktualizowany wywiad. */
  updated?: ISODate;
}

/** Notatka z wizyty (prywatna, np. w formacie S/O/A/P). */
export interface ClinicalNote {
  id: string;
  date: ISODate;
  text: string;
}

export interface TrainerNotes {
  /** = id podopiecznego. */
  id: string;
  clientId: string;
  health?: HealthIntake;
  /** Prywatne notatki trenera. */
  notes?: string;
  visits?: ClinicalNote[];
}
