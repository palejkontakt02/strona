// Supabase Edge Function „send-push” — wysyła powiadomienia Web Push na telefony.
// Wywołuje ją baza (sekcja 20 w hardening.sql, przez pg_net) z listą subskrypcji i treścią powiadomienia.
// Nie czyta bazy i nie potrzebuje klucza service_role. Instrukcja wdrożenia: supabase/PUSH.md.
//
// Sekrety (Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY   — ten sam klucz co w aplikacji (src/data/config.ts)
//   VAPID_PRIVATE_KEY  — klucz prywatny pary VAPID (nigdy w repozytorium)
//   VAPID_SUBJECT      — kontakt, np. mailto:trener@example.com
//   PUSH_HOOK_SECRET   — wspólny sekret z bazy: select value from public.push_config where key = 'secret';
// Funkcja ma mieć WYŁĄCZONE „Verify JWT” (wywołanie z bazy uwierzytelnia nagłówek x-push-secret).
import { sendWebPush, type PushSubscriptionJSON } from './webpush.ts';

interface Body {
  subscriptions: PushSubscriptionJSON[];
  title: string;
  body?: string;
  url?: string;
  tag?: string;
}

const env = (k: string) => Deno.env.get(k) ?? '';

/** Porównanie sekretu w stałym czasie. */
function same(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const secret = env('PUSH_HOOK_SECRET');
  if (!same(req.headers.get('x-push-secret') ?? '', secret)) return new Response('Unauthorized', { status: 401 });
  const vapid = { publicKey: env('VAPID_PUBLIC_KEY'), privateKey: env('VAPID_PRIVATE_KEY'), subject: env('VAPID_SUBJECT') || 'mailto:kontakt@sebastianpalej.pl' };
  if (!vapid.publicKey || !vapid.privateKey) return new Response('VAPID keys not configured', { status: 500 });

  let msg: Body;
  try {
    msg = await req.json();
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }
  const subs = (Array.isArray(msg.subscriptions) ? msg.subscriptions : [])
    .filter((s) => s && typeof s.endpoint === 'string' && s.endpoint.startsWith('https://') && s.keys?.p256dh && s.keys?.auth)
    .slice(0, 50);
  const data = { title: String(msg.title ?? 'Fitowa').slice(0, 80), body: String(msg.body ?? '').slice(0, 180), url: typeof msg.url === 'string' && msg.url.startsWith('/app/') ? msg.url : '/app/', tag: msg.tag ? String(msg.tag).slice(0, 40) : undefined };

  const results = await Promise.all(
    subs.map((s) => sendWebPush(s, data, vapid, { topic: data.tag }).catch((e) => ({ endpoint: s.endpoint, status: 0, gone: false, error: String(e) }))),
  );
  // wygasłe subskrypcje (telefon wyłączył powiadomienia) — usuwamy z bazy funkcją push_gone (sprawdza sekret)
  const gone = results.filter((r) => r.gone).map((r) => r.endpoint);
  const url = env('SUPABASE_URL');
  const anon = env('SUPABASE_ANON_KEY');
  if (gone.length && url && anon) {
    await fetch(`${url}/rest/v1/rpc/push_gone`, {
      method: 'POST',
      headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_secret: secret, p_endpoints: gone }),
    }).catch(() => undefined);
  }
  return Response.json({ sent: results.filter((r) => r.status >= 200 && r.status < 300).length, gone: gone.length, results: results.map((r) => ({ status: r.status, gone: r.gone })) });
});
