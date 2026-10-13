import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Checkin } from '../domain';
import { applyChanges, type Change, type Db, type Repository } from './db';
import { createEmpty, createSeed } from './seed';

interface AskState {
  message: string;
  confirm: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

interface StoreValue {
  db: Db;
  apply: (changes: Change[], message?: string) => Promise<void>;
  toast: (message: string) => void;
  /** Własny dialog potwierdzenia (window.confirm bywa blokowany). */
  ask: (message: string, opts?: { confirm?: string; danger?: boolean }) => Promise<boolean>;
  reset: (mode: 'seed' | 'empty') => Promise<void>;
  importDb: (db: Db) => Promise<void>;
  saveCheckin: (clientId: string, checkin: Checkin) => Promise<void>;
  /** true — dane w chmurze (Supabase), false — tylko w tej przeglądarce. */
  cloud: boolean;
  signOut?: () => void;
}

const Ctx = createContext<StoreValue | null>(null);

export function StoreProvider({
  children,
  repo,
  cloud = false,
  signOut,
  onEmpty,
}: {
  children: ReactNode;
  repo: Repository;
  cloud?: boolean;
  signOut?: () => void;
  /** Wywoływane, gdy baza trenera jest pusta (pierwsze uruchomienie w chmurze). */
  onEmpty?: (db: Db) => Db | null;
}) {
  const [db, setDb] = useState<Db | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const [askState, setAsk] = useState<AskState | null>(null);
  const toastId = useRef(0);

  const load = useCallback(async () => {
    try {
      let next = await repo.load();
      const seeded = onEmpty?.(next);
      if (seeded) {
        await repo.replaceAll(seeded);
        next = seeded;
      }
      setDb(next);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [repo, onEmpty]);

  useEffect(() => {
    void load();
  }, [load]);

  // Po powrocie do aplikacji (inne urządzenie mogło coś zmienić) — odśwież dane z chmury.
  useEffect(() => {
    if (!cloud) return;
    const onVis = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [cloud, load]);

  const toast = useCallback((text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const apply = useCallback(
    async (changes: Change[], message?: string) => {
      setDb((cur) => (cur ? applyChanges(cur, changes) : cur));
      try {
        await repo.apply(changes);
        if (message) toast(message);
      } catch {
        toast('Nie udało się zapisać — sprawdź połączenie z internetem i spróbuj ponownie.');
        void load();
      }
    },
    [toast, repo, load],
  );

  const saveCheckin = useCallback(
    async (clientId: string, checkin: Checkin) => {
      setDb((cur) =>
        cur
          ? { ...cur, clients: cur.clients.map((c) => (c.id === clientId ? { ...c, checkins: [...c.checkins.filter((x) => x.date !== checkin.date), checkin] } : c)) }
          : cur,
      );
      try {
        await repo.saveCheckin(clientId, checkin);
        toast('Dzięki! Zapisano samopoczucie.');
      } catch {
        toast('Nie udało się zapisać samopoczucia — sprawdź połączenie.');
        void load();
      }
    },
    [repo, toast, load],
  );

  const ask = useCallback(
    (message: string, opts: { confirm?: string; danger?: boolean } = {}) =>
      new Promise<boolean>((resolve) =>
        setAsk({ message, confirm: opts.confirm ?? 'Usuń', danger: opts.danger ?? true, resolve }),
      ),
    [],
  );

  const reset = useCallback(
    async (mode: 'seed' | 'empty') => {
      const next = mode === 'seed' ? createSeed() : createEmpty();
      await repo.replaceAll(next);
      setDb(next);
      toast(mode === 'seed' ? 'Wczytano dane przykładowe.' : 'Wyczyszczono dane.');
    },
    [toast, repo],
  );

  const importDb = useCallback(
    async (next: Db) => {
      await repo.replaceAll(next);
      setDb(next);
      toast('Zaimportowano dane.');
    },
    [toast, repo],
  );

  const value = useMemo(
    () => (db ? { db, apply, toast, ask, reset, importDb, saveCheckin, cloud, signOut } : null),
    [db, apply, toast, ask, reset, importDb, saveCheckin, cloud, signOut],
  );
  if (loadError)
    return (
      <div className="center-screen">
        <div className="card auth-card">
          <h2>Brak połączenia</h2>
          <p className="muted">Nie udało się wczytać danych. Sprawdź internet i spróbuj ponownie.</p>
          <p className="muted small">{loadError}</p>
          <div className="actions">
            <button className="btn btn-primary" onClick={() => void load()}>
              Spróbuj ponownie
            </button>
            {signOut && (
              <button className="btn btn-ghost" onClick={signOut}>
                Wyloguj
              </button>
            )}
          </div>
        </div>
      </div>
    );
  if (!value) return <div className="center-screen muted">Wczytywanie…</div>;

  const close = (ok: boolean) => {
    askState?.resolve(ok);
    setAsk(null);
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.text}
          </div>
        ))}
      </div>
      {askState && (
        <div className="modal-backdrop ask-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
          <div className="card modal modal-sm" role="alertdialog" aria-modal="true">
            <p className="ask-text">{askState.message}</p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => close(false)}>
                Anuluj
              </button>
              <button className={askState.danger ? 'btn btn-danger' : 'btn btn-primary'} autoFocus onClick={() => close(true)}>
                {askState.confirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore poza StoreProvider');
  return v;
}
