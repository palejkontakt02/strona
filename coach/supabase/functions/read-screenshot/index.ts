// Supabase Edge Function „read-screenshot” — odczyt sum dnia (kcal, białko, tłuszcze, węglowodany)
// ze zrzutu ekranu aplikacji Fitatu przez Claude (Anthropic). Instrukcja wdrożenia: supabase/AI.md.
//
// Wywołuje ją aplikacja (supabase.functions.invoke('read-screenshot')) z tokenem zalogowanego użytkownika.
// Zdjęcie jest tylko przetwarzane w pamięci i wysyłane do Anthropic — funkcja NIGDZIE go nie zapisuje.
//
// Sekret (Edge Functions → Secrets):
//   ANTHROPIC_API_KEY — klucz z console.anthropic.com (nigdy w repozytorium ani w aplikacji)
// Automatycznie dostępne w Supabase: SUPABASE_URL, SUPABASE_ANON_KEY.
// Limit dzienny: funkcja public.ai_quota_take — sekcja 30 w supabase/hardening.sql.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const MODEL = 'claude-haiku-5-5';
const DAILY_LIMIT = 20;
/** Limit obrazu po zdekodowaniu base64 (aplikacja wysyła ok. 1200 px JPEG, zwykle 150–400 kB). */
const MAX_BYTES = 1.5 * 1024 * 1024;

const env = (k: string) => Deno.env.get(k) ?? '';

// ---------- CORS ----------
const ALLOWED = [/^https:\/\/(www\.)?sebastianpalej\.pl$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const ok = ALLOWED.some((r) => r.test(origin));
  return {
    ...(ok ? { 'Access-Control-Allow-Origin': origin } : {}),
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' } });
}
const fail = (req: Request, status: number, error: string) => json(req, status, { error });

// ---------- walidacja obrazu ----------
function decodedSize(b64: string): number {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/** Typ obrazu po pierwszych bajtach (JPEG / PNG / WebP); null gdy to nie obraz. */
function sniff(b64: string): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  let head: string;
  try {
    head = atob(b64.slice(0, 24));
  } catch {
    return null;
  }
  const b = [...head].map((c) => c.charCodeAt(0));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (head.slice(0, 4) === 'RIFF' && head.slice(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// ---------- odpowiedź modelu (ta sama logika co validateOcr w src/lib/nutritionOcr.ts — trzymaj w zgodzie) ----------
interface Ocr {
  kcal: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
  date?: string;
  confidence: 'high' | 'low';
  note?: string;
}

function extractJson(text: string): unknown {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try {
    return JSON.parse(text.slice(s, e + 1));
  } catch {
    return null;
  }
}

function num(v: unknown, max: number): number | null | undefined {
  if (v == null || v === '') return null;
  let n = NaN;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') {
    const t = v.replace(/[\s ]/g, '').replace(',', '.').replace(/[a-ząćęłńóśźż]+$/i, '');
    if (/^\d+(\.\d+)?$/.test(t)) n = Number(t);
  }
  if (!Number.isFinite(n)) return undefined;
  if (n < 0 || n > max) return undefined; // poza zakresem = nie ufamy
  return Math.round(n * 10) / 10;
}

function validate(raw: unknown): Ocr {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  let bad = !raw || typeof raw !== 'object';
  const pick = (k: string, max: number) => {
    const v = num(o[k], max);
    if (v === undefined) bad = true;
    return v ?? null;
  };
  const out: Ocr = { kcal: pick('kcal', 10000), protein: pick('protein', 1000), fat: pick('fat', 1000), carbs: pick('carbs', 1000), confidence: o.confidence === 'high' ? 'high' : 'low' };
  if (typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date)) out.date = o.date;
  const note = typeof o.note === 'string' ? o.note.trim().slice(0, 200) : '';
  if (out.kcal == null && out.protein == null && out.fat == null && out.carbs == null) bad = true;
  if (bad) out.confidence = 'low';
  if (note) out.note = note;
  else if (bad) out.note = 'Nie udało się pewnie odczytać liczb — sprawdź je i popraw.';
  return out;
}

const PROMPT = `To jest (prawdopodobnie) zrzut ekranu z polskiej aplikacji Fitatu — podsumowanie jednego dnia jedzenia.
Odczytaj SUMY ZJEDZONE w tym dniu (nie cele, nie „pozostało”, nie pojedyncze posiłki):
- kcal — kalorie (kcal),
- protein — białko (g),
- fat — tłuszcze (g),
- carbs — węglowodany (g).
Jeśli widać wartość w formie „zjedzone / cel” (np. „1850 / 2200 kcal”), weź pierwszą liczbę (zjedzone).
Jeśli widać datę dnia, podaj ją jako date w formacie RRRR-MM-DD (rok bieżący, jeśli brak roku); inaczej pomiń.
Liczba, której nie widać albo jest nieczytelna → null. Niczego nie zgaduj ani nie wyliczaj.
confidence: "high" tylko gdy to wyraźnie podsumowanie dnia z Fitatu i wszystkie widoczne liczby są czytelne; inaczej "low".
Jeśli to nie jest podsumowanie dnia (inna aplikacja, pojedynczy posiłek, inny ekran) — confidence "low" i krótka note po polsku, co widać.
Odpowiedz WYŁĄCZNIE jednym obiektem JSON, bez komentarza i bez bloków kodu:
{"kcal": number|null, "protein": number|null, "fat": number|null, "carbs": number|null, "date"?: string, "confidence": "high"|"low", "note"?: string}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return fail(req, 405, 'Dozwolone jest tylko POST.');

  const apiKey = env('ANTHROPIC_API_KEY');
  if (!apiKey) return fail(req, 503, 'Odczyt AI nie jest skonfigurowany.');

  // 1. kto pyta — token zalogowanego użytkownika
  const auth = req.headers.get('Authorization') ?? '';
  if (!/^Bearer\s+\S+/.test(auth)) return fail(req, 401, 'Zaloguj się, aby odczytać zrzut.');
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: u, error: uerr } = await sb.auth.getUser(auth.replace(/^Bearer\s+/, ''));
  if (uerr || !u?.user) return fail(req, 401, 'Sesja wygasła — zaloguj się ponownie.');

  // 2. obraz
  let body: { image?: unknown; mediaType?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(req, 400, 'Nieprawidłowe zapytanie.');
  }
  const image = typeof body.image === 'string' ? body.image.replace(/^data:[^,]*,/, '').replace(/\s/g, '') : '';
  if (!image) return fail(req, 400, 'Brak zdjęcia.');
  if (decodedSize(image) > MAX_BYTES) return fail(req, 413, 'Zdjęcie jest za duże (limit 1,5 MB).');
  if (!/^[A-Za-z0-9+/]+=*$/.test(image)) return fail(req, 400, 'Nieprawidłowe dane zdjęcia.');
  const mediaType = sniff(image);
  if (!mediaType) return fail(req, 415, 'To nie jest zdjęcie JPG ani PNG.');

  // 3. limit dzienny (liczony przed wywołaniem AI; nieudany odczyt też się liczy)
  const { data: used, error: qerr } = await sb.rpc('ai_quota_take', { p_kind: 'screenshot', p_limit: DAILY_LIMIT });
  if (qerr) {
    console.error('ai_quota_take', qerr.message);
    if (/Brak dostępu/.test(qerr.message)) return fail(req, 403, 'Brak dostępu do odczytu AI.');
    return fail(req, 503, 'Limit odczytów nie jest skonfigurowany (sekcja 30 w hardening.sql).');
  }
  if (typeof used !== 'number' || used < 0) return fail(req, 429, `Wykorzystano dzienny limit ${DAILY_LIMIT} odczytów — wpisz liczby ręcznie albo spróbuj jutro.`);

  // 4. Claude (Messages API)
  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        output_config: { effort: 'low' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    console.error('anthropic fetch', String(e));
    return fail(req, 504, 'Odczyt AI nie odpowiedział — spróbuj ponownie.');
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('anthropic', res.status, detail.slice(0, 500));
    if (res.status === 429 || res.status === 529) return fail(req, 503, 'Odczyt AI jest chwilowo przeciążony — spróbuj za chwilę.');
    if (res.status === 401 || res.status === 403) return fail(req, 503, 'Odczyt AI jest źle skonfigurowany (klucz API).');
    return fail(req, 502, 'Odczyt AI się nie udał — wpisz liczby ręcznie.');
  }
  const msg = (await res.json().catch(() => null)) as { stop_reason?: string; content?: { type: string; text?: string }[] } | null;
  if (!msg || msg.stop_reason === 'refusal') return fail(req, 502, 'Odczyt AI się nie udał — wpisz liczby ręcznie.');
  const text = (msg.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');

  const out = validate(extractJson(text));
  return json(req, 200, { ...out, remaining: Math.max(0, DAILY_LIMIT - used) });
});
