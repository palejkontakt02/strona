import { useEffect, useState } from 'react';
import { ModalHost, type ModalState } from './components/Modals';
import { useCoach } from './data/useCoach';
import { CalendarView } from './views/CalendarView';
import type { DetailTab } from './views/ClientDetail';
import { ClientsView } from './views/ClientsView';
import { PaymentsView } from './views/PaymentsView';

const SECTIONS = ['Podopieczni', 'Kalendarz', 'Płatności'] as const;
type Section = (typeof SECTIONS)[number];

export function App() {
  const { clients, actions } = useCoach();
  const [section, setSection] = useState<Section>('Podopieczni');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>('Przegląd');
  const [mobileDetail, setMobileDetail] = useState(false);
  const [modal, setModal] = useState<ModalState | null>(null);

  // Na starcie zaznacz pierwszego podopiecznego (alfabetycznie), jak w prototypie.
  useEffect(() => {
    if (clients && !selectedId && clients.length > 0) {
      setSelectedId([...clients].sort((a, b) => a.name.localeCompare(b.name, 'pl'))[0].id);
    }
  }, [clients, selectedId]);

  const openClient = (id: string, t: DetailTab) => {
    setSection('Podopieczni');
    setSelectedId(id);
    setTab(t);
    setMobileDetail(true);
    window.scrollTo(0, 0);
  };

  if (!clients) return null;

  return (
    <>
      <nav className="topbar">
        <div className="logo">
          Fitowa <span>/ coach</span>
        </div>
        <div className="nav-links">
          {SECTIONS.map((s) => (
            <button key={s} className={section === s ? 'active' : ''} onClick={() => setSection(s)}>
              {s}
            </button>
          ))}
        </div>
      </nav>

      <main>
        {section === 'Podopieczni' && (
          <ClientsView
            clients={clients}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setMobileDetail(true);
            }}
            tab={tab}
            onTab={setTab}
            mobileDetail={mobileDetail}
            onBack={() => setMobileDetail(false)}
            actions={actions}
            openModal={setModal}
          />
        )}
        {section === 'Kalendarz' && (
          <CalendarView clients={clients} openModal={setModal} onOpenClient={(id) => openClient(id, 'Sesje')} />
        )}
        {section === 'Płatności' && (
          <PaymentsView
            clients={clients}
            actions={actions}
            openModal={setModal}
            onOpenClient={(id) => openClient(id, 'Płatności')}
          />
        )}
      </main>

      {modal && (
        <ModalHost
          modal={modal}
          clients={clients}
          actions={actions}
          onClose={() => setModal(null)}
          onClientCreated={(id) => openClient(id, 'Przegląd')}
        />
      )}
    </>
  );
}
