/** Motywy kolorystyczne aplikacji (zapisywane na tym urządzeniu). Domyślny: ciemny „Morski”. */
export const PALETTES = [
  { id: 'morski', name: 'Morski', bg: '#0f1b1e', accent: '#3cc4ad' },
  { id: 'grafit', name: 'Grafit', bg: '#19191b', accent: '#f0a43a' },
  { id: 'fiolet', name: 'Fiolet', bg: '#161826', accent: '#9184d9' },
  { id: 'jasny', name: 'Jasny', bg: '#f3f5f4', accent: '#1f8a78' },
] as const;
export type PaletteId = (typeof PALETTES)[number]['id'];

const KEY = 'fitowa-palette';

export function getPalette(): PaletteId {
  try {
    const v = localStorage.getItem(KEY);
    if (PALETTES.some((p) => p.id === v)) return v as PaletteId;
  } catch {
    // brak localStorage — motyw domyślny
  }
  return 'morski';
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
