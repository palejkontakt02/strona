export const CLIENT_STATUSES = ['Aktywny', 'Nowy', 'Pauza'] as const;
export const GOALS = [
  'Redukcja tkanki tłuszczowej',
  'Budowa masy mięśniowej',
  'Poprawa kondycji',
  'Rehabilitacja i mobilność',
  'Przygotowanie do zawodów',
] as const;
export const SESSION_TYPES = [
  'Trening siłowy',
  'Trening funkcjonalny',
  'Cardio',
  'Konsultacja',
  'Pomiar sylwetki',
] as const;
export const SESSION_STATUSES = ['Zaplanowana', 'Odbyta', 'Odwołana'] as const;
export const PAYMENT_STATUSES = ['Opłacone', 'Zaległe'] as const;

export type ClientStatus = (typeof CLIENT_STATUSES)[number];
export type Goal = (typeof GOALS)[number];
export type SessionType = (typeof SESSION_TYPES)[number];
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Daty jako ISO „RRRR-MM-DD”, godziny jako „HH:MM” — formatowanie dopiero w UI. */
export type ISODate = string;

export interface Measurement {
  id: string;
  date: ISODate;
  weight: number;
  chest?: number;
  waist?: number;
  hips?: number;
  note?: string;
}

export interface Session {
  id: string;
  date: ISODate;
  time: string;
  type: SessionType;
  status: SessionStatus;
}

export interface Payment {
  id: string;
  date: ISODate;
  amount: number;
  description: string;
  status: PaymentStatus;
}

export interface Exercise {
  id: string;
  name: string;
  sets: string;
  reps: string;
  done: boolean;
}

export interface PlanDay {
  id: string;
  name: string;
  exercises: Exercise[];
}

export interface Plan {
  name: string;
  days: PlanDay[];
}

export interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  age?: number;
  height?: number;
  goal: Goal;
  status: ClientStatus;
  currentWeight?: number;
  targetWeight?: number;
  measurements: Measurement[];
  sessions: Session[];
  payments: Payment[];
  plan: Plan;
}
