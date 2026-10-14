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
  status: 'aktywny' | 'w rehabilitacji' | 'wyleczony';
  returnDate?: ISODate;
  note?: string;
}

export interface Client {
  id: string;
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
}

/* ---------- Plany ---------- */

export const SET_TYPES = ['Rozgrzewka', 'Top set', 'Robocze', 'Back-off', 'Drop set', 'AMRAP'] as const;
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
}

export interface PlanExercise {
  id: string;
  name: string;
  /** Połączone z poprzednim ćwiczeniem w blok (superseria / obwód): A1, A2, A3 i dopiero przerwa. */
  linked?: boolean;
  rest?: string;
  /** Uwagi, w tym tempo, np. „3-1-X-0”. */
  notes?: string;
  groups: SetGroup[];
}

export interface PlanWorkout {
  id: string;
  name: string;
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
}

export interface TrainingSession {
  id: string;
  /** Płatność za sesję pojedynczą utworzona przy zapisie tego treningu. */
  paymentId?: string;
  locationId?: string;
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
