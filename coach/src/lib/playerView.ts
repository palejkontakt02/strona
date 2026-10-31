import type { Appointment } from '../domain';

/** Okno wokół startu treningu, w którym wizyta oznacza trening z trenerem (ms). */
export const VISIT_WINDOW_MS = 2 * 60 * 60 * 1000;

const localIso = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Podsumowanie treningu podopiecznego: domyślnie „Samodzielnie”. „Z trenerem” tylko wtedy, gdy wizyta
 * (nieodwołana) zaczyna się w oknie ±2 h od startu treningu. Trening wpisywany po fakcie (start nie tego dnia,
 * którego dotyczy trening) — godziny nie da się porównać, więc wystarczy wizyta tego dnia.
 */
export function soloByDefault(appointments: Pick<Appointment, 'clientId' | 'date' | 'time' | 'status'>[], clientId: string, date: string, startedAt: number): boolean {
  const day = appointments.filter((a) => a.clientId === clientId && a.date === date && a.status !== 'cancel' && a.status !== 'noshow');
  if (!day.length) return true;
  if (localIso(startedAt) !== date) return false;
  return !day.some((a) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(a.time || '');
    if (!m) return false;
    const at = new Date(`${a.date}T${m[1].padStart(2, '0')}:${m[2]}:00`).getTime();
    return Math.abs(at - startedAt) <= VISIT_WINDOW_MS;
  });
}

/** Liczba do wyświetlenia po polsku: „62.5” → „62,5” (pola przyjmują oba zapisy). */
export const commaNum = (v: string | undefined | null): string => (v ? v.replace(/(\d)\.(\d)/g, '$1,$2') : '');

/** Instrukcja wpisywania wyników na wierzchu tylko przy pierwszych treningach podopiecznego. */
export const showRunHelp = (savedWorkouts: number) => savedWorkouts < 2;
