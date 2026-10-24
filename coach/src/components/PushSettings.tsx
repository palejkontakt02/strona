import { useEffect, useState } from 'react';
import { useStore } from '../data/store';
import { currentSubscription, disablePush, enablePush, pushSupport } from '../data/push';

const WHAT = {
  trainer: 'Nowe wiadomości od podopiecznych, ankiety, raporty tygodniowe i treningi z bólem od 5/10.',
  client: 'Odpowiedzi trenera, komentarze do treningów, nowe treningi i wizyty, a rano „Masz dziś trening”.',
};

/** Przełącznik „Powiadomienia na tym telefonie” (Web Push). Bez konfiguracji (brak klucza) — nic nie pokazuje. */
export function PushSettings({ role }: { role: 'trainer' | 'client' }) {
  const { cloud, toast } = useStore();
  const support = pushSupport();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (support !== 'ok' || !cloud) return;
    let live = true;
    void currentSubscription().then((s) => live && setOn(!!s && Notification.permission === 'granted'));
    return () => {
      live = false;
    };
  }, [support, cloud]);

  if (support === 'off') return null;

  const blocked = support === 'ok' && Notification.permission === 'denied';
  const why = !cloud
    ? 'Działa po zalogowaniu w aplikacji online (teraz dane są tylko w tej przeglądarce).'
    : support === 'ios-install'
      ? 'Na iPhonie powiadomienia działają tylko z ikony na ekranie początkowym: w Safari stuknij Udostępnij → „Do ekranu początkowego”, otwórz aplikację z tej ikony i włącz tutaj (iOS 16.4 lub nowszy).'
      : support === 'unsupported'
        ? 'Ta przeglądarka nie obsługuje powiadomień. Na Androidzie użyj Chrome, na iPhonie — aplikacji dodanej do ekranu początkowego.'
        : blocked
          ? 'Powiadomienia są zablokowane dla tej strony — odblokuj je w ustawieniach przeglądarki (ikona kłódki przy adresie) albo telefonu.'
          : '';
  const can = cloud && support === 'ok' && !blocked;

  const toggle = async () => {
    if (!can || busy) return;
    setBusy(true);
    setNote('');
    try {
      if (on) {
        await disablePush();
        setOn(false);
        toast('Powiadomienia wyłączone na tym urządzeniu.');
      } else {
        const r = await enablePush();
        if (r === 'ok') {
          setOn(true);
          toast('Powiadomienia włączone na tym urządzeniu.');
        } else
          setNote(
            r === 'denied'
              ? 'Bez zgody na powiadomienia nie da się ich włączyć — zezwól, gdy przeglądarka zapyta.'
              : r === 'db'
                ? 'Baza wymaga aktualizacji po stronie trenera (Supabase, sekcja 20 w hardening.sql).'
                : r === 'no-sw'
                  ? 'Aplikacja nie jest jeszcze gotowa do pracy w tle — odśwież stronę i spróbuj ponownie.'
                  : 'Nie udało się włączyć powiadomień — sprawdź połączenie i spróbuj ponownie.',
          );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="push-settings">
      <h4 className="form-section">Powiadomienia</h4>
      <div className="push-row">
        <div className="push-text">
          <strong id={`push-label-${role}`}>Powiadomienia na tym telefonie</strong>
          <span className="muted small">{WHAT[role]}</span>
        </div>
        <button
          type="button"
          role="switch"
          className={`push-switch ${on ? 'on' : ''}`}
          aria-checked={!!on}
          aria-labelledby={`push-label-${role}`}
          disabled={!can || busy || on === null}
          onClick={() => void toggle()}
        >
          <i />
        </button>
      </div>
      {(why || note) && <p className="small push-why">{note || why}</p>}
    </div>
  );
}
