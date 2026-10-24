import type { PainSpot } from '../domain';

/** Widok sylwetki, na którym leży punkt mapy bólu. */
export type PainView = 'front' | 'back';

export interface PainArea {
  /** Nazwa obszaru (zapisywana w PainSpot.area). */
  area: string;
  /** Czy obszar ma stronę L/P. */
  sided: boolean;
  /** Widoki, na których obszar jest zaznaczony na sylwetce. */
  views: PainView[];
}

/** Obszary ciała do mapy bólu (kolejność = kolejność w liście „Dodaj miejsce”, od góry do dołu). */
export const PAIN_AREAS: PainArea[] = [
  { area: 'szyja', sided: false, views: ['front', 'back'] },
  { area: 'bark', sided: true, views: ['front', 'back'] },
  { area: 'klatka piersiowa', sided: false, views: ['front'] },
  { area: 'odcinek piersiowy', sided: false, views: ['back'] },
  { area: 'łokieć', sided: true, views: ['front', 'back'] },
  { area: 'brzuch', sided: false, views: ['front'] },
  { area: 'odcinek lędźwiowy', sided: false, views: ['back'] },
  { area: 'nadgarstek', sided: true, views: ['front', 'back'] },
  { area: 'biodro', sided: true, views: ['front'] },
  { area: 'pachwina', sided: true, views: ['front'] },
  { area: 'pośladek', sided: true, views: ['back'] },
  { area: 'udo – przód', sided: true, views: ['front'] },
  { area: 'udo – tył', sided: true, views: ['back'] },
  { area: 'kolano', sided: true, views: ['front', 'back'] },
  { area: 'goleń', sided: true, views: ['front'] },
  { area: 'łydka', sided: true, views: ['back'] },
  { area: 'ścięgno Achillesa', sided: true, views: ['back'] },
  { area: 'kostka', sided: true, views: ['front'] },
  { area: 'stopa', sided: true, views: ['front'] },
];

export const painArea = (area: string): PainArea | undefined => PAIN_AREAS.find((a) => a.area === area);

/** Klucz punktu: obszar + strona. */
export const spotKey = (s: { area: string; side?: 'L' | 'P' }) => `${s.area}|${s.side || ''}`;

/** „Kolano P”, „Odcinek lędźwiowy”. */
export function painLabel(s: { area: string; side?: 'L' | 'P' }): string {
  const t = s.side ? `${s.area} ${s.side}` : s.area;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const clampLevel = (v: number) => Math.max(0, Math.min(10, Math.round(Number.isFinite(v) ? v : 0)));

/** Ustawia poziom bólu w punkcie (dodaje punkt, jeśli go nie ma). Nie zmienia tablicy wejściowej. */
export function setPainLevel(spots: PainSpot[], area: string, side: 'L' | 'P' | undefined, level: number): PainSpot[] {
  const key = spotKey({ area, side });
  const lv = clampLevel(level);
  const i = spots.findIndex((s) => spotKey(s) === key);
  if (i < 0) return [...spots, side ? { area, side, level: lv } : { area, level: lv }];
  return spots.map((s, j) => (j === i ? { ...s, level: lv } : s));
}

/** Usuwa punkt. */
export const removePain = (spots: PainSpot[], area: string, side?: 'L' | 'P'): PainSpot[] =>
  spots.filter((s) => spotKey(s) !== spotKey({ area, side }));

/** Przełącza punkt: brak → dodaj z poziomem `level`, jest → usuń. */
export function togglePain(spots: PainSpot[], area: string, side: 'L' | 'P' | undefined, level = 5): PainSpot[] {
  const has = spots.some((s) => spotKey(s) === spotKey({ area, side }));
  return has ? removePain(spots, area, side) : setPainLevel(spots, area, side, level);
}

/** Krótki opis do list i alertów: „Kolano P 6, Bark L 3” (od najmocniejszego). */
export function painSummary(spots: PainSpot[] | undefined): string {
  return [...(spots || [])]
    .filter((s) => s.level > 0)
    .sort((a, b) => b.level - a.level)
    .map((s) => `${painLabel(s)} ${s.level}`)
    .join(', ');
}

/** Do zapisu: tylko punkty z poziomem > 0, znane pola. */
export const cleanPainMap = (spots: PainSpot[] | undefined): PainSpot[] =>
  (spots || []).filter((s) => s.area && s.level > 0).map((s) => (s.side ? { area: s.area, side: s.side, level: clampLevel(s.level) } : { area: s.area, level: clampLevel(s.level) }));
