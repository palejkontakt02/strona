import { useCallback, useMemo, useState } from 'react';
import { Icon } from './components/ui';
import { ModalHost } from './modals/ModalHost';
import { CLIENT_TABS, NavCtx, SECTIONS, type ClientTab, type ModalState, type NavValue, type Section } from './nav';
import { AthleteApp } from './athlete/AthleteApp';
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
  const [athleteId, setAthleteId] = useState<string | null>(null);

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
      startAthlete: (id) => {
        setModal(null);
        setAthleteId(id);
        window.scrollTo(0, 0);
      },
    }),
    [section, go, clientId, clientTab],
  );

  if (athleteId) {
    return (
      <NavCtx.Provider value={nav}>
        <AthleteApp clientId={athleteId} onExit={() => setAthleteId(null)} />
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
            <button key={s} className={section === s ? 'active' : ''} onClick={() => go(s)}>
              {s}
            </button>
          ))}
        </div>
        <span className="grow" />
        <button className="btn btn-primary btn-sm hide-mobile" onClick={() => setModal({ kind: 'appt' })}>
          <Icon name="plus" size={16} /> Dodaj wizytę
        </button>
        <button className="icon-btn show-mobile" aria-label="Ćwiczenia" title="Ćwiczenia" onClick={() => go('Ćwiczenia')}>
          <Icon name="lib" />
        </button>
        <button className="icon-btn" aria-label="Dane i ustawienia" title="Dane i ustawienia" onClick={() => setModal({ kind: 'data' })}>
          <Icon name="settings" />
        </button>
      </nav>

      <main className="main">
        {section === 'Pulpit' && <Dashboard />}
        {section === 'Kalendarz' && <CalendarView />}
        {section === 'Klienci' && <ClientsView />}
        {section === 'Płatności' && <PaymentsView />}
        {section === 'Ćwiczenia' && <LibraryView />}
      </main>

      <nav className="bottombar" aria-label="Menu">
        {SECTIONS.slice(0, 2).map((s) => (
          <button key={s} className={section === s ? 'active' : ''} onClick={() => go(s)}>
            <Icon name={ICON[s]} size={20} />
            <span>{s}</span>
          </button>
        ))}
        <button className="fab" aria-label="Dodaj wizytę" onClick={() => setModal({ kind: 'appt' })}>
          <Icon name="plus" size={26} />
        </button>
        {SECTIONS.slice(2, 4).map((s) => (
          <button key={s} className={section === s ? 'active' : ''} onClick={() => go(s)}>
            <Icon name={ICON[s]} size={20} />
            <span>{s}</span>
          </button>
        ))}
      </nav>

      {modal && <ModalHost modal={modal} />}
    </NavCtx.Provider>
  );
}
