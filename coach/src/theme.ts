/**
 * Motywy kolorystyczne (zapisywane na tym urządzeniu). Domyślnie czarno-biały: „Biały” albo „Czarny”
 * według ustawienia jasny / ciemny w telefonie. Kolor w nich tylko dla stanów (ok / uwaga / błąd).
 */
export const PALETTES = [
  { id: 'biel', name: 'Biały', bg: '#f3f3f3', accent: '#111111' },
  { id: 'mono', name: 'Czarny', bg: '#000000', accent: '#f5f5f5' },
  { id: 'kobalt', name: 'Kobalt', bg: '#0e1726', accent: '#5b8cff' },
  { id: 'morski', name: 'Morski', bg: '#0f1b1e', accent: '#3cc4ad' },
  { id: 'grafit', name: 'Grafit', bg: '#19191b', accent: '#f0a43a' },
  { id: 'fiolet', name: 'Fiolet', bg: '#161826', accent: '#9184d9' },
  { id: 'jasny', name: 'Jasny', bg: '#f1f4f9', accent: '#2f5fe0' },
] as const;
export type PaletteId = (typeof PALETTES)[number]['id'];

// v2: przejście na czarno-biały — wcześniejszy wybór (domyślny Kobalt) nie przenosi się
const KEY = 'fitowa-palette2';

export function getPalette(): PaletteId {
  try {
    const v = localStorage.getItem(KEY);
    if (PALETTES.some((p) => p.id === v)) return v as PaletteId;
  } catch {
    // brak localStorage — motyw domyślny
  }
  return systemPalette();
}

/** Bez własnego wyboru: jasny albo ciemny czarno-biały, jak w ustawieniach telefonu. */
export function systemPalette(): PaletteId {
  try {
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'mono' : 'biel';
  } catch {
    return 'biel';
  }
}

/** Czy użytkownik sam wybrał motyw (wtedy nie podążamy za zmianą jasny / ciemny w telefonie). */
export function hasOwnPalette(): boolean {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

export function applyPalette(id: PaletteId) {
  const root = document.documentElement;
  if (id === 'jasny') delete root.dataset.palette;
  else root.dataset.palette = id;
  const p = PALETTES.find((x) => x.id === id)!;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.bg);
}

export function setPalette(id: PaletteId) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // motyw zadziała do zamknięcia karty
  }
  applyPalette(id);
}
