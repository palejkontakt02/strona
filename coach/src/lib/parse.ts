/** Liczba z pola formularza (akceptuje przecinek, spacje tysięcy i jednostkę na końcu, np. „100 kg”). */
export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  // „1 500”, „1 500,50”, „1.500,00” → 1500 / 1500,5 / 1500; tekst, który nie jest liczbą → null.
  let t = String(v ?? '').trim().replace(/[\s\u00a0\u202f]/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '');
  t = t.replace(',', '.');
  const m = t.match(/^[-+]?(\d+\.?\d*|\.\d+)/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isNaN(n) ? null : n;
}

/** Pierwsza liczba z zapisu powtórzeń, np. „8–10” → 8, „45 s” → 45. */
export function repsN(r: unknown): number | null {
  const m = String(r ?? '').match(/\d+(?:[.,]\d+)?/);
  return m ? num(m[0]) : null;
}

/**
 * Przerwa w sekundach: „2:00” → 120; liczba ≤5 lub z „min”/„'” → minuty; inaczej sekundy.
 * Puste → 0 (domyślne 120 s ustala wywołujący, `restSeconds`).
 */
export function parseRest(s: string | undefined | null): number {
  if (!s) return 0;
  const m = String(s).match(/(\d+):(\d{1,2})/);
  if (m) return +m[1] * 60 + +m[2];
  const n = num(s);
  if (n == null) return 0;
  return /min|'/.test(s) || n <= 5 ? Math.round(n * 60) : n;
}

export const DEFAULT_REST_S = 120;

export function restSeconds(s: string | undefined | null): number {
  return parseRest(s) || DEFAULT_REST_S;
}

/** Tempo z uwag, np. „3-1-X-0” → [3, 1, 1, 0] (X = 1 s). Fazy: opuszczanie, pauza w dole, podnoszenie, pauza w górze. */
export function parseTempo(s: string | undefined | null): [number, number, number, number] | null {
  const m = String(s || '').match(/([0-9xX])\s*-\s*([0-9xX])\s*-\s*([0-9xX])\s*-\s*([0-9xX])/);
  if (!m) return null;
  return m.slice(1).map((v) => (/x/i.test(v) ? 1 : +v)) as [number, number, number, number];
}

/** Liczba z pola z zakresu [min, max]; poza zakresem albo nie-liczba → null. */
export function numIn(v: unknown, min: number, max: number): number | null {
  const n = num(v);
  return n != null && n >= min && n <= max ? n : null;
}

/** Powtórzenia serii jako liczba; kompleks „2+1” → 3. */
export function sumReps(v: unknown): number | null {
  const t = String(v ?? '').replace(/\s/g, '');
  if (/^\d+(\+\d+)+$/.test(t)) return t.split('+').reduce((a, x) => a + parseInt(x, 10), 0);
  return numIn(t, 0, 10000);
}
