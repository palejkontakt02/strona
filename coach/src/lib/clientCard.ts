import type { LiftRecord, RecordReps } from './strength';

/* Drobne reguły karty podopiecznego (Monitoring, Przegląd). */

/**
 * Wiersz „1RM / 3RM / 5RM” w tabeli rekordów. 1RM to tylko prawdziwa seria pojedyncza — najcięższa seria
 * „92,5 kg × 3” nie jest 1RM (jej szacowane maks. jest w kolumnie e1RM i w wierszu „Najlepszy e1RM”).
 * 3RM / 5RM — najcięższa seria na co najmniej 3 / 5 powtórzeń.
 */
export function recordRow(n: RecordReps, r: LiftRecord | null): LiftRecord | null {
  if (!r) return null;
  if (n === 1 && r.reps !== 1) return null;
  return r;
}

/** „Pierwsze kroki” chowają się same, gdy podopieczny ma co najmniej tyle zapisanych treningów. */
export const ONBOARDING_HIDE_AFTER = 3;
export const onboardingAutoHidden = (sessions: number) => sessions >= ONBOARDING_HIDE_AFTER;
