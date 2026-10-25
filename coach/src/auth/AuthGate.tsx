import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { App } from '../App';
import { ClientEntry } from './ClientEntry';
import { cloudMode } from '../data/config';
import { createLocalRepository } from '../data/localRepository';
import { createEmpty } from '../data/seed';
import { StoreProvider } from '../data/store';
import { supabase } from '../data/supabase';
import { createSupabaseRepository } from '../data/supabaseRepository';
import type { Db } from '../data/db';
import { LoginScreen, NewPassword } from './LoginScreen';

/** Punkt wejścia: lokalnie (podgląd) bez logowania, na stronie — logowanie przez Supabase. */
export function Root() {
  const local = useMemo(() => (cloudMode() ? null : createLocalRepository()), []);
  // podgląd lokalny konta podopiecznego (zgody, tryb „współpraca zakończona”): ?athlete=<id klienta>
  const athlete = useMemo(() => (local ? new URLSearchParams(location.search).get('athlete') : null), [local]);
  if (local && athlete)
    return (
      <StoreProvider repo={local}>
        <ClientEntry clientId={athlete} onExit={() => location.assign(location.pathname)} />
      </StoreProvider>
    );
  if (local)
    return (
      <StoreProvider repo={local}>
        <App />
      </StoreProvider>
    );
  return <CloudGate />;
}

function CloudGate() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setSession(s);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <div className="center-screen muted">Wczytywanie…</div>;
  if (recovery) return <NewPassword onDone={() => setRecovery(false)} />;
  if (!session) return <LoginScreen />;
  return <RoleGate key={session.user.id} email={session.user.email ?? ''} />;
}

type Role = { kind: 'loading' } | { kind: 'trainer' } | { kind: 'client'; clientId: string } | { kind: 'unclaimed' } | { kind: 'nolink' } | { kind: 'error'; message: string };

const signOut = () => void supabase.auth.signOut();

/** Czytelny opis błędu (błędy Supabase to zwykłe obiekty, nie Error). */
export function errorText(e: unknown): string {
  if (e && typeof e === 'object') {
    const o = e as { message?: string; code?: string; details?: string; hint?: string };
    return [o.code, o.message, o.details, o.hint].filter(Boolean).join(' · ') || JSON.stringify(e);
  }
  return String(e);
}

/** Pusta baza trenera przy pierwszym uruchomieniu: biblioteka ćwiczeń i jedno miejsce. */
const seedEmpty = (db: Db) => (db.library.length || db.clients.length ? null : createEmpty());

function RoleGate({ email }: { email: string }) {
  const [role, setRole] = useState<Role>({ kind: 'loading' });

  const resolve = useCallback(async () => {
    setRole({ kind: 'loading' });
    try {
      const t = await supabase.rpc('is_trainer');
      if (t.error) throw t.error;
      if (t.data) return setRole({ kind: 'trainer' });
      const c = await supabase.from('clients').select('id').limit(1);
      if (c.error) throw c.error;
      if (c.data && c.data.length) return setRole({ kind: 'client', clientId: (c.data[0] as { id: string }).id });
      const ex = await supabase.rpc('trainer_exists');
      if (ex.error) throw ex.error;
      setRole({ kind: ex.data ? 'nolink' : 'unclaimed' });
    } catch (e) {
      setRole({ kind: 'error', message: errorText(e) });
    }
  }, []);

  useEffect(() => {
    void resolve();
  }, [resolve]);

  const trainerRepo = useMemo(() => createSupabaseRepository('trainer'), []);
  const clientRepo = useMemo(() => createSupabaseRepository('client'), []);

  switch (role.kind) {
    case 'loading':
      return <div className="center-screen muted">Wczytywanie…</div>;
    case 'trainer':
      return (
        <StoreProvider repo={trainerRepo} cloud signOut={signOut} onEmpty={seedEmpty}>
          <App />
        </StoreProvider>
      );
    case 'client':
      return (
        <StoreProvider repo={clientRepo} cloud signOut={signOut}>
          <ClientEntry clientId={role.clientId} onExit={signOut} />
        </StoreProvider>
      );
    case 'unclaimed':
      return (
        <Screen title="Pierwsze uruchomienie">
          <p>
            W aplikacji nie ma jeszcze trenera. Jeśli to Ty prowadzisz treningi, stuknij poniżej — konto <strong>{email}</strong> dostanie pełny dostęp do panelu.
          </p>
          <p className="muted small">Robi się to tylko raz. Każda kolejna osoba, która założy konto, będzie klientem.</p>
          <div className="actions">
            <button
              className="btn btn-primary"
              onClick={async () => {
                const r = await supabase.rpc('claim_trainer');
                if (r.error) setRole({ kind: 'error', message: r.error.message });
                else void resolve();
              }}
            >
              Jestem trenerem
            </button>
            <button className="btn btn-ghost" onClick={signOut}>
              Wyloguj
            </button>
          </div>
        </Screen>
      );
    case 'nolink':
      return (
        <Screen title="Prawie gotowe">
          <p>
            Twoje konto <strong>{email}</strong> nie jest jeszcze połączone z profilem u trenera.
          </p>
          <p className="muted">Poproś trenera, żeby wpisał ten adres e-mail w Twoim profilu w aplikacji. Potem stuknij „Sprawdź ponownie”.</p>
          <div className="actions">
            <button className="btn btn-primary" onClick={() => void resolve()}>
              Sprawdź ponownie
            </button>
            <button className="btn btn-ghost" onClick={signOut}>
              Wyloguj
            </button>
          </div>
        </Screen>
      );
    case 'error':
      return (
        <Screen title="Coś poszło nie tak">
          <p className="muted">Nie udało się połączyć z bazą. Sprawdź internet i spróbuj ponownie.</p>
          <p className="muted small">{role.message}</p>
          <div className="actions">
            <button className="btn btn-primary" onClick={() => void resolve()}>
              Spróbuj ponownie
            </button>
            <button className="btn btn-ghost" onClick={signOut}>
              Wyloguj
            </button>
          </div>
        </Screen>
      );
  }
}

export function Screen({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="auth-split">
      <aside className="auth-hero" aria-hidden="true">
        <div className="auth-logo">
          Fitowa <span>/ coach</span>
        </div>
        <div className="auth-sheet">
          <div className="auth-sheet-band">
            <span>Tydzień 3 · siła</span>
            <span>pon</span>
          </div>
          <div className="auth-sheet-row done">
            <span>Przysiad ze sztangą</span>
            <b>4 × 6</b>
            <b>100 kg</b>
            <i>✓</i>
          </div>
          <div className="auth-sheet-row done">
            <span>Wyciskanie leżąc</span>
            <b>4 × 8</b>
            <b>72,5 kg</b>
            <i>✓</i>
          </div>
          <div className="auth-sheet-row next">
            <span>Martwy ciąg rumuński</span>
            <b>3 × 10</b>
            <b>80 kg</b>
            <i />
          </div>
          <div className="auth-sheet-row">
            <span>Podciąganie</span>
            <b>3 × 8</b>
            <b>+10 kg</b>
            <i />
          </div>
        </div>
        <div className="auth-claim">
          <h1>
            Trenuj
            <br />
            z planem.
            <br />
            <em>Wracaj silniejszy.</em>
          </h1>
          <ul className="auth-points">
            <li>
              <b>01</b> Plan na każdy tydzień
            </li>
            <li>
              <b>02</b> Seria po serii, z podpowiedzią ciężaru
            </li>
            <li>
              <b>03</b> Postęp, obciążenie i samopoczucie
            </li>
          </ul>
        </div>
        <p className="auth-sign">Sebastian Palej · S&amp;C · Return to Sport · Kraków</p>
      </aside>
      <main className="auth-side">
        <div className="auth-card">
          <div className="auth-logo auth-logo-mobile">
            Fitowa <span>/ coach</span>
          </div>
          <h2 className="auth-h">{title}</h2>
          {children}
        </div>
      </main>
    </div>
  );
}
