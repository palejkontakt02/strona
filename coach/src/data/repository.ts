import type { Client, Exercise, Measurement, Payment, PaymentStatus, Session, SessionStatus } from '../types';

export type NewClient = Pick<Client, 'name' | 'email' | 'goal'>;

/**
 * Warstwa danych aplikacji. Interfejs jest asynchroniczny, żeby można było
 * podmienić implementację localStorage na backend (np. Supabase) bez zmian w UI.
 */
export interface CoachRepository {
  loadClients(): Promise<Client[]>;
  addClient(input: NewClient): Promise<Client>;
  addMeasurement(clientId: string, m: Omit<Measurement, 'id'>): Promise<Measurement>;
  addExercise(clientId: string, dayId: string, e: Omit<Exercise, 'id' | 'done'>): Promise<Exercise>;
  setExerciseDone(clientId: string, dayId: string, exerciseId: string, done: boolean): Promise<void>;
  addSession(clientId: string, s: Omit<Session, 'id' | 'status'>): Promise<Session>;
  setSessionStatus(clientId: string, sessionId: string, status: SessionStatus): Promise<void>;
  addPayment(clientId: string, p: Omit<Payment, 'id' | 'status'>): Promise<Payment>;
  setPaymentStatus(clientId: string, paymentId: string, status: PaymentStatus): Promise<void>;
  resetToSeed(): Promise<Client[]>;
}
