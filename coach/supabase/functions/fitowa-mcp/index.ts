// Supabase Edge Function „fitowa-mcp”: łącznik Fitowej dla Claude (serwer MCP, tylko odczyt).
// Opis wdrożenia i włączenia logowania OAuth: supabase/CLAUDE-LACZNIK.md.
//
// Podopieczny dodaje w Claude własny łącznik z adresem tej funkcji. Claude loguje go przez serwer OAuth 2.1
// w Supabase Auth (ekran zgody w aplikacji: /app/oauth/consent) i wysyła tu jego token. Funkcja czyta dane
// TYM tokenem, więc obowiązują te same reguły RLS co w aplikacji: podopieczny widzi tylko siebie.
// Funkcja niczego nie zapisuje. Wdrażana z verify_jwt = false, bo sama odpowiada 401 z adresem metadanych OAuth.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const PROJECT = 'https://pmsspumbjsapjqkvjscz.supabase.co';
const RESOURCE = `${PROJECT}/functions/v1/fitowa-mcp`;
const METADATA = `${RESOURCE}/.well-known/oauth-protected-resource`;
const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const anonKey = () => Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, accept',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
};

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', ...extra } });

const unauthorized = (why?: string) =>
  json(401, { error: 'unauthorized', error_description: why ?? 'Zaloguj się kontem Fitowej.' }, {
    'WWW-Authenticate': `Bearer resource_metadata="${METADATA}"${why ? ', error="invalid_token"' : ''}`,
  });

// ---------- narzędzia ----------
type Args = Record<string, unknown>;
type Ctx = { db: SupabaseClient; clientIds: string[] };

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => {
  const t = new Date(d + 'T12:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const num = (v: unknown, def: number, max: number) => (typeof v === 'number' && v > 0 ? Math.min(Math.floor(v), max) : def);

/** Usuwa puste pola, żeby odpowiedź była krótka. */
function clean<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clean).filter((x) => x !== undefined) as T;
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const c = clean(x);
      if (c === undefined || c === null || c === '' || (Array.isArray(c) && !c.length)) continue;
      o[k] = c;
    }
    return o as T;
  }
  return v;
}

async function rows(ctx: Ctx, table: string): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await ctx.db.from(table).select('data').in('client_id', ctx.clientIds).range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []).map((r: { data: Record<string, any> }) => r.data));
    if (!data || data.length < 1000) return out;
  }
}

async function clients(ctx: Ctx): Promise<Record<string, any>[]> {
  const { data, error } = await ctx.db.from('clients').select('data').in('id', ctx.clientIds);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: { data: Record<string, any> }) => r.data);
}

const setText = (g: Record<string, any>) =>
  [g.sets && `${g.sets}×`, g.reps, g.load && `@ ${g.load}`, g.rpe && `RPE ${g.rpe}`, g.rest && `przerwa ${g.rest}`, g.pace && `tempo ${g.pace}`].filter(Boolean).join(' ');

const doneSets = (e: Record<string, any>) =>
  (e.setsLog ?? [])
    .filter((s: Record<string, any>) => s.done !== false && (s.reps != null || s.load != null || s.dist != null))
    .map((s: Record<string, any>) =>
      [s.warmup && 'rozgrzewka', s.load != null && `${s.load} kg`, s.reps != null && `${s.reps}${s.unit ? ' ' + s.unit : ''}${s.repsR != null ? `/${s.repsR}` : ''}`, s.rpe != null && `RPE ${s.rpe}`, s.dist != null && `${s.dist} km`, s.hr && `tętno ${s.hr}`, s.complex]
        .filter(Boolean)
        .join(' × '),
    );

const TOOLS: { name: string; title: string; description: string; inputSchema: Record<string, unknown>; run: (ctx: Ctx, a: Args) => Promise<unknown> }[] = [
  {
    name: 'moj_profil',
    title: 'Mój profil',
    description: 'Profil podopiecznego w Fitowej: cel, poziom, sport, kontuzje, cele żywieniowe, data rozpoczęcia współpracy, nawyki do odhaczania.',
    inputSchema: { type: 'object', properties: {} },
    run: async (ctx) =>
      (await clients(ctx)).map((c) => ({
        imie: c.name,
        cel: c.goal,
        poziom: c.level,
        sport: c.sport,
        pozycja: c.position,
        data_urodzenia: c.dob,
        wzrost_cm: c.height,
        treningow_w_tygodniu: c.daysPerWeek,
        termin_celu: c.targetDate,
        start_wspolpracy: c.startDate,
        kontuzje: c.injuries,
        historia_kontuzji: c.injuryLog,
        cele_dzienne: c.targets,
        nawyki: (c.habits ?? []).filter((h: Record<string, any>) => !h.archived).map((h: Record<string, any>) => ({ nazwa: h.title, harmonogram: h.schedule })),
        nieobecnosci: c.absences,
      })),
  },
  {
    name: 'moj_plan',
    title: 'Mój plan treningowy',
    description: 'Aktywne plany treningowe od trenera: tygodnie, jednostki (z datą, jeśli jest ustalona) i ćwiczenia z seriami, powtórzeniami, ciężarem, RPE i przerwą. Ustaw wszystkie=true, żeby dostać też plany zakończone.',
    inputSchema: { type: 'object', properties: { wszystkie: { type: 'boolean', description: 'Też plany nieaktywne (archiwalne).' } } },
    run: async (ctx, a) =>
      (await rows(ctx, 'plans'))
        .filter((p) => !p.template && (a.wszystkie === true || p.active))
        .map((p) => ({
          nazwa: p.name,
          aktywny: p.active,
          dodatkowy: p.extra,
          start: p.startDate,
          uwagi: p.notes,
          tygodnie: (p.weeks ?? []).map((w: Record<string, any>) => ({
            tydzien: w.name,
            jednostki: (w.workouts ?? []).map((k: Record<string, any>) => ({
              nazwa: k.name,
              data: k.date,
              dzien_tygodnia: k.day,
              cwiczenia: (k.exercises ?? []).map((e: Record<string, any>) => ({
                nazwa: e.name,
                superseria_z_poprzednim: e.linked,
                na_strone: e.perSide,
                uwagi: e.notes,
                serie: (e.groups ?? []).map(setText),
              })),
            })),
          })),
        })),
  },
  {
    name: 'moje_treningi',
    title: 'Moje treningi',
    description:
      'Wykonane treningi (od najnowszego): data, nazwa, czas, ćwiczenia z wykonanymi seriami (kg × powtórzenia × RPE), odczucie wysiłku sRPE, ból, samopoczucie, notatki i komentarz trenera. Domyślnie ostatnie 90 dni, najwyżej 30 treningów.',
    inputSchema: {
      type: 'object',
      properties: {
        od: { type: 'string', description: 'Data początkowa RRRR-MM-DD.' },
        do: { type: 'string', description: 'Data końcowa RRRR-MM-DD.' },
        cwiczenie: { type: 'string', description: 'Tylko treningi z ćwiczeniem zawierającym ten tekst, np. „przysiad”.' },
        limit: { type: 'number', description: 'Najwięcej treningów (do 200).' },
      },
    },
    run: async (ctx, a) => {
      const od = isDate(a.od) ? a.od : addDays(today(), -90);
      const doo = isDate(a.do) ? a.do : '9999-12-31';
      const q = typeof a.cwiczenie === 'string' ? a.cwiczenie.trim().toLowerCase() : '';
      const list = (await rows(ctx, 'sessions'))
        .filter((s) => s.date >= od && s.date <= doo)
        .filter((s) => !q || (s.exercises ?? []).some((e: Record<string, any>) => String(e.name ?? '').toLowerCase().includes(q)))
        .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0))
        .slice(0, num(a.limit, 30, 200));
      return list.map((s) => ({
        data: s.date,
        nazwa: s.workoutName,
        z_trenerem: !s.solo,
        czas_min: s.duration,
        srpe: s.srpe,
        bol: s.pain,
        przerwany_przez_bol: s.stoppedForPain,
        samopoczucie: s.wellness,
        sen_h: s.sleepH,
        tetno_spoczynkowe: s.rhr,
        notatki: s.notes,
        komentarz_trenera: s.coachNote,
        cwiczenia: (s.exercises ?? [])
          .filter((e: Record<string, any>) => !q || String(e.name ?? '').toLowerCase().includes(q))
          .map((e: Record<string, any>) => ({
            nazwa: e.name,
            plan: [e.sets && `${e.sets}×`, e.reps, e.load && `@ ${e.load}`, e.rpe && `RPE ${e.rpe}`].filter(Boolean).join(' ') || undefined,
            wykonane: doneSets(e),
            uwagi: e.notes,
          })),
      }));
    },
  },
  {
    name: 'moje_wizyty',
    title: 'Moje wizyty',
    description: 'Wizyty z trenerem w kalendarzu: data, godzina, miejsce, status (planned = zaplanowana, done = odbyta, cancel = odwołana, noshow = nieobecność). Domyślnie od dziś na 60 dni.',
    inputSchema: { type: 'object', properties: { od: { type: 'string', description: 'RRRR-MM-DD' }, do: { type: 'string', description: 'RRRR-MM-DD' } } },
    run: async (ctx, a) => {
      const od = isDate(a.od) ? a.od : today();
      const doo = isDate(a.do) ? a.do : addDays(od, 60);
      return (await rows(ctx, 'appointments'))
        .filter((x) => x.date >= od && x.date <= doo)
        .sort((x, y) => (x.date + x.time < y.date + y.time ? -1 : 1))
        .map((x) => ({ data: x.date, godzina: x.time, czas_min: x.duration, miejsce: x.location, status: x.status, notatka: x.note, odpowiedz: x.reply }));
    },
  },
  {
    name: 'moje_pomiary',
    title: 'Moje pomiary i raporty',
    description: 'Pomiary ciała (waga, obwody, % tłuszczu), wyniki testów sprawności i raporty tygodniowe (waga, sen, stres, energia, trzymanie planu, kroki, komentarz, odpowiedź trenera).',
    inputSchema: { type: 'object', properties: {} },
    run: async (ctx) =>
      (await clients(ctx)).map((c) => ({
        pomiary: [...(c.measurements ?? []), ...(c.selfMeasurements ?? [])]
          .filter((m: Record<string, any>) => !m.hidden)
          .sort((x: Record<string, any>, y: Record<string, any>) => (x.date < y.date ? -1 : 1))
          .map(({ id: _id, hidden: _h, ...m }: Record<string, any>) => m),
        testy: (c.tests ?? []).map(({ id: _id, ...t }: Record<string, any>) => t),
        raporty_tygodniowe: (c.weeklyReports ?? []).map(({ id: _id, photoIds: _p, seenAt: _s, ...r }: Record<string, any>) => r),
      })),
  },
  {
    name: 'moje_zywienie_i_nawyki',
    title: 'Moje żywienie i nawyki',
    description: 'Dzienne wpisy żywienia (kcal, białko, tłuszcze, węglowodany, woda, kroki) na tle celów oraz odhaczone nawyki. Domyślnie ostatnie 30 dni.',
    inputSchema: { type: 'object', properties: { dni: { type: 'number', description: 'Ile ostatnich dni (do 365).' } } },
    run: async (ctx, a) => {
      const od = addDays(today(), -num(a.dni, 30, 365));
      return (await clients(ctx)).map((c) => {
        const names = Object.fromEntries((c.habits ?? []).map((h: Record<string, any>) => [h.id, h.title]));
        return {
          cele: c.targets,
          dni: (c.dayLog ?? []).filter((d: Record<string, any>) => d.date >= od).map(({ shot: _s, ...d }: Record<string, any>) => d),
          nawyki: (c.habitLog ?? [])
            .filter((d: Record<string, any>) => d.date >= od)
            .map((d: Record<string, any>) => ({ data: d.date, zrobione: (d.done ?? []).map((id: string) => names[id] ?? id) })),
        };
      });
    },
  },
  {
    name: 'moje_platnosci',
    title: 'Moje płatności',
    description: 'Płatności u trenera: kwota, data, rodzaj (pakiet, pojedynczy trening, abonament), status (paid = opłacone, due = do zapłaty), termin, forma wpłaty.',
    inputSchema: { type: 'object', properties: {} },
    run: async (ctx) =>
      (await clients(ctx)).flatMap((c) =>
        (c.payments ?? [])
          .sort((x: Record<string, any>, y: Record<string, any>) => ((x.paidDate ?? x.date) < (y.paidDate ?? y.date) ? 1 : -1))
          .map((p: Record<string, any>) => ({ rodzaj: p.type, kwota_zl: p.amount, data: p.date, termin: p.dueDate, status: p.status, oplacono: p.paidDate, treningow_w_pakiecie: p.sessions, miesiac: p.month, opis: p.desc, forma: p.method })),
      ),
  },
];

// ---------- MCP (JSON-RPC przez HTTP) ----------
type Rpc = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, any> };
const ok = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id, result });
const err = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function handle(m: Rpc, token: string, getCtx: () => Promise<Ctx | string>) {
  switch (m.method) {
    case 'initialize': {
      const asked = m.params?.protocolVersion;
      return ok(m.id, {
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'fitowa', title: 'Fitowa', version: '1.0.0' },
        instructions:
          'Dane podopiecznego z aplikacji trenerskiej Fitowa (po polsku): plan, wykonane treningi, wizyty, pomiary, żywienie, nawyki i płatności. Tylko odczyt. Ciężary w kg, daty RRRR-MM-DD. Nie dawaj porad medycznych; przy bólu lub kontuzji odsyłaj do trenera.',
      });
    }
    case 'ping':
      return ok(m.id, {});
    case 'tools/list':
      return ok(m.id, {
        tools: TOOLS.map(({ run: _r, ...t }) => ({ ...t, annotations: { readOnlyHint: true, openWorldHint: false, title: t.title } })),
      });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === m.params?.name);
      if (!tool) return err(m.id, -32602, `Nie ma narzędzia ${m.params?.name}`);
      const ctx = await getCtx();
      if (typeof ctx === 'string') return ok(m.id, { content: [{ type: 'text', text: ctx }], isError: true });
      try {
        const data = clean(await tool.run(ctx, m.params?.arguments ?? {}));
        return ok(m.id, { content: [{ type: 'text', text: JSON.stringify(data) }] });
      } catch (e) {
        return ok(m.id, { content: [{ type: 'text', text: `Błąd odczytu: ${e instanceof Error ? e.message : String(e)}` }], isError: true });
      }
    }
    default:
      return m.method.startsWith('notifications/') ? null : err(m.id, -32601, `Nieobsługiwana metoda ${m.method}`);
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (url.pathname.endsWith('/.well-known/oauth-protected-resource'))
    return json(200, {
      resource: RESOURCE,
      authorization_servers: [`${PROJECT}/auth/v1`],
      bearer_methods_supported: ['header'],
      resource_name: 'Fitowa',
      resource_documentation: 'https://sebastianpalej.pl/app/',
    });
  if (req.method !== 'POST') return json(405, { error: 'Użyj POST (MCP Streamable HTTP).' }, { Allow: 'POST, OPTIONS' });

  const auth = req.headers.get('authorization') ?? '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!token) return unauthorized();
  const db = createClient(PROJECT, anonKey(), { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: u, error: ue } = await db.auth.getUser(token);
  if (ue || !u?.user) return unauthorized('Sesja wygasła albo token jest nieprawidłowy.');

  let ctx: Ctx | string | undefined;
  const getCtx = async () => {
    if (ctx) return ctx;
    const { data, error } = await db.rpc('my_client_ids');
    if (error) return (ctx = `Błąd: ${error.message}`);
    const ids = ((data ?? []) as (string | { my_client_ids: string })[]).map((x) => (typeof x === 'string' ? x : x.my_client_ids));
    ctx = ids.length ? { db, clientIds: ids } : 'To konto nie jest połączone z profilem podopiecznego w Fitowej. Łącznik działa tylko dla kont podopiecznych.';
    return ctx;
  };

  let body: Rpc | Rpc[];
  try {
    body = await req.json();
  } catch {
    return json(400, err(null, -32700, 'Niepoprawny JSON'));
  }
  const list = Array.isArray(body) ? body : [body];
  const out = (await Promise.all(list.map((m) => handle(m, token, getCtx)))).filter((x) => x !== null);
  if (!out.length) return new Response(null, { status: 202, headers: CORS });
  return json(200, Array.isArray(body) ? out : out[0]);
});
