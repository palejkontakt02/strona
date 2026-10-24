// Web Push bez zależności: VAPID (RFC 8292, JWT ES256) + szyfrowanie treści aes128gcm (RFC 8291 / 8188).
// Tylko WebCrypto — działa w Supabase Edge (Deno) i w Node 20+.

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface Vapid {
  /** Klucz publiczny (65 bajtów, nieskompresowany punkt P-256) w base64url. */
  publicKey: string;
  /** Klucz prywatny (32 bajty, „d”) w base64url. */
  privateKey: string;
  /** Kontakt do nadawcy, np. „mailto:trener@example.com”. */
  subject: string;
}

const enc = new TextEncoder();

export function b64urlDecode(s: string): Uint8Array {
  const b = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function b64urlEncode(buf: ArrayBuffer | Uint8Array): string {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/** Podpis VAPID: nagłówek Authorization dla danego adresu usługi push. */
export async function vapidAuthorization(endpoint: string, vapid: Vapid, ttlSec = 12 * 3600): Promise<string> {
  const pub = b64urlDecode(vapid.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID_PUBLIC_KEY: oczekiwany nieskompresowany klucz P-256 (65 bajtów)');
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', d: vapid.privateKey, x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33, 65)), ext: true };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + ttlSec, sub: vapid.subject })));
  const unsigned = `${header}.${claims}`;
  // WebCrypto zwraca podpis w formacie r||s (64 bajty) — dokładnie tak, jak wymaga JWS
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned));
  return `vapid t=${unsigned}.${b64urlEncode(sig)}, k=${vapid.publicKey}`;
}

/** Szyfruje treść dla danej subskrypcji (aes128gcm, jeden rekord). */
export async function encryptPayload(sub: PushSubscriptionJSON, payload: Uint8Array): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(sub.keys.p256dh);
  const authSecret = b64urlDecode(sub.keys.auth);
  const local = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as EcdhKeyDeriveParams, local.privateKey, 256));
  // RFC 8291: IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info\0" || ua_public || as_public)
  const prkKey = await hmac(authSecret, ecdhSecret);
  const ikm = await hmac(prkKey, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // treść + ogranicznik ostatniego rekordu (0x02)
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const rs = 4096;
  const head = concat(salt, new Uint8Array([(rs >>> 24) & 255, (rs >>> 16) & 255, (rs >>> 8) & 255, rs & 255, asPublic.length]), asPublic);
  return concat(head, cipher);
}

export interface SendResult {
  endpoint: string;
  status: number;
  /** Subskrypcja wygasła (404 / 410) — do usunięcia z bazy. */
  gone: boolean;
}

/** Wysyła jedno powiadomienie (treść: JSON, najwyżej ~3 kB). */
export async function sendWebPush(sub: PushSubscriptionJSON, data: unknown, vapid: Vapid, opts: { ttl?: number; urgency?: 'low' | 'normal' | 'high'; topic?: string } = {}): Promise<SendResult> {
  const body = await encryptPayload(sub, enc.encode(JSON.stringify(data)));
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(sub.endpoint, vapid),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(opts.ttl ?? 24 * 3600),
    Urgency: opts.urgency ?? 'normal',
  };
  // Topic: najwyżej 32 znaki base64url — nowsze powiadomienie o tym samym temacie zastępuje starsze w kolejce
  if (opts.topic) headers.Topic = opts.topic.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  const res = await fetch(sub.endpoint, { method: 'POST', headers, body });
  await res.body?.cancel().catch(() => undefined);
  return { endpoint: sub.endpoint, status: res.status, gone: res.status === 404 || res.status === 410 };
}
