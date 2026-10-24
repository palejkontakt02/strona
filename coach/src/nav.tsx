import type { RunStart } from './athlete/start';
import { createContext, useContext } from 'react';
import type { Appointment, Client, LibraryExercise, Location, Measurement, Payment, PaymentType, Plan, TrainingSession } from './domain';

export const SECTIONS = ['Pulpit', 'Kalendarz', 'Klienci', 'Płatności', 'Ćwiczenia'] as const;
export type Section = (typeof SECTIONS)[number];

export const CLIENT_TABS = ['Przegląd', 'Plan', 'Treningi', 'Monitoring', 'Pomiary i testy', 'Płatności', 'Profil'] as const;
export type ClientTab = (typeof CLIENT_TABS)[number];

export type ModalState =
  | { kind: 'appt'; appt?: Appointment; date?: string; time?: string; clientId?: string }
  | { kind: 'session'; session?: TrainingSession; clientId?: string; appt?: Appointment; date?: string; /** Otwórz od razu z polem „Wklej z notatki”. */ paste?: boolean }
  | { kind: 'client'; client?: Client }
  | { kind: 'measurement'; clientId: string; /** Edycja pomiaru trenera (pomiaru podopiecznego trener nie zmienia — może go tylko ukryć). */ measurement?: Measurement }
  | { kind: 'test'; clientId: string; name?: string }
  | { kind: 'payment'; clientId?: string; type: PaymentType; payment?: Payment }
  | { kind: 'injury'; clientId: string; injury?: Client['injuryLog'][number] }
  | { kind: 'exercise'; exercise?: LibraryExercise }
  | { kind: 'plan'; plan: Plan; isNew?: boolean; /** Rozwiń tydzień z tą jednostką. */ focusWorkoutId?: string }
  | { kind: 'review'; sessionId: string }
  /** Trening poza planem na wybrany dzień (albo bez terminu). */
  | { kind: 'assign'; clientId?: string; date?: string; /** Powtórka / kopia wykonanego treningu (także innego podopiecznego). */ sessionId?: string }
  | { kind: 'data' }
  | { kind: 'locations' }
  | { kind: 'location'; location?: Location };

export interface NavValue {
  section: Section;
  go: (s: Section) => void;
  clientId: string | null;
  clientTab: ClientTab;
  openClient: (id: string, tab?: ClientTab) => void;
  setClientTab: (t: ClientTab) => void;
  closeClient: () => void;
  openModal: (m: ModalState) => void;
  closeModal: () => void;
  /** Uruchamia tryb zawodnika dla klienta (opcjonalnie od razu z wybranym treningiem). */
  startAthlete: (clientId: string, start?: RunStart) => void;
  /** Trener prowadzi trening 1:1 na żywo (opcjonalnie z wizyty albo od razu z wybranym treningiem). */
  startLive: (clientId: string, appointmentId?: string, editSessionId?: string, start?: RunStart) => void;
}

export const NavCtx = createContext<NavValue | null>(null);

export function useNav(): NavValue {
  const v = useContext(NavCtx);
  if (!v) throw new Error('useNav poza App');
  return v;
}
