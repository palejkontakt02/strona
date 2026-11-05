import type { Plan } from '../domain';
import { GOOGLE_CLIENT_ID } from '../data/config';
import { planRows } from './sheetImport';

/**
 * Arkusze Google ↔ plan treningowy, w obie strony, bez serwera:
 * logowanie Google (Google Identity Services) z uprawnieniem `drive.file` — aplikacja widzi WYŁĄCZNIE arkusze,
 * które sama utworzyła, nie cały Dysk. Token jest tylko w pamięci karty (ok. 1 godz.), nigdzie nie jest zapisywany.
 * Arkusz ma jedną zakładkę „Plan” w układzie „Do importu” (wiersz = grupa serii), więc wczytuje się tym samym importem.
 */

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const SHEET_TAB = 'Plan';

export const gsheetsEnabled = () => !!GOOGLE_CLIENT_ID;
export const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`;

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}
interface TokenClient {
  requestAccessToken: (o?: { prompt?: string }) => void;
}
type Gis = { accounts: { oauth2: { initTokenClient: (c: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: (e: { type?: string }) => void }) => TokenClient } } };

let token: { value: string; until: number } | null = null;
let gisLoad: Promise<Gis> | null = null;

function loadGis(): Promise<Gis> {
  const w = window as unknown as { google?: Gis };
  if (w.google?.accounts?.oauth2) return Promise.resolve(w.google);
  gisLoad ??= new Promise<Gis>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => (w.google?.accounts?.oauth2 ? resolve(w.google) : reject(new Error('Nie udało się wczytać logowania Google.')));
    s.onerror = () => {
      gisLoad = null;
      reject(new Error('Brak połączenia z Google — sprawdź internet.'));
    };
    document.head.appendChild(s);
  });
  return gisLoad;
}

/** Token dostępu (okno logowania Google tylko za pierwszym razem w tej karcie albo po wygaśnięciu). */
async function accessToken(): Promise<string> {
  if (token && Date.now() < token.until) return token.value;
  const gis = await loadGis();
  return new Promise<string>((resolve, reject) => {
    const client = gis.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: (r) => {
        if (!r.access_token) return reject(new Error(r.error === 'access_denied' ? 'Nie udzielono dostępu do Arkuszy Google.' : 'Logowanie Google nie powiodło się.'));
        token = { value: r.access_token, until: Date.now() + Math.max(60, (r.expires_in ?? 3600) - 120) * 1000 };
        resolve(r.access_token);
      },
      error_callback: (e) => reject(new Error(e?.type === 'popup_closed' ? 'Zamknięto okno logowania Google.' : e?.type === 'popup_failed_to_open' ? 'Przeglądarka zablokowała okno logowania Google — zezwól na wyskakujące okna.' : 'Logowanie Google nie powiodło się.')),
    });
    client.requestAccessToken({ prompt: token ? '' : undefined });
  });
}

async function api<T>(url: string, init: RequestInit = {}, retry = true): Promise<T> {
  const t = await accessToken();
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  if (res.status === 401 && retry) {
    token = null;
    return api<T>(url, init, false);
  }
  if (!res.ok) {
    if (res.status === 404) throw new Error('Arkusz nie istnieje albo został usunięty — odłącz go i utwórz nowy.');
    if (res.status === 403) throw new Error('Brak dostępu do arkusza — aplikacja widzi tylko arkusze, które sama utworzyła (zaloguj się tym samym kontem Google).');
    throw new Error(`Arkusze Google: błąd ${res.status}.`);
  }
  return (await res.json()) as T;
}

/** Wiersze planu do arkusza: liczby jako liczby (polski przecinek w Arkuszach), przerwa jako m:ss. */
export function planSheetValues(plan: Plan): (string | number)[][] {
  const rows = planRows(plan);
  const rest = rows[0].indexOf('Przerwa');
  return rows.map((r, i) =>
    i === 0
      ? r
      : r.map((c, ci) => {
          const t = c.trim();
          if (ci === rest && /^\d+$/.test(t)) return `${Math.floor(Number(t) / 60)}:${String(Number(t) % 60).padStart(2, '0')}`;
          return /^-?\d+(?:[.,]\d+)?$/.test(t) ? Number(t.replace(',', '.')) : c;
        }),
  );
}

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

/** Nowy arkusz z planem (wygląd: pogrubiony, zamrożony nagłówek, szerokości kolumn). Zwraca id pliku. */
export async function createPlanSheet(plan: Plan, client?: string): Promise<string> {
  const title = `${plan.name}${client ? ` — ${client}` : ''} (Fitowa)`;
  const made = await api<{ spreadsheetId: string; sheets: { properties: { sheetId: number } }[] }>(SHEETS, {
    method: 'POST',
    body: JSON.stringify({ properties: { title, locale: 'pl_PL' }, sheets: [{ properties: { title: SHEET_TAB, gridProperties: { frozenRowCount: 1 } } }] }),
  });
  const sid = made.sheets[0]?.properties.sheetId ?? 0;
  await pushPlanSheet(made.spreadsheetId, plan);
  const widths = [110, 70, 160, 220, 55, 70, 70, 50, 70, 220, 90, 90, 90];
  await api(`${SHEETS}/${made.spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        { repeatCell: { range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.62, green: 0.77, blue: 0.91 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } },
        ...widths.map((px, i) => ({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } })),
        { addBanding: { bandedRange: { range: { sheetId: sid, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 13 }, rowProperties: { headerColor: { red: 0.62, green: 0.77, blue: 0.91 }, firstBandColor: { red: 1, green: 1, blue: 1 }, secondBandColor: { red: 0.96, green: 0.96, blue: 0.96 } } } } },
      ],
    }),
  }).catch(() => undefined); // wygląd nieobowiązkowy
  return made.spreadsheetId;
}

/** Aplikacja → arkusz: zakładka „Plan” nadpisana aktualnym planem. */
export async function pushPlanSheet(id: string, plan: Plan): Promise<void> {
  await api(`${SHEETS}/${id}/values/${encodeURIComponent(SHEET_TAB)}:clear`, { method: 'POST', body: '{}' });
  await api(`${SHEETS}/${id}/values/${encodeURIComponent(`${SHEET_TAB}!A1`)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ range: `${SHEET_TAB}!A1`, majorDimension: 'ROWS', values: planSheetValues(plan) }),
  });
}

/** Arkusz → aplikacja: wiersze zakładki „Plan” jako tekst (jak w pliku), do importu i porównania z planem. */
export async function pullPlanSheet(id: string): Promise<string[][]> {
  const r = await api<{ values?: unknown[][] }>(`${SHEETS}/${id}/values/${encodeURIComponent(SHEET_TAB)}?valueRenderOption=FORMATTED_VALUE`);
  return (r.values ?? []).map((row) => row.map((c) => (c == null ? '' : String(c))));
}
