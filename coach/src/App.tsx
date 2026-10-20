import { useCallback, useEffect, useMemo, useState } from 'react';
import { plural } from './format';
import { ErrorBoundary } from './components/ErrorBoundary';
import type { RunStart } from './athlete/start';
import { Icon } from './components/ui';
import { ModalHost } from './modals/ModalHost';
import { CLIENT_TABS, NavCtx, SECTIONS, type ClientTab, type ModalState, type NavValue, type Section } from './nav';
import { AthleteApp, loadRun } from './athlete/AthleteApp';
import { LiveSession, PairLive } from './athlete/LiveSession';
import { groupOf } from './data/ops';
import { useStore } from './data/store';
import { CalendarView } from './views/CalendarView';
import { ClientsView } from './views/ClientsView';
import { Dashboard } from './views/Dashboard';
import { LibraryView } from './views/LibraryView';
import { PaymentsView } from './views/PaymentsView';

const ICON: Record<Section, string> = {
  Pulpit: 'dash',
  Kalendarz: 'cal',
  Klienci: 'users',
  Płatności: 'money',
  Ćwiczenia: 'lib',
};

export function App() {
  const [section, setSection] = useState<Section>('Pulpit');
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientTab, setClientTab] = useState<ClientTab>('Przegląd');
  const [modal, setModal] = useState<ModalState | null>(null);
  const [athlete, setAthlete] = useState<{ id: string; start?: RunStart } | null>(null);
  const [live, setLive] = useState<{ clientId: string; appointmentId?: string; editSessionId?: string; start?: RunStart; pair?: { clientId: string; appointmentId?: string }[] } | null>(null);
  const [bannerOpen, setBannerOpen] = useState(false);
  const { db } = useStore();

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
        setModal(null);
        setAthlete(null);
        setLive({ clientId, appointmentId, editSessionId, start });
        window.scrollTo(0, 0);
      },
    }),
    [section, go, clientId, clientTab],
  );

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
          {SECTIONS.map((s) => (
            <button key={s} className={section === s ? 'active' : ''} aria-current={section === s ? 'page' : undefined} onClick={() => go(s)}>
              {s}
            </button>
          ))}
        </div>
        <span className="grow" />
        <button className="btn btn-primary btn-sm hide-mobile" onClick={() => setModal({ kind: 'appt', clientId: section === 'Klienci' ? (clientId ?? undefined) : undefined })}>
          <Icon name="plus" size={16} /> Dodaj wizytę
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
