/** Bateria testów sprawnościowych z prototypu. */
export const TEST_CATALOGUE = [
  '1RM przysiad',
  '1RM martwy ciąg',
  '1RM wyciskanie leżąc',
  '1RM rwanie',
  '1RM podrzut',
  'CMJ (cm)',
  'Squat jump (cm)',
  'RSI 10/5',
  'Sprint 10 m (s)',
  'Sprint 30 m (s)',
  '505 COD (s)',
  'IMTP (N)',
  'Single hop (cm)',
  'Triple hop (cm)',
  'Crossover hop (cm)',
  '6 m timed hop (s)',
  'Y-balance (%)',
  'Izometria czworogłowego (Nm)',
  'Izometria kulszowo-goleniowych (Nm)',
  'Zgięcie kolana ROM (°)',
  'Wyprost kolana ROM (°)',
  'Knee-to-wall (cm)',
  'Czas 5 km',
  'VO2max (ml/kg/min)',
  'Tętno spoczynkowe',
] as const;

/**
 * LSI (%) z wyniku lewej i prawej strony, zaokrąglone do 0,1.
 * Bez wskazanej kończyny: słabsza / silniejsza × 100.
 * Ze wskazaną kończyną operowaną: operowana / zdrowa × 100.
 * Dla testów „niższy = lepszy” (np. czas) odwrotnie.
 */
export function computeLsi(
  left: number,
  right: number,
  opts: { involved?: 'L' | 'P'; lowerIsBetter?: boolean } = {},
): number | null {
  if (!(left > 0) || !(right > 0)) return null;
  const lower = !!opts.lowerIsBetter;
  let inv: number;
  let uninv: number;
  if (opts.involved === 'L') {
    inv = left;
    uninv = right;
  } else if (opts.involved === 'P') {
    inv = right;
    uninv = left;
  } else {
    inv = lower ? Math.max(left, right) : Math.min(left, right);
    uninv = lower ? Math.min(left, right) : Math.max(left, right);
  }
  return Math.round((lower ? uninv / inv : inv / uninv) * 1000) / 10;
}

/** Siła względna = wynik / masa ciała. */
export function relativeStrength(value: number, bodyWeight: number | null | undefined): number | null {
  return bodyWeight ? value / bodyWeight : null;
}
