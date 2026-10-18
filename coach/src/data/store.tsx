import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Checkin, ClientNote, Measurement } from '../domain';
import { uid } from '../format';
import { withDay } from '../lib/habits';
import { emailTrainer } from './mail';
import { useDialog } from '../components/useDialog';
import { applyChanges, type Change, type Db, type Repository } from './db';
import { createEmpty, createSeed } from './seed';

interface AskState {
  message: string;
  confirm: string;
  danger: boolean;
  cancel?: string;
  resolve: (ok: boolean) => void;
}

interface StoreValue {
  db: Db;
  apply: (changes: Change[], message?: string) => Promise<boolean>;
  /** Powiadomienie; z `action` — przycisk w powiadomieniu (np. „Cofnij”), dłużej widoczne. */
  toast: (message: string, action?: { label: string; run: () => void }) => void;
  /** Własny dialog potwierdzenia (window.confirm bywa blokowany). */
  ask: (message: string, opts?: { confirm?: string; danger?: boolean; cancel?: string }) => Promise<boolean>;
  reset: (mode: 'seed' | 'empty') => Promise<void>;
  importDb: (db: Db) => Promise<void>;
  saveCheckin: (clientId: string, checkin: Checkin) => Promise<void>;
  addMeasurement: (clientId: string, m: Measurement) => Promise<boolean>;
  saveHabitDay: (clientId: string, date: string, done: string[]) => Promise<void>;
  sendClientNote: (clientId: string, text: string, sessionId?: string) => Promise<boolean>;
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
  const [toasts, setToasts] = useState<{ id: number; text: string; action?: { label: string; run: () => void } }[]>([]);
  const [askState, setAsk] = useState<AskState | null>(null);
  const toastId = useRef(0);
  const hasDb = useRef(false);
  hasDb.current = db != null;

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
      // gdy dane już są (np. chwilowy brak sieci) — zostają na ekranie, bez ekranu błędu
      if (hasDb.current) {
        setToasts((t) => [...t, { id: ++toastId.current, text: 'Brak połączenia — pokazuję ostatnie dane.' }]);
        return;
      }
      setLoadError(e && typeof e === 'object' && 'message' in e ? [(e as { code?: string }).code, (e as { message: string }).message].filter(Boolean).join(' · ') : String(e));
    }
  }, [repo, onEmpty]);

  useEffect(() => {
    void load();
  }, [load]);

  // Tryb lokalny: zmiana zapisana w innej karcie tej przeglądarki — wczytaj ją tutaj.
  useEffect(() => {
    if (cloud) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'panel-trenera:v1') void load();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [cloud, load]);

  // Po powrocie do aplikacji (inne urządzenie mogło coś zmienić) — odśwież dane z chmury.
  useEffect(() => {
    if (!cloud) return;
    const onVis = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [cloud, load]);

  const toast = useCallback((text: string, action?: { label: string; run: () => void }) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-1), { id, text, action }]); // najwyżej dwa naraz
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 9000 : Math.min(8000, 2600 + text.length * 45));
  }, []);

  /** Zapis zmian; zwraca false, gdy się nie udał (wtedy np. trening zostaje do ponownego zapisu). */
  const apply = useCallback(
    async (changes: Change[], message?: string): Promise<boolean> => {
      let before: Db | null = null;
      setDb((cur) => {
        before = cur;
        return cur ? applyChanges(cur, changes) : cur;
      });
      try {
        await repo.apply(changes);
        if (message) toast(message);
        return true;
      } catch {
        toast('Nie udało się zapisać — sprawdź połączenie z internetem i spróbuj ponownie.');
        // cofamy podgląd zmiany, żeby ponowny zapis nie zdublował treningu
        if (before) setDb(before);
        if (typeof navigator === 'undefined' || navigator.onLine) void load();
        return false;
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

  /** Pomiar od podopiecznego (waga, obwody) — osobna lista, zapis przez funkcję w bazie. */
  const addMeasurement = useCallback(
    async (clientId: string, m: Measurement) => {
      const item: Measurement = { ...m, by: 'client' };
      setDb((cur) => (cur ? { ...cur, clients: cur.clients.map((c) => (c.id === clientId ? { ...c, selfMeasurements: [...(c.selfMeasurements ?? []), item] } : c)) } : cur));
      try {
        await repo.addMeasurement(clientId, item);
        toast('Pomiar zapisany — trener go zobaczy.');
        return true;
      } catch {
        toast('Nie udało się zapisać pomiaru — sprawdź połączenie.');
        void load();
        return false;
      }
    },
    [repo, toast, load],
  );

  // odhaczenia zapisywane po kolei — szybkie stuknięcia nie wyprzedzają się w sieci
  const habitQueue = useRef<Promise<unknown>>(Promise.resolve());
  const saveHabitDay = useCallback(
    async (clientId: string, date: string, done: string[]) => {
      setDb((cur) => (cur ? { ...cur, clients: cur.clients.map((c) => (c.id === clientId ? { ...c, habitLog: withDay(c.habitLog, date, done) } : c)) } : cur));
      const job = habitQueue.current.then(() => repo.saveHabitDay(clientId, date, done));
      habitQueue.current = job.catch(() => undefined);
      try {
        await job;
      } catch {
        toast('Nie udało się zapisać — sprawdź połączenie.');
        void load();
      }
    },
    [repo, toast, load],
  );

  /** Notatka od podopiecznego: zapis w aplikacji + e-mail do trenera. */
  const sendClientNote = useCallback(
    async (clientId: string, text: string, sessionId?: string): Promise<boolean> => {
      const note: ClientNote = { id: uid(), at: new Date().toISOString(), text: text.trim().slice(0, 2000), ...(sessionId ? { sessionId } : {}) };
      const client = db?.clients.find((c) => c.id === clientId);
      setDb((cur) => (cur ? { ...cur, clients: cur.clients.map((c) => (c.id === clientId ? { ...c, inbox: [...(c.inbox ?? []), note] } : c)) } : cur));
      let saved = true;
      try {
        await repo.addClientNote(clientId, note);
      } catch {
        saved = false;
        // nie zapisało się w bazie — nie udajemy, że jest w aplikacji
        setDb((cur) => (cur ? { ...cur, clients: cur.clients.map((c) => (c.id === clientId ? { ...c, inbox: (c.inbox ?? []).filter((n) => n.id !== note.id) } : c)) } : cur));
      }
      const mail = await emailTrainer(client?.name ?? 'Podopieczny', client?.email, note.text);
      if (!saved && mail !== 'sent') {
        toast('Nie udało się wysłać — sprawdź połączenie i spróbuj ponownie.');
        return false;
      }
      toast(saved && mail !== 'failed' ? 'Wysłano do trenera.' : saved ? 'Zapisano w aplikacji (e-mail nie wyszedł — trener zobaczy wiadomość w panelu).' : 'Wysłano e-mailem do trenera.');
      return true;
    },
    [db, repo, toast, load],
  );

  const ask = useCallback(
    (message: string, opts: { confirm?: string; danger?: boolean; cancel?: string } = {}) =>
      new Promise<boolean>((resolve) =>
        setAsk({ message, confirm: opts.confirm ?? 'Usuń', danger: opts.danger ?? true, cancel: opts.cancel, resolve }),
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
    () => (db ? { db, apply, toast, ask, reset, importDb, saveCheckin, addMeasurement, saveHabitDay, sendClientNote, cloud, signOut } : null),
    [db, apply, toast, ask, reset, importDb, saveCheckin, addMeasurement, saveHabitDay, sendClientNote, cloud, signOut],
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
          <div key={t.id} className={`toast ${t.action ? 'toast-action' : ''}`}>
            <span>{t.text}</span>
            {t.action && (
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => {
                  t.action!.run();
                  setToasts((x) => x.filter((y) => y.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
      {askState && <AskDialog state={askState} onClose={close} />}
    </Ctx.Provider>
  );
}

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore poza StoreProvider');
  return v;
}

/** Okno potwierdzenia: przy usuwaniu fokus startuje na „Anuluj”, Escape anuluje. */
function AskDialog({ state, onClose }: { state: AskState; onClose: (ok: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, () => onClose(false), state.danger ? '.ask-cancel' : '.ask-ok');
  return (
    <div className="modal-backdrop ask-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <div ref={ref} className="card modal modal-sm" role="alertdialog" aria-modal="true" aria-describedby="ask-text" tabIndex={-1}>
        <p className="ask-text" id="ask-text">
          {state.message}
        </p>
        <div className="modal-actions">
          <button className="btn btn-ghost ask-cancel" onClick={() => onClose(false)}>
            {state.cancel ?? 'Anuluj'}
          </button>
          <button className={`${state.danger ? 'btn btn-danger' : 'btn btn-primary'} ask-ok`} onClick={() => onClose(true)}>
            {state.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
