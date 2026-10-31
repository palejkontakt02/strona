/** Imiona męskie zakończone na „a” (reszta imion na „a” — żeńskie). */
const MALE_A = new Set(['kuba', 'barnaba', 'kosma', 'bonawentura', 'jarema', 'dyzma', 'sasza', 'misza', 'nikita', 'luca', 'ilja', 'saba']);

/**
 * Forma żeńska w tekstach („Zapłaciłam”, „Biegłam”): pole płci z profilu klienta, jeśli jest
 * (`sex`/`gender`: k / m), a bez niego — z imienia (polskie imiona żeńskie kończą się na „a”).
 */
export function isFemale(c: { name?: string; sex?: unknown; gender?: unknown }): boolean {
  const s = String(c.sex ?? c.gender ?? '').trim().toLowerCase();
  if (/^(k|f|kobieta|female|ona)$/.test(s)) return true;
  if (/^(m|mężczyzna|male|on)$/.test(s)) return false;
  const first = (c.name ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return first.length > 1 && first.endsWith('a') && !MALE_A.has(first);
}

/** „Zapłaciłam” / „Zapłaciłem”. */
export const pastForm = (c: Parameters<typeof isFemale>[0], fem: string, masc: string) => (isFemale(c) ? fem : masc);
