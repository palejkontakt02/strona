import { useState } from 'react';
import type { Client } from '../domain';
import { useStore } from '../data/store';
import { sessionsOf } from '../data/ops';
import { todayISO } from '../lib/dates';
import { Consents } from '../components/Consents';
import { ERASURE_PREFIX, consentEntry, consentOf, erasureStatus, exportData, exportFileName, isArchived, sessionsCsv } from '../lib/rodo';

const fmtWhen = (iso: string) => new Date(iso).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });

/** Zapis pliku na urządzeniu (telefon: „Pobrane” / udostępnij). */
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * „Moje dane” (RODO) w arkuszu Ustawienia podopiecznego: zgody z przełącznikami, pobranie danych
 * (JSON + CSV treningów) i prośba o usunięcie konta (usuwa trener — konto podopiecznego nie ma do tego uprawnień).
 */
export function MyData({ client, readOnly }: { client: Client; /** Podgląd trenera: bez zmian zgód i próśb. */ readOnly?: boolean }) {
  const { db, ask, toast, saveClientEntry, sendClientNote } = useStore();
  const [busy, setBusy] = useState(false);
  const er = erasureStatus(client);
  const nSessions = sessionsOf(db, client.id).length;

  const getJson = () => {
    const data = exportData(db, client.id);
    if (!data) return;
    download(exportFileName(client.name, 'json', todayISO()), JSON.stringify(data, null, 2), 'application/json');
    toast('Plik z Twoimi danymi zapisany na urządzeniu.');
  };
  const getCsv = () => {
    download(exportFileName(client.name, 'csv', todayISO()), sessionsCsv(sessionsOf(db, client.id)), 'text/csv;charset=utf-8');
    toast('Treningi zapisane jako CSV (otworzysz w Excelu / Arkuszach).');
  };

  const request = async () => {
    if (readOnly || busy) return;
    const sure = await ask(
      'Poprosić trenera o usunięcie konta i wszystkich Twoich danych (profil, treningi, pomiary, wiadomości, zdjęcia, nagrania)? Najpierw pobierz kopię, jeśli chcesz ją zachować. Dokumenty rozliczeniowe trener musi przechowywać zgodnie z przepisami podatkowymi.',
      { confirm: 'Wyślij prośbę' },
    );
    if (!sure) return;
    setBusy(true);
    const sent = await sendClientNote(client.id, `${ERASURE_PREFIX} (RODO art. 17): proszę o usunięcie mojego konta i wszystkich moich danych z aplikacji.`);
    if (sent) await saveClientEntry(client.id, 'consents', consentEntry(consentOf(client, 'erasure'), 'erasure', true), 'Prośba wysłana do trenera.');
    setBusy(false);
  };
  const cancel = async () => {
    if (readOnly || busy) return;
    if (!(await ask('Wycofać prośbę o usunięcie konta? Konto i dane zostaną bez zmian.', { confirm: 'Wycofaj prośbę', danger: false }))) return;
    setBusy(true);
    const ok = await saveClientEntry(client.id, 'consents', consentEntry(consentOf(client, 'erasure'), 'erasure', false), 'Prośba wycofana.');
    if (ok) void sendClientNote(client.id, 'Wycofuję prośbę o usunięcie konta — zostaję w aplikacji.');
    setBusy(false);
  };

  return (
    <section className="mydata" aria-labelledby="mydata-h">
      <h3 className="form-section" id="mydata-h">
        Moje dane
      </h3>

      <h4 className="mydata-sub">Zgody</h4>
      <Consents client={client} variant="settings" readOnly={readOnly} />

      <h4 className="mydata-sub">Pobierz moje dane</h4>
      <p className="muted small">
        Wszystko, co aplikacja o Tobie zapisała: profil, ankieta, treningi, pomiary, samopoczucie, wiadomości i wpisy dzienne — w jednym pliku JSON. Treningi także jako tabela CSV.
      </p>
      <div className="mydata-actions">
        <button type="button" className="btn btn-secondary" onClick={getJson}>
          Pobierz dane (JSON)
        </button>
        <button type="button" className="btn btn-ghost" onClick={getCsv} disabled={!nSessions}>
          Treningi (CSV)
        </button>
      </div>

      <h4 className="mydata-sub">Usunięcie konta</h4>
      {er.state === 'none' ? (
        <>
          <p className="muted small">Konto i dane usuwa trener — wyślemy mu Twoją prośbę. Zrobi to bez zbędnej zwłoki, najpóźniej w ciągu miesiąca.</p>
          <button type="button" className="btn btn-ghost mydata-danger" onClick={() => void request()} disabled={readOnly || busy}>
            Poproś o usunięcie konta
          </button>
        </>
      ) : (
        <div className="mydata-status" role="status">
          <span className={er.state === 'read' ? 'ok-text' : 'warn-text'}>
            <b>{er.state === 'read' ? 'Trener odczytał prośbę' : 'Prośba wysłana'}</b> · {fmtWhen(er.at)}
          </span>
          <span className="muted small">
            {er.state === 'read' ? 'Usunięcie konta zakończy dostęp do aplikacji.' : 'Czeka na trenera.'} Pobierz kopię danych, jeśli chcesz ją zachować.
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void cancel()} disabled={readOnly || busy}>
            Wycofaj prośbę
          </button>
        </div>
      )}
      {isArchived(client) && <p className="muted small">Współpraca zakończona — konto działa w trybie tylko do odczytu.</p>}
    </section>
  );
}
