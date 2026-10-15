import type { Client } from '../domain';
import type { Change } from './db';
import { setPaymentStatus } from './ops';

type Api = { apply: (c: Change[], m?: string) => Promise<boolean>; toast: (m: string, a?: { label: string; run: () => void }) => void };

/** „Opłacone” jednym dotknięciem — z „Cofnij” w komunikacie (łatwo trafić przy przewijaniu). */
export async function markPaid({ apply, toast }: Api, client: Client, paymentId: string, today: string) {
  if (!(await apply([setPaymentStatus(client, paymentId, true, today)]))) return;
  toast('Oznaczono jako opłacone.', { label: 'Cofnij', run: () => void apply([setPaymentStatus(client, paymentId, false, today)], 'Cofnięto — znowu do zapłaty.') });
}
