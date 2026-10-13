import type { Client } from '../types';
import { uid } from '../utils';
import type { CoachRepository } from './repository';
import { createSeed } from './seed';

const STORAGE_KEY = 'fitowa-coach:v1';

function read(): Client[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Client[]) : null;
  } catch {
    return null;
  }
}

function write(clients: Client[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clients));
  } catch {
    // Brak dostępu do localStorage (np. tryb prywatny) — dane zostają tylko w pamięci.
  }
}

export function createLocalRepository(): CoachRepository {
  let clients: Client[] = read() ?? createSeed();
  write(clients);

  const update = (clientId: string, fn: (c: Client) => Client) => {
    clients = clients.map((c) => (c.id === clientId ? fn(c) : c));
    write(clients);
  };

  return {
    async loadClients() {
      return clients;
    },

    async addClient(input) {
      const client: Client = {
        id: uid(),
        ...input,
        phone: '',
        status: 'Nowy',
        measurements: [],
        sessions: [],
        payments: [],
        plan: { name: 'Do ustalenia', days: [] },
      };
      clients = [...clients, client];
      write(clients);
      return client;
    },

    async addMeasurement(clientId, m) {
      const measurement = { id: uid(), ...m };
      update(clientId, (c) => {
        const measurements = [...c.measurements, measurement].sort((a, b) => a.date.localeCompare(b.date));
        return { ...c, measurements, currentWeight: measurements[measurements.length - 1].weight };
      });
      return measurement;
    },

    async addExercise(clientId, dayId, e) {
      const exercise = { id: uid(), ...e, done: false };
      update(clientId, (c) => ({
        ...c,
        plan: {
          ...c.plan,
          days: c.plan.days.map((d) => (d.id === dayId ? { ...d, exercises: [...d.exercises, exercise] } : d)),
        },
      }));
      return exercise;
    },

    async setExerciseDone(clientId, dayId, exerciseId, done) {
      update(clientId, (c) => ({
        ...c,
        plan: {
          ...c.plan,
          days: c.plan.days.map((d) =>
            d.id === dayId
              ? { ...d, exercises: d.exercises.map((x) => (x.id === exerciseId ? { ...x, done } : x)) }
              : d,
          ),
        },
      }));
    },

    async addSession(clientId, s) {
      const session = { id: uid(), ...s, status: 'Zaplanowana' as const };
      update(clientId, (c) => ({ ...c, sessions: [...c.sessions, session] }));
      return session;
    },

    async setSessionStatus(clientId, sessionId, status) {
      update(clientId, (c) => ({
        ...c,
        sessions: c.sessions.map((s) => (s.id === sessionId ? { ...s, status } : s)),
      }));
    },

    async addPayment(clientId, p) {
      const payment = { id: uid(), ...p, status: 'Zaległe' as const };
      update(clientId, (c) => ({ ...c, payments: [...c.payments, payment] }));
      return payment;
    },

    async setPaymentStatus(clientId, paymentId, status) {
      update(clientId, (c) => ({
        ...c,
        payments: c.payments.map((p) => (p.id === paymentId ? { ...p, status } : p)),
      }));
    },

    async resetToSeed() {
      clients = createSeed();
      write(clients);
      return clients;
    },
  };
}
