import { useState } from 'react';
import type { Client, ConsentKind } from '../domain';
import { useStore } from '../data/store';
import { Sheet } from './Sheet';
import { Icon } from './ui';
import { ADMIN, CONSENT_TEXT, consentDate, consentEntry, consentOf, consentState } from '../lib/rodo';

const KINDS: ConsentKind[] = ['health', 'media'];

const fmtWhen = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

/** Wiadomość do trenera przy wycofaniu zgody — trener ma obowiązek przestać przetwarzać i usunąć te dane. */
const WITHDRAW_NOTE: Record<ConsentKind, string> = {
  health: 'Wycofuję zgodę na przetwarzanie danych o moim zdrowiu (RODO art. 9). Proszę o usunięcie tych danych z mojego profilu.',
  media: 'Wycofuję zgodę na zdjęcia sylwetki i nagrania techniki. Proszę o usunięcie moich zdjęć i nagrań.',
};

/** Zapis zgody (i — przy wycofaniu — wiadomość do trenera). */
function useConsentSave(client: Client) {
  const { saveClientEntry, sendClientNote } = useStore();
  return async (kind: ConsentKind, on: boolean, opts: { note?: boolean; message?: string } = {}) => {
    const entry = consentEntry(consentOf(client, kind), kind, on);
    const ok = await saveClientEntry(client.id, 'consents', entry, opts.message);
    if (ok && !on && opts.note) void sendClientNote(client.id, WITHDRAW_NOTE[kind]);
    return ok;
  };
}

/**
 * Zgody RODO podopiecznego.
 * - `prompt` — krótka forma przy pierwszym logowaniu / na początku ankiety: pola niezaznaczone, „Więcej” = pełna klauzula.
 * - `settings` — przełączniki z datą udzielenia, wycofanie w każdej chwili („Moje dane”).
 * `only` — tylko wybrane zgody (np. ankieta pyta tylko o dane o zdrowiu).
 */
export function Consents({
  client,
  variant,
  only = KINDS,
  readOnly,
  onDone,
  onLater,
  saveLabel = 'Zapisz wybór',
}: {
  client: Client;
  variant: 'prompt' | 'settings';
  only?: ConsentKind[];
  /** Podgląd trenera — zgody zmienia tylko podopieczny. */
  readOnly?: boolean;
  /** Po zapisie: co zaznaczono. */
  onDone?: (checked: Partial<Record<ConsentKind, boolean>>) => void;
  onLater?: () => void;
  saveLabel?: string;
}) {
  const [more, setMore] = useState(false);
  return (
    <div className={`consents consents-${variant}`}>
      {variant === 'prompt' ? (
        <ConsentPrompt client={client} only={only} readOnly={readOnly} onDone={onDone} onLater={onLater} onMore={() => setMore(true)} saveLabel={saveLabel} />
      ) : (
        <ConsentSettings client={client} only={only} readOnly={readOnly} onMore={() => setMore(true)} />
      )}
      {more && <ClauseSheet onClose={() => setMore(false)} />}
    </div>
  );
}

function ConsentPrompt({
  client,
  only,
  readOnly,
  onDone,
  onLater,
  onMore,
  saveLabel,
}: {
  client: Client;
  only: ConsentKind[];
  readOnly?: boolean;
  onDone?: (checked: Partial<Record<ConsentKind, boolean>>) => void;
  onLater?: () => void;
  onMore: () => void;
  saveLabel: string;
}) {
  const save = useConsentSave(client);
  // aktywna zgoda: nic nie jest zaznaczone z góry (także gdy wcześniej odmówił)
  const [checked, setChecked] = useState<Record<string, boolean>>(() => Object.fromEntries(only.map((k) => [k, consentState(client, k) === 'on'])));
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (readOnly) return onDone?.(checked);
    setBusy(true);
    let ok = true;
    for (const k of only) {
      // zapisujemy też odmowę — żeby nie pytać przy każdym logowaniu; już udzielonej nie ruszamy
      const st = consentState(client, k);
      if (checked[k] ? st !== 'on' : st === 'unset') ok = (await save(k, !!checked[k])) && ok;
    }
    setBusy(false);
    if (ok) onDone?.(checked);
  };

  return (
    <>
      <p className="muted small consent-lead">
        Twoje dane widzi tylko Twój trener. Zaznacz, na co się zgadzasz — każdą zgodę wycofasz w każdej chwili w Ustawieniach → Moje dane.
      </p>
      <ul className="consent-list">
        {only.map((k) => (
          <li key={k}>
            <label className="consent-check">
              <input type="checkbox" checked={!!checked[k]} disabled={readOnly || busy} onChange={(e) => setChecked((c) => ({ ...c, [k]: e.target.checked }))} />
              <span>
                <b>Zgadzam się: {CONSENT_TEXT[k].title.toLowerCase()}</b>
                <span className="muted small">{CONSENT_TEXT[k].short}</span>
                {k === 'health' && <span className="muted small">Podstawa: Twoja wyraźna zgoda (art. 9 ust. 2 lit. a RODO).</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {only.length > 1 && (
        <p className="muted small consent-push">
          <Icon name="alert" size={14} /> Powiadomienia push włączasz osobno w Ustawieniach — telefon sam zapyta o zgodę.
        </p>
      )}
      <button type="button" className="link consent-more" onClick={onMore}>
        Więcej — kto jest administratorem i jakie masz prawa
      </button>
      {readOnly && <p className="small warn-text">Podgląd trenera — zgody zaznacza i zmienia tylko podopieczny na swoim koncie.</p>}
      <div className="consent-actions">
        {onLater && (
          <button type="button" className="btn btn-ghost" onClick={onLater} disabled={busy}>
            Później
          </button>
        )}
        <button type="button" className="btn btn-primary btn-lg" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Zapisuję…' : saveLabel}
        </button>
      </div>
    </>
  );
}

function ConsentSettings({ client, only, readOnly, onMore }: { client: Client; only: ConsentKind[]; readOnly?: boolean; onMore: () => void }) {
  const { ask } = useStore();
  const save = useConsentSave(client);
  const [busy, setBusy] = useState<ConsentKind | null>(null);

  const toggle = async (k: ConsentKind) => {
    if (readOnly || busy) return;
    const on = consentState(client, k) === 'on';
    if (on) {
      const sure = await ask(
        k === 'health'
          ? 'Wycofać zgodę na dane o zdrowiu? Ankieta zdrowotna, ból i samopoczucie przestaną być zbierane, a trener dostanie prośbę o usunięcie tych danych. Bez nich trener nie dopasuje bezpiecznie obciążeń.'
          : 'Wycofać zgodę na zdjęcia i nagrania? Zdjęcia sylwetki i nagrania techniki zostaną wyłączone, a trener dostanie prośbę o usunięcie dotychczasowych.',
        { confirm: 'Wycofaj zgodę' },
      );
      if (!sure) return;
    }
    setBusy(k);
    await save(k, !on, { note: on, message: on ? 'Zgoda wycofana — trener dostał wiadomość.' : 'Zgoda zapisana.' });
    setBusy(null);
  };

  return (
    <>
      <ul className="consent-rows">
        {only.map((k) => {
          const st = consentState(client, k);
          const when = fmtWhen(consentDate(client, k));
          const id = `consent-${k}`;
          return (
            <li key={k} className="consent-row">
              <span className="consent-text">
                <b id={id}>{CONSENT_TEXT[k].title}</b>
                <span className={`small ${st === 'on' ? 'ok-text' : st === 'off' ? 'warn-text' : 'muted'}`}>
                  {st === 'on' ? `Zgoda udzielona ${when}` : st === 'off' ? `Brak zgody${when ? ` — wycofana ${when}` : ''}` : 'Jeszcze nie zdecydowano'}
                </span>
                {st !== 'on' && <span className="muted small">{CONSENT_TEXT[k].needed}</span>}
              </span>
              <button
                type="button"
                role="switch"
                className={`push-switch ${st === 'on' ? 'on' : ''}`}
                aria-checked={st === 'on'}
                aria-labelledby={id}
                disabled={readOnly || !!busy}
                onClick={() => void toggle(k)}
              >
                <i />
              </button>
            </li>
          );
        })}
        <li className="consent-row">
          <span className="consent-text">
            <b>Powiadomienia push</b>
            <span className="muted small">Zgodę daje przeglądarka telefonu — włączasz i wyłączasz je przełącznikiem „Powiadomienia na tym telefonie”.</span>
          </span>
        </li>
      </ul>
      {readOnly && <p className="small muted">Zgody zmienia tylko podopieczny na swoim koncie.</p>}
      <button type="button" className="link consent-more" onClick={onMore}>
        Klauzula informacyjna RODO
      </button>
    </>
  );
}

/** Pełna klauzula informacyjna (art. 13 RODO). */
export function ClauseSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet label="Klauzula informacyjna" onClose={onClose}>
      <div className="between">
        <h2>Twoje dane — klauzula informacyjna</h2>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          Zamknij
        </button>
      </div>
      <div className="clause">
        <h4>Administrator</h4>
        <p>
          {ADMIN.name}
          {ADMIN.nip ? `, NIP ${ADMIN.nip}` : ''}, {ADMIN.address}. Kontakt: <a href={`mailto:${ADMIN.email}`}>{ADMIN.email}</a> albo wiadomością w aplikacji.
        </p>
        <h4>Cel i podstawa prawna</h4>
        <ul>
          <li>Prowadzenie treningów personalnych, plan, historia treningów, kontakt z trenerem i wizyty — wykonanie umowy (art. 6 ust. 1 lit. b RODO).</li>
          <li>Dane o zdrowiu (urazy, choroby, ból, ankieta PAR-Q, samopoczucie) — Twoja wyraźna zgoda (art. 9 ust. 2 lit. a RODO), żeby bezpiecznie dobrać ćwiczenia i obciążenia.</li>
          <li>Zdjęcia sylwetki i nagrania techniki — Twoja zgoda (art. 6 ust. 1 lit. a RODO).</li>
          <li>Rozliczenia (płatności) — obowiązki podatkowe i rachunkowe (art. 6 ust. 1 lit. c RODO).</li>
        </ul>
        <h4>Odbiorcy</h4>
        <ul>
          <li>Supabase (hosting bazy danych i plików aplikacji) — dostawca działa na podstawie umowy powierzenia; serwer: {ADMIN.hostingRegion}.</li>
          <li>FormSubmit — przekazuje Twoje wiadomości z aplikacji na e-mail trenera.</li>
          <li>Usługi powiadomień przeglądarki (Google, Apple, Mozilla) — tylko gdy włączysz powiadomienia push.</li>
        </ul>
        <p>Danych nie sprzedajemy ani nie udostępniamy w celach marketingowych.</p>
        <h4>Jak długo</h4>
        <p>
          Przez czas współpracy, a po jej zakończeniu przez {ADMIN.retention} — żebyś miał(a) dostęp do swojej historii — albo krócej, jeśli poprosisz o usunięcie. Dane
          z Twojej zgody — do jej wycofania. Dokumenty rozliczeniowe — 5 lat od końca roku podatkowego (przepisy podatkowe).
        </p>
        <h4>Twoje prawa</h4>
        <p>
          Masz prawo do: dostępu do danych i ich kopii, sprostowania, usunięcia, ograniczenia przetwarzania, przenoszenia (plik JSON w „Moje dane”), sprzeciwu oraz wycofania zgody w każdej chwili — bez wpływu na zgodność
          z prawem przetwarzania przed wycofaniem. Możesz złożyć skargę do Prezesa Urzędu Ochrony Danych Osobowych (ul. Stawki 2, 00-193 Warszawa, uodo.gov.pl).
        </p>
        <h4>Dobrowolność</h4>
        <p>
          Podanie danych jest dobrowolne, ale bez danych kontaktowych i treningowych nie poprowadzimy treningów. Bez zgody na dane o zdrowiu trener nie zbierze ankiety zdrowotnej. Aplikacja liczy pomocnicze wskaźniki
          (np. gotowość, obciążenie), ale decyzje podejmuje trener — nie ma decyzji wyłącznie zautomatyzowanych.
        </p>
      </div>
    </Sheet>
  );
}
