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

/** „inna” — dowolna pozycja z własną nazwą (np. plan dietetyczny, konsultacja online). */
export type PaymentType = 'pakiet' | 'abonament' | 'pojedyncza' | 'inna';

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
  /** Tętno progowe (LTHR) z testu, np. 30 min biegu — ostatnie 20 min średnio. Strefy liczone od niego (Friel). */
  lthr?: number;
}

/** Cotygodniowy raport podopiecznego (wysyła on sam, np. w niedzielę). */
export interface WeeklyReport {
  id: string;
  /** Poniedziałek tygodnia, którego dotyczy raport. */
  week: ISODate;
  /** Kiedy wysłany (ISO). */
  at: string;
  weight?: number;
  /** 1–5: sen, stres (5 = spokój), energia, trzymanie planu / diety. */
  sleep?: number;
  stress?: number;
  energy?: number;
  adherence?: number;
  /** Średnio kroków dziennie. */
  steps?: number;
  comment?: string;
  /** Zdjęcia sylwetki dołączone do raportu — id z `progressPhotos`. */
  photoIds?: string[];
  /** Trener: przeczytany / odpowiedź. */
  seenAt?: string;
  coachNote?: string;
}

/** Zdjęcie sylwetki (plik w magazynie: „sb:…” albo „idb:…”). */
export interface ProgressPhoto {
  id: string;
  date: ISODate;
  ref: string;
  pose: 'przód' | 'bok' | 'tył' | 'inne';
  at: string;
  hidden?: boolean;
}

/** Dzienny zapis makro i kroków (podopieczny). */
export interface DayLog {
  date: ISODate;
  protein?: number;
  kcal?: number;
  steps?: number;
  /** Woda w litrach. */
  water?: number;
  /** Tłuszcze (g) — wpis z aplikacji do liczenia kalorii (np. Fitatu). */
  fat?: number;
  /** Węglowodany (g). */
  carbs?: number;
  /** Zrzut ekranu z aplikacji do liczenia kalorii: odnośnik do pliku („sb:…” / „idb:…”, jak zdjęcia sylwetki). */
  shot?: string;
}

/** Cele dzienne ustawione przez trenera. */
export interface DayTargets {
  protein?: number;
  kcal?: number;
  steps?: number;
  water?: number;
  /** Tłuszcze (g). */
  fat?: number;
  /** Węglowodany (g). */
  carbs?: number;
}

/** Miejsce bólu zaznaczone na sylwetce (przy treningu). */
export interface PainSpot {
  /** Obszar ciała z listy w lib/painMap (np. „kolano”, „odcinek lędźwiowy”). */
  area: string;
  side?: 'L' | 'P';
  /** 0–10 */
  level: number;
}

/** Trener prowadzi teraz trening tego podopiecznego na swoim telefonie (żeby podopieczny nie zaczął drugiego zapisu). */
export interface LiveMark {
  at: string;
  name: string;
  workoutId?: string;
}

export interface Client {
  /** Znacznik treningu na żywo prowadzonego przez trenera (pole trenera). */
  liveBy?: LiveMark;
  /** Podopieczny trenuje teraz u siebie (pole podopiecznego, zapis przez funkcję set_athlete_live). */
  athleteLive?: LiveMark;
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
  /** Znacznik ostatniej automatycznej wiadomości (ustawia baza, sekcja 25) — chroni ją przed zapisem z nieaktualnej kopii. */
  autoMsgRev?: string;
  /** Raporty tygodniowe (zapisuje podopieczny przez funkcję w bazie). */
  weeklyReports?: WeeklyReport[];
  /** Zdjęcia sylwetki w czasie (zapisuje podopieczny przez funkcję w bazie). */
  progressPhotos?: ProgressPhoto[];
  /** Makro i kroki dzień po dniu (zapisuje podopieczny przez funkcję w bazie). */
  dayLog?: DayLog[];
  /** Cele dzienne: białko, kcal, kroki, woda (ustawia trener). */
  targets?: DayTargets;
  /** Trener wymaga raportu tygodniowego (pt–pn karta u podopiecznego). Brak — tylko gdy są już raporty. */
  weeklyReport?: boolean;
  /** RODO: zgody podopiecznego (dane o zdrowiu, zdjęcia/nagrania) i prośba o usunięcie konta — zapisuje tylko on sam (lib/rodo.ts). */
  consents?: ConsentEntry[];
  /** Trener: kiedy wysłał zaproszenie do aplikacji (ISO; lib/onboarding.ts). */
  invitedAt?: string;
  /** Trener ukrył checklistę „Pierwsze kroki” w Przeglądzie. */
  onboardingHidden?: boolean;
  /** Trener: klucze elementów kolejki „Do przejrzenia” oznaczonych jako przejrzane (lib/reviewQueue.ts; zwykły zapis trenera). */
  reviewed?: string[];
  /** Zgłoszone nieobecności (urlop, choroba…) — zapisuje podopieczny (save_client_entry, sekcja 26; lib/absence.ts). */
  absences?: Absence[];
  /** Prywatne notatki podopiecznego do ćwiczeń („siedzisko na 4”) — klucz `id` = znormalizowana nazwa ćwiczenia (sekcja 26). */
  exNotes?: ExNote[];
  /** Powrót po przerwie (ustawia trener): od ilu dni bez treningu i o ile % lżej pierwszy trening (lib/comeback.ts). */
  comeback?: ComebackRule;
}

export type AbsenceReason = 'urlop' | 'choroba' | 'kontuzja' | 'inne';
/** Nieobecność podopiecznego: od–do (włącznie). `to` < `from` = odwołana („Wracam wcześniej” w dniu startu). */
export interface Absence {
  id: string;
  from: ISODate;
  to: ISODate;
  reason: AbsenceReason;
  note?: string;
  /** Kiedy zgłoszona (ISO). */
  at: string;
}

/** Notatka podopiecznego do ćwiczenia (wraca przy każdym treningu z tym ćwiczeniem). */
export interface ExNote {
  /** Znormalizowana nazwa ćwiczenia (`exNoteKey` w lib/exNotes.ts, najwyżej 64 znaki). */
  id: string;
  /** Nazwa ćwiczenia, jak ją widział podopieczny. */
  name: string;
  text: string;
  at: string;
}

/** Powrót po przerwie: `days` — od ilu dni bez treningu, `pct` — o ile % lżejsze podpowiedzi ciężaru; `off` — wyłączone. */
export interface ComebackRule {
  days: number;
  pct: number;
  off?: boolean;
}

/** Zgoda RODO: `health` — dane o zdrowiu (art. 9), `media` — zdjęcia sylwetki i nagrania techniki; `erasure` — prośba o usunięcie konta. */
export type ConsentKind = 'health' | 'media';
export interface ConsentEntry {
  id: ConsentKind | 'erasure';
  /** Udzielona (prośba wysłana) / wycofana. */
  on: boolean;
  /** Ostatnia zmiana (ISO; w chmurze ustawia baza). */
  at: string;
  /** Kiedy ostatnio udzielona / wycofana. */
  givenAt?: string;
  withdrawnAt?: string;
  /** Wersja klauzuli informacyjnej, którą podopieczny widział. */
  v?: number;
  /** Historia zmian (najwyżej 20 ostatnich). */
  log?: { on: boolean; at: string }[];
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
  /** Przypięta do treningu / ćwiczenia (komentarz z odtwarzacza albo historii). */
  ref?: MsgRef;
  /** Zdjęcie, wideo albo wiadomość głosowa (pliki w magazynie podopiecznego). */
  media?: MsgMedia[];
  /** Tekst wstawiony automatycznie (np. „Wiadomość głosowa”) — w dymku nie jest pokazywany. */
  textAuto?: boolean;
}

/** Odpowiedź trenera na wiadomości podopiecznego (widoczna u podopiecznego). */
export interface CoachReply {
  id: string;
  at: string;
  text: string;
  ref?: MsgRef;
  media?: MsgMedia[];
  textAuto?: boolean;
  /** Odpowiedź na konkretną wiadomość (np. z nagraniem techniki — znaczniki czasu przewijają to wideo). */
  replyTo?: string;  /** Wiadomość automatyczna (reguła z „Automatyczne wiadomości”, lib/autoMessages.ts) — oznaczenie widzi tylko trener. */
  auto?: import('./lib/autoMessages').AutoKind;
}

/** Kontekst wiadomości: trening (sesja) i ewentualnie ćwiczenie. */
export interface MsgRef {
  sessionId?: string;
  /** Indeks ćwiczenia w treningu. */
  exIndex?: number;
  /** Nazwa ćwiczenia (zostaje, nawet gdy trening zostanie zmieniony). */
  exName?: string;
  /** Nazwa treningu, np. „Trening 1”. */
  workout?: string;
  date?: ISODate;
}

export interface MsgMedia {
  kind: 'image' | 'video' | 'audio';
  /** „sb:<ścieżka>” (Supabase Storage) albo „idb:<id>” (ta przeglądarka). */
  ref: string;
  mime?: string;
  /** Sekundy (wideo, głos). */
  dur?: number;
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
  /** Hantle / kettle: ciężar wpisywany za 1 hantel („one”) albo suma obu („sum”). Brak — domyślnie z nazwy (hantle → 1 hantel). */
  loadPer?: 'one' | 'sum';
  /** Ćwiczenie na czas (deska, wall sit, zwis): w seriach zamiast powtórzeń czas (s, m:ss, „2 min”). */
  timed?: boolean;
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
  /** Plan: dzień tygodnia tej jednostki (1 = pon … 7 = niedz.); data liczona od startu planu i numeru tygodnia. */
  day?: number;
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
  /** Szablon planu (zapisany z `clientId: '__template__'`) — nie jest planem żadnego podopiecznego. */
  template?: boolean;
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
  /** Hantle / kettle: ciężar wpisywany za 1 hantel („one”) albo suma obu („sum”). Brak — domyślnie z nazwy (hantle → 1 hantel). */
  loadPer?: 'one' | 'sum';
  /** Serie na czas (sekundy). */
  timed?: boolean;
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
  /** Gdzie bolało (mapa ciała) — szczegóły do `pain`. */
  painMap?: PainSpot[];
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
  /** Trening przerwany z powodu bólu w odtwarzaczu („Przerwij, bo boli”) — zapis częściowy, trener dostał wiadomość. */
  stoppedForPain?: { level: number; spots?: PainSpot[]; exName?: string; exIndex?: number };
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
  /**
   * Odpowiedź podopiecznego z aplikacji: potwierdzenie albo odwołanie (z powodem). Przy odwołaniu `status` = 'cancel';
   * `late` — odwołanie krócej niż 24 h przed wizytą (trening może przepaść). Zapis przez funkcję client_respond_appointment.
   */
  reply?: ApptReply;
}

export interface ApptReply {
  kind: 'confirm' | 'cancel';
  /** Kiedy (ISO). */
  at: string;
  reason?: string;
  late?: boolean;
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
