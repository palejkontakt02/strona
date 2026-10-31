/**
 * Ankieta startowa „Uzupełnię później”: data odłożenia zapamiętana na urządzeniu (localStorage),
 * na Dziś przypomina karta, a pełny ekran ankiety wraca najwcześniej po 3 dniach.
 */
export const INTAKE_LATER_KEY = (clientId: string) => `fitowa-intake-later:${clientId}`;
export const INTAKE_FULL_AFTER_DAYS = 3;

/** Odczyt zapisanej daty (ISO). Stara wartość „1” albo śmieci → brak daty. */
export function parseLater(v: string | null | undefined): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}/.test(v) || Number.isNaN(Date.parse(v))) return null;
  return v;
}

/** Czy pokazać ankietę na pełnym ekranie przy starcie (odłożona ≥ 3 dni temu albo wcale). */
export function intakeFullDue(later: string | null, now: Date = new Date()): boolean {
  if (!later) return true;
  return now.getTime() - Date.parse(later) >= INTAKE_FULL_AFTER_DAYS * 86_400_000;
}

export function readLater(clientId: string): string | null {
  try {
    return parseLater(localStorage.getItem(INTAKE_LATER_KEY(clientId)));
  } catch {
    return null;
  }
}

export function storeLater(clientId: string, now: Date = new Date()): void {
  try {
    localStorage.setItem(INTAKE_LATER_KEY(clientId), now.toISOString());
  } catch {
    // brak localStorage — przypomnienie tylko na Dziś
  }
}
