import { useEffect, useState } from 'react';
import { AthleteApp } from '../athlete/AthleteApp';
import { History } from '../athlete/History';
import { MyData } from '../athlete/MyData';
import { Consents } from '../components/Consents';
import { OfflineBadge } from '../components/OfflineBadge';
import { PalettePicker } from '../components/PalettePicker';
import { Sheet } from '../components/Sheet';
import { Icon } from '../components/ui';
import { clientById, sessionsOf } from '../data/ops';
import { useStore } from '../data/store';
import type { Client } from '../domain';
import { plural } from '../format';
import { isArchived, needsConsentPrompt } from '../lib/rodo';

const LATER = (id: string) => `fitowa-consent-later:${id}`;

/**
 * Konto podopiecznego po zalogowaniu:
 * 1. współpraca zakończona → historia tylko do odczytu + pobranie danych,
 * 2. pierwsze logowanie (brak decyzji o zgodach RODO) → ekran zgód,
 * 3. w przeciwnym razie zwykły panel podopiecznego.
 */
export function ClientEntry({ clientId, onExit }: { clientId: string; onExit: () => void }) {
  const { db } = useStore();
  const client = clientById(db, clientId);
  const [later, setLater] = useState(() => {
    try {
      return !!sessionStorage.getItem(LATER(clientId));
    } catch {
      return false;
    }
  });
  if (client && isArchived(client)) return <ArchivedHome client={client} onExit={onExit} />;
  if (client && !later && needsConsentPrompt(client))
    return (
      <ConsentScreen
        client={client}
        onExit={onExit}
        onLater={() => {
          try {
            sessionStorage.setItem(LATER(clientId), '1');
          } catch {
            // brak sessionStorage — tylko do odświeżenia
          }
          setLater(true);
        }}
      />
    );
  return <AthleteApp clientId={clientId} onExit={onExit} mode="client" />;
}

function useAthleteBody() {
  useEffect(() => {
    document.body.classList.add('athlete-mode');
    return () => document.body.classList.remove('athlete-mode');
  }, []);
}

function TopBar({ onExit, onSettings }: { onExit: () => void; onSettings?: () => void }) {
  return (
    <div className="ath-top">
      <span className="auth-logo small-logo">
        FITOWA <span>/ coach</span>
      </span>
      <span className="row-inline">
        <OfflineBadge />
        {onSettings && (
          <button className="btn btn-ghost btn-sm" onClick={onSettings} aria-label="Ustawienia — moje dane i kolory">
            <Icon name="settings" size={16} /> Ustawienia
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={onExit}>
          Wyloguj
        </button>
      </span>
    </div>
  );
}

/** Pierwsze logowanie: krótkie zgody RODO (pola niezaznaczone) z linkiem do pełnej klauzuli. */
function ConsentScreen({ client, onExit, onLater }: { client: Client; onExit: () => void; onLater: () => void }) {
  useAthleteBody();
  return (
    <div className="ath">
      <TopBar onExit={onExit} />
      <div className="ath-home fade consent-screen">
        <header className="ath-hello">
          <span className="eyebrow">Witaj, {client.name.split(' ')[0]}</span>
          <h1>Zanim zaczniemy</h1>
        </header>
        <section className="acard">
          <Consents client={client} variant="prompt" onLater={onLater} saveLabel="Zapisz i przejdź dalej" />
        </section>
      </div>
    </div>
  );
}

/** Współpraca zakończona: historia treningów i Twoje dane zostają dostępne — bez nowych treningów z planu. */
export function ArchivedHome({ client, onExit }: { client: Client; onExit: () => void }) {
  useAthleteBody();
  const { db } = useStore();
  const [look, setLook] = useState(false);
  const n = sessionsOf(db, client.id).length;
  return (
    <div className="ath">
      <TopBar onExit={onExit} onSettings={() => setLook(true)} />
      {look && (
        <Sheet label="Ustawienia" onClose={() => setLook(false)}>
          <div className="between">
            <h2>Ustawienia</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => setLook(false)}>
              Gotowe
            </button>
          </div>
          <h3 className="form-section">Kolory</h3>
          <PalettePicker />
        </Sheet>
      )}
      <div className="ath-home fade archived">
        <header className="ath-hello">
          <span className="eyebrow">{client.name}</span>
          <h1>Współpraca zakończona</h1>
        </header>
        <section className="acard archived-card" role="status">
          <span className="archived-icon" aria-hidden="true">
            <Icon name="check" size={20} />
          </span>
          <div>
            <b>Twoja historia zostaje dostępna</b>
            <p className="muted small">
              Możesz przeglądać {n ? <span className="num">{n}</span> : 'swoje'} {n ? plural(n, 'trening', 'treningi', 'treningów') : 'treningi'} i pobrać swoje dane. Nowe treningi z planu są wyłączone — jeśli chcesz wrócić, napisz do trenera.
            </p>
          </div>
        </section>
        <History clientId={client.id} plain />
        <section className="acard">
          <MyData client={client} />
        </section>
      </div>
    </div>
  );
}
