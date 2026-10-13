import { createContext, useContext } from 'react';
import type { Appointment, Client, LibraryExercise, Location, Payment, PaymentType, Plan, TrainingSession } from './domain';

export const SECTIONS = ['Pulpit', 'Kalendarz', 'Klienci', 'Płatności', 'Ćwiczenia'] as const;
export type Section = (typeof SECTIONS)[number];

export const CLIENT_TABS = ['Przegląd', 'Plan', 'Treningi', 'Monitoring', 'Pomiary i testy', 'Płatności', 'Profil'] as const;
export type ClientTab = (typeof CLIENT_TABS)[number];

export type ModalState =
  | { kind: 'appt'; appt?: Appointment; date?: string; time?: string; clientId?: string }
  | { kind: 'session'; session?: TrainingSession; clientId?: string; appt?: Appointment; date?: string }
  | { kind: 'client'; client?: Client }
  | { kind: 'measurement'; clientId: string }
  | { kind: 'test'; clientId: string; name?: string }
  | { kind: 'payment'; clientId?: string; type: PaymentType; payment?: Payment }
  | { kind: 'injury'; clientId: string; injury?: Client['injuryLog'][number] }
  | { kind: 'exercise'; exercise?: LibraryExercise }
  | { kind: 'plan'; plan: Plan; isNew?: boolean }
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
  /** Uruchamia tryb zawodnika dla klienta. */
  startAthlete: (clientId: string) => void;
  /** Trener prowadzi trening 1:1 na żywo (opcjonalnie z wizyty). */
  startLive: (clientId: string, appointmentId?: string) => void;
}

export const NavCtx = createContext<NavValue | null>(null);

export function useNav(): NavValue {
  const v = useContext(NavCtx);
  if (!v) throw new Error('useNav poza App');
  return v;
}
