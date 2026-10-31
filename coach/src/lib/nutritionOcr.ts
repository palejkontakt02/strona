/**
 * Odczyt zrzutu ekranu z Fitatu przez AI (funkcja Edge „read-screenshot”, supabase/AI.md).
 * Zdjęcie zmniejszamy w przeglądarce (ok. 1200 px dłuższego boku, JPEG), wysyłamy do funkcji, a wynik
 * sprawdzamy jeszcze raz tutaj — liczby trafiają tylko do pól formularza, podopieczny je poprawia i zapisuje.
 * Czyste funkcje (parsowanie, walidacja, wymiary) mają testy: nutritionOcr.test.ts.
 */
import { cloudMode } from '../data/config';
import { MACROS, type MacroKey } from './nutrition';

export const OCR_MAX_SIDE = 1200;
export const OCR_MAX_BYTES = 1.5 * 1024 * 1024;
/** Zakresy jak w funkcji Edge (kcal 0–10 000, makro 0–1000 g), dodatkowo nie więcej niż przyjmie formularz. */
const RANGE: Record<MacroKey, number> = Object.fromEntries(MACROS.map(([k, , , , max]) => [k, Math.min(k === 'kcal' ? 10000 : 1000, max)])) as Record<MacroKey, number>;

export interface OcrResult {
  kcal?: number;
  protein?: number;
  fat?: number;
  carbs?: number;
  /** Data dnia widoczna na zrzucie (RRRR-MM-DD), jeśli była. */
  date?: string;
  confidence: 'high' | 'low';
  note?: string;
  /** Ile odczytów zostało dziś (z funkcji). */
  remaining?: number;
}

/**
 * Odczyt AI działa tylko w chmurze (funkcja Edge w Supabase). Do testów interfejsu lokalnie:
 * localStorage['fitowa-ocr'] = '1' (wywołanie i tak wymaga wdrożonej funkcji albo atrapy w teście).
 */
export function ocrAvailable(): boolean {
  try {
    if (localStorage.getItem('fitowa-ocr') === '1') return true;
  } catch {
    // brak localStorage
  }
  return cloudMode();
}

const AUTO_KEY = 'fitowa-ocr-auto';
/** Czy odczytywać automatycznie po dodaniu zrzutu (domyślnie tak; wybór zapamiętany na tym telefonie). */
export function ocrAuto(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== '0';
  } catch {
    return true;
  }
}
export function setOcrAuto(on: boolean): void {
  try {
    localStorage.setItem(AUTO_KEY, on ? '1' : '0');
  } catch {
    // brak localStorage
  }
}

/** Pierwszy obiekt JSON z tekstu (model czasem dopisze zdanie albo blok ```json). */
export function extractJson(text: string): unknown {
  if (typeof text !== 'string') return null;
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try {
    return JSON.parse(text.slice(s, e + 1));
  } catch {
    return null;
  }
}

/** Liczba z odpowiedzi: 1850, "1 850", "1850,5", "1850 kcal". null = brak, undefined = śmieci / poza zakresem. */
export function ocrNumber(v: unknown, max: number): number | null | undefined {
  if (v == null || v === '') return null;
  let n = NaN;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') {
    const t = v.replace(/[\s ]/g, '').replace(',', '.').replace(/[a-ząćęłńóśźż]+$/i, '');
    if (/^\d+(\.\d+)?$/.test(t)) n = Number(t);
  }
  if (!Number.isFinite(n) || n < 0 || n > max) return undefined;
  return Math.round(n * 10) / 10;
}

/**
 * Sprawdza wynik (z funkcji albo surowy JSON modelu). Liczba poza zakresem albo nieczytelna → puste pole
 * i confidence 'low'. Brak jakiejkolwiek liczby → null (nic do wypełnienia).
 */
export function validateOcr(raw: unknown): OcrResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  let bad = false;
  const out: OcrResult = { confidence: o.confidence === 'high' ? 'high' : 'low' };
  for (const [k] of MACROS) {
    const v = ocrNumber(o[k], RANGE[k]);
    if (v === undefined) bad = true;
    else if (v != null) out[k] = v;
  }
  if (!MACROS.some(([k]) => out[k] != null)) return null;
  if (typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date)) out.date = o.date;
  if (typeof o.note === 'string' && o.note.trim()) out.note = o.note.trim().slice(0, 200);
  if (typeof o.remaining === 'number' && Number.isFinite(o.remaining)) out.remaining = Math.max(0, Math.round(o.remaining));
  if (bad) {
    out.confidence = 'low';
    out.note ??= 'Część liczb była nieczytelna — sprawdź je i popraw.';
  }
  return out;
}

/** Wynik → tekst pól formularza (przecinek dziesiętny); pomija liczby, których nie odczytano. */
export function ocrToText(r: OcrResult): Partial<Record<MacroKey, string>> {
  const out: Partial<Record<MacroKey, string>> = {};
  for (const [k] of MACROS) if (r[k] != null) out[k] = String(r[k]).replace('.', ',');
  return out;
}

/** Wymiary po zmniejszeniu do `max` px dłuższego boku (nigdy nie powiększamy). */
export function fitBox(w: number, h: number, max = OCR_MAX_SIDE): { w: number; h: number } {
  if (!(w > 0 && h > 0)) return { w: 0, h: 0 };
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Komunikat dla podopiecznego z błędu funkcji (status HTTP + treść { error }). */
export function ocrErrorMessage(status: number | undefined, body: unknown): string {
  const msg = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string' ? (body as { error: string }).error : '';
  if (msg) return msg;
  if (status === 404) return 'Odczyt AI nie jest jeszcze włączony — trener musi wdrożyć funkcję w Supabase.';
  if (status === 401) return 'Sesja wygasła — zaloguj się ponownie.';
  if (status === 429) return 'Wykorzystano dzienny limit odczytów — wpisz liczby ręcznie.';
  return 'Nie udało się odczytać zrzutu — wpisz liczby ręcznie.';
}

/** Zmniejsza zdjęcie do JPEG ~1200 px i zwraca base64 (bez prefiksu data:). */
export async function shrinkForOcr(file: Blob): Promise<string> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error('Nie udało się otworzyć zdjęcia — dodaj zrzut jako JPG albo PNG.');
  }
  const { w, h } = fitBox(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Nie udało się przygotować zdjęcia.');
  ctx.fillStyle = '#fff'; // przezroczyste PNG → białe tło w JPEG
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  let q = 0.85;
  let data = c.toDataURL('image/jpeg', q);
  while (data.length * 0.75 > OCR_MAX_BYTES && q > 0.4) {
    q -= 0.15;
    data = c.toDataURL('image/jpeg', q);
  }
  if (data.length * 0.75 > OCR_MAX_BYTES) throw new Error('Zdjęcie jest za duże (limit 1,5 MB).');
  return data.slice(data.indexOf(',') + 1);
}

/** Wysyła zrzut do funkcji „read-screenshot”. Rzuca Error z komunikatem po polsku. */
export async function readScreenshot(file: Blob): Promise<OcrResult> {
  if (!ocrAvailable()) throw new Error('Odczyt AI działa tylko po zalogowaniu w aplikacji online.');
  const image = await shrinkForOcr(file);
  const { supabase } = await import('../data/supabase');
  const { data, error } = await supabase.functions.invoke('read-screenshot', { body: { image, mediaType: 'image/jpeg' } });
  if (error) {
    const ctx = (error as { context?: unknown }).context;
    let status: number | undefined;
    let body: unknown = null;
    if (ctx instanceof Response) {
      status = ctx.status;
      body = await ctx.json().catch(() => null);
    }
    throw new Error(status == null ? 'Brak połączenia z odczytem AI — sprawdź internet.' : ocrErrorMessage(status, body));
  }
  const r = validateOcr(data);
  if (!r) {
    const note = data && typeof data === 'object' && typeof (data as { note?: unknown }).note === 'string' ? (data as { note: string }).note : '';
    throw new Error(note ? `Nie odczytano liczb: ${note}` : 'Nie odczytano liczb ze zrzutu — wpisz je ręcznie.');
  }
  return r;
}
