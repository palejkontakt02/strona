import { useEffect, useState } from 'react';
import { supabase } from '../data/supabase';
import { Screen, errorText } from './AuthGate';

const KEY = 'fitowa-oauth-authorization-id';

/**
 * Zgoda na połączenie zewnętrznej aplikacji (np. Claude) z kontem Fitowej — serwer OAuth 2.1 w Supabase Auth.
 * Supabase przekierowuje tu z parametrem `authorization_id`; zapamiętujemy go na czas logowania.
 */
export function pendingAuthorizationId(): string | null {
  try {
    const q = new URLSearchParams(location.search).get('authorization_id');
    if (q) {
      sessionStorage.setItem(KEY, q);
      history.replaceState(null, '', location.pathname);
      return q;
    }
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

const forget = () => {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* brak pamięci sesji */
  }
};

type Details = { client: { name: string; uri?: string }; user: { email: string }; redirect_uri: string };

export function OAuthConsent({ authorizationId, onDone }: { authorizationId: string; onDone: () => void }) {
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void supabase.auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error: e }) => {
      if (!live) return;
      if (e || !data) return setError(e ? errorText(e) : 'Nie znaleziono prośby o połączenie.');
      if (!('authorization_id' in data)) {
        forget();
        location.assign(data.redirect_url);
        return;
      }
      setDetails(data as Details);
    });
    return () => {
      live = false;
    };
  }, [authorizationId]);

  const decide = async (ok: boolean) => {
    setBusy(true);
    const r = ok
      ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
    forget();
    if (r.error || !r.data) {
      setBusy(false);
      return setError(r.error ? errorText(r.error) : 'Nie udało się zapisać decyzji.');
    }
    location.assign(r.data.redirect_url);
  };

  if (error)
    return (
      <Screen title="Połączenie nie wyszło">
        <p>{error}</p>
        <p className="muted small">Prośba mogła wygasnąć (ważna 10 minut). Zacznij dodawanie łącznika w Claude od nowa.</p>
        <div className="actions">
          <button
            className="btn btn-ghost"
            onClick={() => {
              forget();
              onDone();
            }}
          >
            Przejdź do aplikacji
          </button>
        </div>
      </Screen>
    );
  if (!details) return <div className="center-screen muted">Wczytywanie…</div>;

  const name = details.client.name || 'Zewnętrzna aplikacja';
  return (
    <Screen title={`Połączyć ${name} z Fitową?`}>
      <p>
        <strong>{name}</strong> chce czytać dane z konta <strong>{details.user.email}</strong>:
      </p>
      <ul className="oauth-list">
        <li>plan treningowy i zaplanowane wizyty,</li>
        <li>zapisane treningi, serie, ciężary i samopoczucie,</li>
        <li>pomiary, raporty tygodniowe, żywienie i nawyki,</li>
        <li>historię płatności.</li>
      </ul>
      <p className="muted small">
        Tylko odczyt: łącznik niczego nie zmienia w aplikacji. Widzi wyłącznie Twoje dane. To dane o zdrowiu, więc po zgodzie trafią do dostawcy tej aplikacji (dla Claude to Anthropic) i będą
        przetwarzane według jego zasad. Dostęp odbierzesz w każdej chwili, usuwając łącznik w ustawieniach Claude.
      </p>
      <p className="muted small">Po zgodzie wrócisz do: {details.redirect_uri}</p>
      <div className="actions">
        <button className="btn btn-primary" disabled={busy} onClick={() => void decide(true)}>
          Zezwól
        </button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => void decide(false)}>
          Odmów
        </button>
      </div>
    </Screen>
  );
}
