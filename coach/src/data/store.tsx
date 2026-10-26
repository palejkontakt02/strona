import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Checkin, ClientNote, DayLog, Measurement, ProgressPhoto, WeeklyReport } from '../domain';
import type { Intake } from '../lib/intake';
import { uid } from '../format';
import { withDay } from '../lib/habits';
import { emailTrainer } from './mail';
import { useDialog } from '../components/useDialog';
import { applyChanges, withEntry, type Change, type ClientEntryKind, type Db, type Repository } from './db';
import { createEmpty, createSeed } from './seed';
import { Outbox } from './outbox';

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
  saveIntake: (clientId: string, intake: Intake) => Promise<boolean>;
  /** Wpis podopiecznego: raport tygodniowy, zdjęcie sylwetki albo dzień makro / kroków. */
  saveClientEntry: (clientId: string, kind: ClientEntryKind, entry: WeeklyReport | ProgressPhoto | DayLog | import('../domain').ConsentEntry, okMessage?: string) => Promise<boolean>;
  saveHabitDay: (clientId: string, date: string, done: string[]) => Promise<void>;
  sendClientNote: (clientId: string, text: string, sessionId?: string) => Promise<boolean>;
  /** Wiadomość z kontekstem treningu / ćwiczenia i załącznikami (zdjęcie, wideo, głos). */
  sendClientMessage: (clientId: string, text: string, extra: Pick<ClientNote, 'ref' | 'media' | 'textAuto' | 'sessionId'>) => Promise<boolean>;
  /** Podopieczny potwierdza / odwołuje wizytę (funkcja w bazie, sekcja 23). */
  respondAppointment: (id: string, kind: 'confirm' | 'cancel', reason?: string) => Promise<boolean>;
  /** true — dane w chmurze (Supabase), false — tylko w tej przeglądarce. */
  cloud: boolean;
  /** Zapisy zrobione bez internetu, które czekają na wysłanie (kolejka offline). */
  pending: number;
  /** Ponów wysyłkę czekających zapisów teraz. */
  sendPending: () => void;
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
  // kolejka zapisów offline tego konta (tworzona przy pierwszym wczytaniu, gdy znamy konto)
  const outbox = useRef<Outbox | null>(null);
  const [pending, setPending] = useState(0);

  const load = useCallback(async () => {
    try {
      if (!outbox.current) {
        const scope = (await repo.outboxScope?.().catch(() => null)) ?? 'local';
        outbox.current = new Outbox(repo, scope, setPending);
        setPending(outbox.current.items.length);
      }
      let next = await repo.load();
      const seeded = onEmpty?.(next);
      if (seeded) {
        await repo.replaceAll(seeded);
        next = seeded;
      }
      // zapisy offline, które jeszcze nie doszły do serwera, zostają na ekranie
      setDb(outbox.current.merge(next));
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

  /** Wysyła czekające zapisy offline (po kolei); po sukcesie — powiadomienie. */
  const sendPending = useCallback(async () => {
    const box = outbox.current;
    if (!box?.items.length) return;
    const r = await box.flush();
    if (r.failed.length) {
      toast('Części zmian zapisanych bez internetu baza nie przyjęła — sprawdź je i zapisz ponownie.');
      void load();
    }
    if (r.sent > 0 && !box.items.length) toast('Wysłano zapisane offline treningi.');
  }, [toast, load]);

  // ponowna wysyłka: powrót internetu, powrót do aplikacji, co 30 s
  useEffect(() => {
    if (!pending) return;
    const go = () => {
      if (typeof navigator === 'undefined' || navigator.onLine !== false) void sendPending();
    };
    const onVis = () => document.visibilityState === 'visible' && go();
    window.addEventListener('online', go);
    window.addEventListener('focus', go);
    document.addEventListener('visibilitychange', onVis);
    const t = setInterval(go, 30_000);
    return () => {
      window.removeEventListener('online', go);
      window.removeEventListener('focus', go);
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(t);
    };
  }, [pending, sendPending]);

  /** Zapis zmian; zwraca false, gdy się nie udał (wtedy np. trening zostaje do ponownego zapisu). */
  const apply = useCallback(
    async (changes: Change[], message?: string): Promise<boolean> => {
      let before: Db | null = null;
      setDb((cur) => {
        before = cur;
        return cur ? applyChanges(cur, changes) : cur;
      });
      try {
        // brak sieci: zmiana zostaje na ekranie i w kolejce na tym urządzeniu, wyśle się sama
        const had = outbox.current?.items.length ?? 0;
        const res = outbox.current ? await outbox.current.submit(changes) : (await repo.apply(changes), 'sent');
        if (res === 'queued') toast('Brak internetu — zapisane na tym telefonie. Wyślę, gdy wróci połączenie.');
        else if (had > 0 && !outbox.current?.items.length) toast('Wysłano zapisane offline treningi.');
        if (res === 'sent' && message) toast(message);
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
      } catch (e) {
        toast((e as Error).message === 'DB_OUTDATED' ? 'Samopoczucie nie zapisało się — baza wymaga aktualizacji po stronie trenera (Supabase, sekcja 7 w hardening.sql).' : 'Nie udało się zapisać samopoczucia — sprawdź połączenie.');
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

  /** Ankieta podopiecznego — zapis całości (poprawki w każdej chwili). */
  const saveIntake = useCallback(
    async (clientId: string, intake: Intake) => {
      const prev = db?.clients.find((c) => c.id === clientId)?.intake;
      setDb((cur) => (cur ? { ...cur, clients: cur.clients.map((c) => (c.id === clientId ? { ...c, intake } : c)) } : cur));
      try {
        await repo.saveIntake(clientId, intake);
        return true;
      } catch (e) {
        setDb((cur) => (cur ? { ...cur, clients: cur.clients.map((c) => (c.id === clientId ? { ...c, intake: prev } : c)) } : cur));
        toast(e instanceof Error && e.message === 'DB_OUTDATED' ? 'Pliki w ankiecie się nie zapisały — baza wymaga aktualizacji po stronie trenera (Supabase, sekcja 18 w hardening.sql).' : 'Nie udało się zapisać ankiety — sprawdź połączenie i spróbuj ponownie.');
        return false;
      }
    },
    [db, repo, toast],
  );

  const saveClientEntry = useCallback(
    async (clientId: string, kind: ClientEntryKind, entry: WeeklyReport | ProgressPhoto | DayLog | import('../domain').ConsentEntry, okMessage?: string) => {
      const prev = db?.clients.find((c) => c.id === clientId)?.[kind];
      const upd = (list: unknown) => withEntry((list ?? []) as { id?: string; date?: string }[], entry as { id?: string; date?: string });
      setDb((cur) => (cur ? { ...cur, clients: cur.clients.map((c) => (c.id === clientId ? { ...c, [kind]: upd(c[kind]) } : c)) } : cur));
      try {
        await repo.saveClientEntry(clientId, kind, entry);
        if (okMessage) toast(okMessage);
        return true;
      } catch (e) {
        setDb((cur) => (cur ? { ...cur, clients: cur.clients.map((c) => (c.id === clientId ? { ...c, [kind]: prev } : c)) } : cur));
        const m = (e as Error).message;
        toast(m === 'DB_OUTDATED' || m === 'DB_OUTDATED_22' ? `Nie zapisało się — baza wymaga aktualizacji po stronie trenera (Supabase, sekcja ${m === 'DB_OUTDATED_22' ? '22' : kind === 'consents' ? '24' : '19'} w hardening.sql).` : 'Nie udało się zapisać — sprawdź połączenie i spróbuj ponownie.');
        return false;
      }
    },
    [db, repo, toast],
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
      } catch (e) {
        toast((e as Error).message === 'DB_OUTDATED' ? 'Odhaczenie nie zapisało się — baza wymaga aktualizacji po stronie trenera (Supabase, sekcja 10 w hardening.sql).' : 'Nie udało się zapisać — sprawdź połączenie.');
        void load();
      }
    },
    [repo, toast, load],
  );

  /** Notatka od podopiecznego: zapis w aplikacji + e-mail do trenera. */
  const sendClientMessage = useCallback(
    async (clientId: string, text: string, extra: Pick<ClientNote, 'ref' | 'media' | 'textAuto' | 'sessionId'>): Promise<boolean> => {
      const note: ClientNote = { id: uid(), at: new Date().toISOString(), text: text.trim().slice(0, 2000), ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v != null)) };
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
  const sendClientNote = useCallback(
    (clientId: string, text: string, sessionId?: string) => sendClientMessage(clientId, text, sessionId ? { sessionId } : {}),
    [sendClientMessage],
  );

  const respondAppointment = useCallback(
    async (id: string, kind: 'confirm' | 'cancel', reason?: string): Promise<boolean> => {
      if (!repo.respondAppointment) return false;
      try {
        const saved = await repo.respondAppointment(id, kind, reason);
        if (saved) setDb((cur) => (cur ? { ...cur, appointments: cur.appointments.map((a) => (a.id === id ? { ...a, ...saved, id: a.id, clientId: a.clientId } : a)) } : cur));
        return true;
      } catch (e) {
        const m = (e as Error).message;
        toast(m === 'DB_OUTDATED' ? 'Nie zapisało się — baza wymaga aktualizacji po stronie trenera (Supabase, sekcja 23 w hardening.sql).' : /odbyła|zaplanowana/.test(m) ? m + '.' : 'Nie udało się zapisać — sprawdź połączenie i spróbuj ponownie.');
        return false;
      }
    },
    [repo, toast],
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
      outbox.current?.clear();
      setDb(next);
      toast(mode === 'seed' ? 'Wczytano dane przykładowe.' : 'Wyczyszczono dane.');
    },
    [toast, repo],
  );

  const importDb = useCallback(
    async (next: Db) => {
      await repo.replaceAll(next);
      outbox.current?.clear();
      setDb(next);
      toast('Zaimportowano dane.');
    },
    [toast, repo],
  );

  const value = useMemo(
    () =>
      db
        ? { db, apply, toast, ask, reset, importDb, saveCheckin, addMeasurement, saveIntake, saveClientEntry, saveHabitDay, sendClientNote, sendClientMessage, respondAppointment, cloud, signOut, pending, sendPending: () => void sendPending() }
        : null,
    [db, apply, toast, ask, reset, importDb, saveCheckin, addMeasurement, saveIntake, saveClientEntry, saveHabitDay, sendClientNote, sendClientMessage, respondAppointment, cloud, signOut, pending, sendPending],
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
