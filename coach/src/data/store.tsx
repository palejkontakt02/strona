import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { applyChanges, type Change, type Db } from './db';
import { createLocalRepository } from './localRepository';
import { createEmpty, createSeed } from './seed';

const repo = createLocalRepository();

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
}

const Ctx = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Db | null>(null);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const [askState, setAsk] = useState<AskState | null>(null);
  const toastId = useRef(0);

  useEffect(() => {
    void repo.load().then(setDb);
  }, []);

  const toast = useCallback((text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const apply = useCallback(
    async (changes: Change[], message?: string) => {
      setDb((cur) => (cur ? applyChanges(cur, changes) : cur));
      await repo.apply(changes);
      if (message) toast(message);
    },
    [toast],
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
    [toast],
  );

  const importDb = useCallback(
    async (next: Db) => {
      await repo.replaceAll(next);
      setDb(next);
      toast('Zaimportowano dane.');
    },
    [toast],
  );

  const value = useMemo(() => (db ? { db, apply, toast, ask, reset, importDb } : null), [db, apply, toast, ask, reset, importDb]);
  if (!value) return null;

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
