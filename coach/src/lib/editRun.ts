import type { TrainingSession } from '../domain';
import { runToExercises, type Run } from './run';

/** JSON z posortowanymi kluczami i bez pól `undefined` — porównanie niezależne od kolejności kluczy (jsonb w bazie). */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : stableJson(x))).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v as Record<string, unknown>)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

/**
 * Poprawki zapisanego treningu bez żadnej zmiany względem zapisu (np. zostały po zamknięciu aplikacji
 * na ekranie „Trening zakończony”) — można je po cichu odrzucić, nic nie przepadnie.
 * Brak zapisu w danych (jeszcze się nie wczytał / usunięty) → false (zostawiamy kartę poprawek).
 */
export function isUnchangedEdit(run: Run | null | undefined, saved: TrainingSession | undefined): boolean {
  if (!run?.editSessionId || !saved || saved.id !== run.editSessionId) return false;
  if ((run.name || 'Trening') !== (saved.workoutName || 'Trening') || run.date !== saved.date) return false;
  return stableJson(runToExercises(run)) === stableJson(saved.exercises);
}
