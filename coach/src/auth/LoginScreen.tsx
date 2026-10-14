import { useState } from 'react';
import { supabase } from '../data/supabase';
import { Screen } from './AuthGate';

const REDIRECT = () => `${location.origin}/app/`;

function plError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login')) return 'Nieprawidłowy e-mail lub hasło.';
  if (m.includes('email not confirmed')) return 'Najpierw potwierdź adres e-mail — kliknij link w wiadomości, którą wysłaliśmy.';
  if (m.includes('already registered') || m.includes('already been registered')) return 'Konto z tym adresem już istnieje — zaloguj się.';
  if (m.includes('password should be') || m.includes('at least')) return 'Hasło musi mieć co najmniej 8 znaków.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Zbyt wiele prób. Odczekaj chwilę i spróbuj ponownie.';
  if (m.includes('invalid email') || m.includes('unable to validate email')) return 'Sprawdź adres e-mail.';
  return message;
}

export function LoginScreen() {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      if (mode === 'login') {
        const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (e) throw e;
      } else if (mode === 'signup') {
        if (password.length < 8) throw new Error('password should be at least 8');
        const { data, error: e } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: REDIRECT(), data: { consent_health_at: new Date().toISOString(), privacy_version: '2026-10' } } });
        if (e) throw e;
        if (!data.session) setInfo(`Wysłaliśmy link potwierdzający na ${email.trim()}. Kliknij go, a potem zaloguj się tutaj.`);
      } else {
        const { error: e } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: REDIRECT() });
        if (e) throw e;
        setInfo('Jeśli konto istnieje, wysłaliśmy link do ustawienia nowego hasła.');
      }
    } catch (e) {
      setError(plError(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={mode === 'login' ? 'Zaloguj się' : mode === 'signup' ? 'Załóż konto' : 'Nowe hasło'}>
      {mode !== 'reset' && (
        <div className="seg">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
            Logowanie
          </button>
          <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>
            Nowe konto
          </button>
        </div>
      )}
      <form
        className="auth-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="field">
          <span>E-mail</span>
          <input id="auth-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        {mode !== 'reset' && (
          <label className="field">
            <span>Hasło{mode === 'signup' ? ' (min. 8 znaków)' : ''}</span>
            <input
              id="auth-password"
              className="input"
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === 'signup' ? 8 : undefined}
            />
          </label>
        )}
        {mode === 'signup' && (
          <label className="check consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
            <span>
              Zapoznałem(-am) się z{' '}
              <a href="/polityka-prywatnosci.html" target="_blank" rel="noreferrer">
                polityką prywatności
              </a>{' '}
              i zgadzam się na przetwarzanie moich danych, w tym danych o zdrowiu (urazy, ból, samopoczucie), w celu prowadzenia treningów.
            </span>
          </label>
        )}
        {error && <p className="auth-error">{error}</p>}
        {info && <p className="auth-info">{info}</p>}
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy || (mode === 'signup' && !consent)}>
          {busy ? 'Chwila…' : mode === 'login' ? 'Zaloguj' : mode === 'signup' ? 'Załóż konto' : 'Wyślij link'}
        </button>
      </form>
      {mode === 'login' && (
        <button type="button" className="link small" onClick={() => setMode('reset')}>
          Nie pamiętam hasła
        </button>
      )}
      {mode === 'reset' && (
        <button type="button" className="link small" onClick={() => setMode('login')}>
          ‹ Wróć do logowania
        </button>
      )}
    </Screen>
  );
}

export function NewPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Screen title="Ustaw nowe hasło">
      <form
        className="auth-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const { error: err } = await supabase.auth.updateUser({ password });
          setBusy(false);
          if (err) setError(plError(err.message));
          else onDone();
        }}
      >
        <label className="field">
          <span>Nowe hasło (min. 8 znaków)</span>
          <input id="auth-new-password" className="input" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="auth-error">{error}</p>}
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
          Zapisz hasło
        </button>
      </form>
    </Screen>
  );
}
