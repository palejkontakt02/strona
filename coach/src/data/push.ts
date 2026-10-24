import { VAPID_PUBLIC_KEY } from './config';
import { supabase } from './supabase';

/** Co to urządzenie potrafi: powiadomienia działają / iPhone bez ikony na ekranie / brak obsługi / brak konfiguracji. */
export type PushSupport = 'ok' | 'ios-install' | 'unsupported' | 'off';

export function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) || (navigator as { standalone?: boolean }).standalone === true;
}

export function pushSupport(): PushSupport {
  if (!VAPID_PUBLIC_KEY) return 'off';
  const has = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  // iOS (16.4+) obsługuje push tylko w aplikacji dodanej do ekranu początkowego
  if (isIos() && !isStandalone()) return 'ios-install';
  return has ? 'ok' : 'unsupported';
}

/** Rejestracja service workera aplikacji (bez czekania w nieskończoność, np. w trybie deweloperskim). */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  const reg = await navigator.serviceWorker.getRegistration('/app/').catch(() => undefined);
  if (reg) return reg;
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok') return null;
  const reg = await registration();
  return (await reg?.pushManager.getSubscription().catch(() => null)) ?? null;
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export type EnableResult = 'ok' | 'denied' | 'no-sw' | 'db' | 'error';

/** Włącza powiadomienia na tym urządzeniu: zgoda, subskrypcja, zapis w bazie (sekcja 20). */
export async function enablePush(): Promise<EnableResult> {
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';
  const reg = await registration();
  if (!reg) return 'no-sw';
  try {
    let sub = await reg.pushManager.getSubscription();
    // inny klucz serwera (np. po zmianie pary VAPID) — subskrypcja od nowa
    const cur = sub?.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
    const want = keyBytes(VAPID_PUBLIC_KEY);
    if (sub && cur && (cur.length !== want.length || cur.some((b, i) => b !== want[i]))) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
    const json = sub.toJSON() as { endpoint: string; keys?: { p256dh: string; auth: string } };
    const { error } = await supabase.rpc('save_push_subscription', { p_endpoint: json.endpoint, p_keys: json.keys ?? {} });
    if (error) return /function|schema cache|does not exist/i.test(error.message) ? 'db' : 'error';
    return 'ok';
  } catch {
    return 'error';
  }
}

/** Wyłącza powiadomienia na tym urządzeniu (subskrypcja w przeglądarce i w bazie). */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe().catch(() => undefined);
}
