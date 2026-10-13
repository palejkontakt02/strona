import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Client } from '../types';
import { createLocalRepository } from './localRepository';
import type { CoachRepository } from './repository';

const repo: CoachRepository = createLocalRepository();

/** Stan aplikacji: lista podopiecznych + akcje, które po każdej zmianie odświeżają dane z repozytorium. */
export function useCoach() {
  const [clients, setClients] = useState<Client[] | null>(null);

  const refresh = useCallback(async () => {
    setClients(await repo.loadClients());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const actions = useMemo(() => {
    const wrap =
      <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
      async (...args: A): Promise<R> => {
        const result = await fn(...args);
        await refresh();
        return result;
      };
    return {
      addClient: wrap(repo.addClient),
      addMeasurement: wrap(repo.addMeasurement),
      addExercise: wrap(repo.addExercise),
      setExerciseDone: wrap(repo.setExerciseDone),
      addSession: wrap(repo.addSession),
      setSessionStatus: wrap(repo.setSessionStatus),
      addPayment: wrap(repo.addPayment),
      setPaymentStatus: wrap(repo.setPaymentStatus),
      resetToSeed: wrap(repo.resetToSeed),
    };
  }, [refresh]);

  return { clients, actions };
}

export type CoachActions = ReturnType<typeof useCoach>['actions'];
