import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { plural } from './format';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OfflineBadge } from './components/OfflineBadge';
import type { RunStart } from './athlete/start';
import { Icon } from './components/ui';
import { ModalHost } from './modals/ModalHost';
import { CLIENT_TABS, NavCtx, SECTIONS, type ClientTab, type ModalState, type NavValue, type Section } from './nav';
import { AthleteApp, loadRun } from './athlete/AthleteApp';
import { LiveSession, PairLive } from './athlete/LiveSession';
import { groupOf } from './data/ops';
import { useStore } from './data/store';
import { put } from './data/db';
import { savePlan } from './data/ops';
import { defaultCharge } from './lib/billing';
import { dueBlock } from './lib/plan';
import { todayISO } from './lib/dates';
import type { Plan } from './domain';
import { markNeedsUpdate, wantedMark } from './lib/liveMark';
import { CalendarView } from './views/CalendarView';
import { ClientsView } from './views/ClientsView';
import { Dashboard } from './views/Dashboard';
import { LibraryView } from './views/LibraryView';
import { PaymentsView } from './views/PaymentsView';
import { Inbox } from './views/Inbox';
import { trainerUnread } from './lib/comms';

const ICON: Record<Section, string> = {
  Pulpit: 'dash',
  Kalendarz: 'cal',
  Klienci: 'users',
  Płatności: 'money',
  Ćwiczenia: 'lib',
  Wiadomości: 'chat',
};
/** Kolejność w menu na komputerze (Wiadomości zaraz po Pulpicie). */
const DESKTOP_NAV: Section[] = ['Pulpit', 'Wiadomości', 'Kalendarz', 'Klienci', 'Płatności', 'Ćwiczenia'];

/** Odznaka z liczbą nieprzeczytanych wiadomości. */
function UnreadBadge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="nav-badge" aria-label={`${n} nieprzeczytanych`}>
      {n > 99 ? '99+' : n}
    </span>
  );
}

export function App() {
  const [section, setSection] = useState<Section>('Pulpit');
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientTab, setClientTab] = useState<ClientTab>('Przegląd');
  const [modal, setModal] = useState<ModalState | null>(null);
  const [athlete, setAthlete] = useState<{ id: string; start?: RunStart } | null>(null);
  const [live, setLive] = useState<{ clientId: string; appointmentId?: string; editSessionId?: string; start?: RunStart; pair?: { clientId: string; appointmentId?: string }[] } | null>(null);
  const [bannerOpen, setBannerOpen] = useState(false);
  const { db, apply, ask } = useStore();
  // trening prowadzony na żywo jest tylko w pamięci telefonu trenera — znacznik w danych klienta
  // pokazuje podopiecznemu, że trening trwa (inaczej mógłby zacząć drugi zapis u siebie)
  const dbRef = useRef(db);
  dbRef.current = db;
  const syncing = useRef(false);
  // przygotowany kolejny blok („Duplikuj plan”) włącza się sam w dniu startu — zapis w danych (stary plan nieaktywny)
  const activating = useRef(false);
  useEffect(() => {
    if (activating.current) return;
    const today = todayISO();
    const due = [...new Set(db.plans.filter((p) => p.autoStart && !p.active).map((p) => p.clientId))]
      .map((cid) => dueBlock(db.plans.filter((p) => p.clientId === cid), today))
      .filter((b): b is Plan => !!b);
    if (!due.length) return;
    activating.current = true;
    let cur = db;
    const changes = due.flatMap((b) => {
      const ch = savePlan(cur, { ...b, active: true });
      cur = { ...cur, plans: cur.plans.map((p) => (p.clientId === b.clientId && !p.extra ? (p.id === b.id ? { ...b, active: true } : { ...p, active: false }) : p)) };
      return ch;
    });
    void apply(changes, due.length === 1 ? `Włączono „${due[0].name}” — dziś zaczyna się ten blok.` : `Włączono ${due.length} przygotowane bloki — dziś ich start.`).finally(() => {
      activating.current = false;
    });
  }, [db, apply]);
  useEffect(() => {
    const sync = async () => {
      if (syncing.current || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
      const now = Date.now();
      const todo = dbRef.current.clients.filter((c) => markNeedsUpdate(c, wantedMark(loadRun(c.id, 'live')), now));
      if (!todo.length) return;
      syncing.current = true;
      try {
        await apply(
          todo.map((c) => {
            const want = wantedMark(loadRun(c.id, 'live'));
            return put('clients', { ...c, liveBy: want ? { ...want, at: new Date(now).toISOString() } : undefined });
          }),
        );
      } finally {
        syncing.current = false;
      }
    };
    void sync();
    const t = setInterval(() => void sync(), 10_000);
    return () => clearInterval(t);
  }, [apply, live]);
  const unreadAll = db.clients.reduce((a, c) => a + trainerUnread(c), 0);

  const go = useCallback((s: Section) => {
    setSection(s);
    if (s !== 'Klienci') setClientId(null);
    window.scrollTo(0, 0);
  }, []);

  const nav = useMemo<NavValue>(
    () => ({
      section,
      go,
      clientId,
      clientTab,
      openClient: (id, tab = 'Przegląd') => {
        setSection('Klienci');
        setClientId(id);
        setClientTab(CLIENT_TABS.includes(tab) ? tab : 'Przegląd');
        window.scrollTo(0, 0);
      },
      setClientTab,
      closeClient: () => setClientId(null),
      openModal: setModal,
      closeModal: () => setModal(null),
      startAthlete: (id, start) => {
        setModal(null);
        setAthlete({ id, start });
        window.scrollTo(0, 0);
      },
      startLive: (clientId, appointmentId, editSessionId, start) => {
        const go = () => {
          setModal(null);
          setAthlete(null);
          setLive({ clientId, appointmentId, editSessionId, start });
          window.scrollTo(0, 0);
        };
        // wizyta, a podopieczny już zapisał trening tego dnia (sam, z telefonu) — połącz zamiast drugiego zapisu
        const cur = dbRef.current;
        const appt = appointmentId && !editSessionId ? cur.appointments.find((a) => a.id === appointmentId && !a.sessionId) : undefined;
        const own = appt
          ? cur.sessions.filter((s) => s.clientId === clientId && s.date === appt.date && !cur.appointments.some((a) => a.sessionId === s.id)).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0]
          : undefined;
        if (!appt || !own) return go();
        const first = (cur.clients.find((c) => c.id === clientId)?.name ?? '').split(' ')[0];
        void ask(`${first} zapisał(a) już ${appt.date === todayISO() ? 'dziś' : 'tego dnia'} trening „${own.workoutName || 'Trening'}”. Połączyć go z tą wizytą zamiast zapisywać drugi? (Potem ustawisz rozliczenie.)`, { confirm: 'Połącz z wizytą', cancel: 'Nowy trening', danger: false }).then(async (link) => {
          if (!link) return go();
          // trening z trenerem: rozliczenie jak zwykle u tego podopiecznego (pakiet / pojedyncza / klub), nie „brak” z zapisu podopiecznego
          const cl = cur.clients.find((c) => c.id === clientId);
          const charge = own.charge === 'brak' && cl ? defaultCharge(cl, cur.sessions.filter((s) => s.clientId === clientId && s.id !== own.id)) : own.charge;
          const linked = { ...own, solo: false, charge };
          const ok = await apply([put('appointments', { ...appt, status: 'done', sessionId: own.id }), put('sessions', linked)], 'Trening połączony z wizytą — sprawdź rozliczenie.');
          if (ok) setModal({ kind: 'session', session: linked });
        });
      },
    }),
    [section, go, clientId, clientTab, ask, apply],
  );

  // Powiadomienie push → podopieczny i zakładka (adres /app/?c=<id>&t=<zakładka>): przy starcie i z otwartej aplikacji.
  const openClient = nav.openClient;
  const clientsRef = useRef(db.clients);
  clientsRef.current = db.clients;
  useEffect(() => {
    const open = (url: string) => {
      const q = new URL(url, location.origin).searchParams;
      const id = q.get('c');
      if (id && clientsRef.current.some((c) => c.id === id)) openClient(id, (q.get('t') ?? 'Przegląd') as ClientTab);
    };
    if (location.search.includes('c=')) {
      open(location.href);
      history.replaceState(null, '', location.pathname);
    }
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; url?: string } | null;
      if (d?.type === 'fitowa-open' && typeof d.url === 'string') open(d.url);
    };
    navigator.serviceWorker?.addEventListener('message', onMsg);
    return () => navigator.serviceWorker?.removeEventListener('message', onMsg);
  }, [openClient]);

  // trening w parze / grupie: z wizyty z partnerami albo wznowiony z paska „W toku”
  const liveAppt = live?.appointmentId ? db.appointments.find((a) => a.id === live.appointmentId) : undefined;
  const liveGroup = live && liveAppt && !live.editSessionId && !live.start ? groupOf(db.appointments, liveAppt).filter((a) => a.status !== 'cancel' && a.status !== 'noshow' && !a.sessionId) : [];
  const livePair = live?.pair ?? (liveGroup.length > 1 ? [liveAppt!, ...liveGroup.filter((a) => a.id !== liveAppt!.id)].map((a) => ({ clientId: a.clientId, appointmentId: a.id })) : null);
  // skład pary zapamiętany na starcie — po zapisie pierwszej osoby jej wizyta ma już sessionId i nie może wypaść z pary
  useEffect(() => {
    if (live && !live.pair && livePair) setLive((l) => (l && !l.pair ? { ...l, pair: livePair } : l));
  }, [live, livePair]);

  if (live) {
    const pair = livePair;
    if (pair && pair.length > 1)
      return (
        <NavCtx.Provider value={nav}>
          <PairLive people={pair} onExit={() => setLive(null)} />
        </NavCtx.Provider>
      );
    return (
      <NavCtx.Provider value={nav}>
        <LiveSession clientId={live.clientId} appointmentId={live.appointmentId} editSessionId={live.editSessionId} start={live.start} onExit={() => setLive(null)} />
      </NavCtx.Provider>
    );
  }

  // Treningi prowadzone na żywo, które czekają na dokończenie (np. po przejściu do kalendarza).
  const running = db.clients
    .map((c) => ({ c, run: loadRun(c.id, 'live') }))
    .filter((x) => x.run);

  if (athlete) {
    return (
      <NavCtx.Provider value={nav}>
        <AthleteApp key={athlete.id} clientId={athlete.id} start={athlete.start} onExit={() => setAthlete(null)} onTrainer={(st) => nav.startLive(athlete.id, undefined, undefined, st)} />
      </NavCtx.Provider>
    );
  }

  return (
    <NavCtx.Provider value={nav}>
      <nav className="topbar">
        <button className="logo" onClick={() => go('Pulpit')}>
          Fitowa <span>/ coach</span>
        </button>
        <div className="nav-links">
          {DESKTOP_NAV.filter((s) => SECTIONS.includes(s)).map((s) => (
            <button key={s} className={section === s ? 'active' : ''} aria-current={section === s ? 'page' : undefined} onClick={() => go(s)}>
              {s}
              {s === 'Wiadomości' && <UnreadBadge n={unreadAll} />}
            </button>
          ))}
        </div>
        <span className="grow" />
        <OfflineBadge />
        <button className="btn btn-primary btn-sm hide-mobile" onClick={() => setModal({ kind: 'appt', clientId: section === 'Klienci' ? (clientId ?? undefined) : undefined })}>
          <Icon name="plus" size={16} /> Dodaj wizytę
        </button>
        <button className={`icon-btn show-mobile nav-msg-btn${section === 'Wiadomości' ? ' active' : ''}`} aria-label="Wiadomości" title="Wiadomości" aria-current={section === 'Wiadomości' ? 'page' : undefined} onClick={() => go('Wiadomości')}>
          <Icon name="chat" />
          <UnreadBadge n={unreadAll} />
        </button>
        <button className="icon-btn show-mobile" aria-label="Ćwiczenia" title="Ćwiczenia" onClick={() => go('Ćwiczenia')}>
          <Icon name="lib" />
        </button>
        <button className="icon-btn" aria-label="Dane i ustawienia" title="Dane i ustawienia" onClick={() => setModal({ kind: 'data' })}>
          <Icon name="settings" />
        </button>
      </nav>

      {running.length > 0 && (
        <div className="live-banner">
          {running.length > 1 && (
            <button onClick={() => setBannerOpen(!bannerOpen)} aria-expanded={bannerOpen}>
              <span className="live-dot" />
              <b>W toku: {running.length} {plural(running.length, 'trening', 'treningi', 'treningów')}</b>
              <span className="muted small">{running.map(({ c }) => c.name.split(' ')[0]).join(', ')}</span>
              <span className="grow" />
              <span className="live-go">{bannerOpen ? 'Zwiń ▴' : 'Pokaż ▾'}</span>
            </button>
          )}
          {(running.length === 1 || bannerOpen) &&
            running.map(({ c, run }) => (
              <button
                key={c.id}
                className={running.length > 1 ? 'live-sub' : ''}
                onClick={() => {
                  // trening w parze wraca razem z partnerami, którzy dalej mają trening w toku
                  const others = (run!.pairWith ?? []).filter((id) => loadRun(id, 'live'));
                  setLive(others.length ? { clientId: c.id, pair: [c.id, ...others].map((id) => ({ clientId: id, appointmentId: loadRun(id, 'live')?.appointmentId })) } : { clientId: c.id });
                }}
              >
                <span className="live-dot" />
                <span className="live-label">{run!.pairWith?.length ? 'W parze:' : 'Trening w toku:'}</span>
                <b>{c.name}</b>
                <span className="muted small">
                  {run!.ex.reduce((a, e) => a + e.sets.filter((s) => s.done).length, 0)}/{run!.ex.reduce((a, e) => a + e.sets.length, 0)} serii
                </span>
                <span className="grow" />
                <span className="live-go">Wróć ›</span>
              </button>
            ))}
        </div>
      )}
      <main className="main">
        {/* błąd w jednej sekcji nie zasłania menu ani Ustawień (np. kopii zapasowej) */}
        <ErrorBoundary key={section + (clientId ?? '')}>
          {section === 'Pulpit' && <Dashboard />}
          {section === 'Kalendarz' && <CalendarView />}
          {section === 'Klienci' && <ClientsView />}
          {section === 'Płatności' && <PaymentsView />}
          {section === 'Ćwiczenia' && <LibraryView />}
          {section === 'Wiadomości' && <Inbox />}
        </ErrorBoundary>
      </main>

      <nav className="bottombar" aria-label="Menu">
        {SECTIONS.slice(0, 2).map((s) => (
          <button key={s} className={section === s ? 'active' : ''} aria-current={section === s ? 'page' : undefined} onClick={() => go(s)}>
            <Icon name={ICON[s]} size={20} />
            <span>{s}</span>
          </button>
        ))}
        <button className="fab" aria-label="Dodaj wizytę" onClick={() => setModal({ kind: 'appt', clientId: section === 'Klienci' ? (clientId ?? undefined) : undefined })}>
          <Icon name="plus" size={26} />
        </button>
        {SECTIONS.slice(2, 4).map((s) => (
          <button key={s} className={section === s ? 'active' : ''} aria-current={section === s ? 'page' : undefined} onClick={() => go(s)}>
            <Icon name={ICON[s]} size={20} />
            <span>{s}</span>
          </button>
        ))}
      </nav>

      {modal && <ModalHost modal={modal} />}
    </NavCtx.Provider>
  );
}
