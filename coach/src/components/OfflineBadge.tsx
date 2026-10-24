import { useEffect, useState } from 'react';
import { useStore } from '../data/store';

/** Dyskretna plakietka: zapisy zrobione bez internetu czekają na wysłanie. Stuknięcie — spróbuj teraz. */
export function OfflineBadge() {
  const { pending, sendPending } = useStore();
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  if (!pending) return null;
  return (
    <button
      type="button"
      className={`offline-badge ${online ? '' : 'is-offline'}`}
      onClick={sendPending}
      title={online ? 'Stuknij, by wysłać teraz' : 'Brak internetu — wyślę automatycznie, gdy wróci połączenie'}
      aria-label={`Czeka na wysłanie (${pending})${online ? ' — wyślij teraz' : ' — brak internetu'}`}
    >
      <i aria-hidden="true" />
      Czeka na wysłanie ({pending})
    </button>
  );
}
