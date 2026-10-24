import { applyChanges, type Change, type Db, type Repository } from './db';

/**
 * Kolejka zapisów offline („skrzynka nadawcza”): zmiana, której nie udało się wysłać z powodu braku sieci,
 * czeka w localStorage tego urządzenia (osobno dla każdego konta) i jest wysyłana po powrocie internetu —
 * po kolei, a kilka zapisów tego samego rekordu (kolekcja + id) to jeden wpis z najnowszą wersją.
 */

const PREFIX = 'fitowa-outbox:';

/** Klucz rekordu: kolekcja + id. */
export const changeKey = (c: Change) => `${c.col}:${c.op === 'del' ? c.id : (c.item as { id: string }).id}`;

/** Dopisuje zmiany do kolejki; ten sam rekord — nowsza wersja zastępuje starszą w jej miejscu (kolejność zostaje). */
export function enqueue(box: readonly Change[], changes: readonly Change[]): Change[] {
  const out = [...box];
  for (const ch of changes) {
    const i = out.findIndex((x) => changeKey(x) === changeKey(ch));
    if (i >= 0) out[i] = ch;
    else out.push(ch);
  }
  return out;
}

/** Błąd sieci (brak internetu, zerwane połączenie) — a nie odmowa bazy (RLS, walidacja), której ponawianie nic nie da. */
export function isNetworkError(e: unknown, online: boolean = typeof navigator === 'undefined' ? true : navigator.onLine !== false): boolean {
  const err = (e ?? {}) as { message?: unknown; code?: unknown; status?: unknown; name?: unknown };
  const code = typeof err.code === 'string' ? err.code : '';
  // kod z bazy / PostgREST (np. 42501, 23514, PGRST301) = serwer odpowiedział
  if (/^(\d{5}|[A-Z]{5}|PGRST\d+)$/.test(code)) return false;
  if (typeof err.status === 'number' && err.status >= 400 && err.status < 500) return false;
  if (!online) return true;
  const msg = `${typeof err.name === 'string' ? err.name : ''} ${typeof err.message === 'string' ? err.message : String(e)}`;
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|network error|timed? ?out|aborterror|ERR_INTERNET|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(msg);
}

function storage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function readOutbox(scope: string, st: Storage | undefined = storage()): Change[] {
  try {
    const raw = st?.getItem(PREFIX + scope);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((c): c is Change => !!c && typeof c === 'object' && (c.op === 'put' || c.op === 'del') && typeof c.col === 'string') : [];
  } catch {
    return [];
  }
}

export function writeOutbox(scope: string, box: readonly Change[], st: Storage | undefined = storage()): void {
  try {
    if (box.length) st?.setItem(PREFIX + scope, JSON.stringify(box));
    else st?.removeItem(PREFIX + scope);
  } catch {
    // brak miejsca / dostępu — kolejka zostaje w pamięci tej karty
  }
}

export interface FlushResult {
  sent: number;
  /** Zmiany odrzucone przez bazę (nie sieć) — usunięte z kolejki. */
  failed: Change[];
  /** Przerwano, bo dalej brak sieci. */
  offline: boolean;
}

/** Kolejka jednego konta na tym urządzeniu. */
export class Outbox {
  items: Change[];
  private running: Promise<FlushResult> | null = null;

  constructor(
    private repo: Pick<Repository, 'apply'>,
    readonly scope: string,
    private onChange: (n: number) => void = () => undefined,
    private st: Storage | undefined = storage(),
    private isNet: (e: unknown) => boolean = isNetworkError,
  ) {
    this.items = readOutbox(scope, st);
  }

  private set(next: Change[]) {
    this.items = next;
    writeOutbox(this.scope, next, this.st);
    this.onChange(next.length);
  }

  /** Dane z serwera + zmiany czekające w kolejce (przeładowanie nie gubi zapisów offline). */
  merge(db: Db): Db {
    return this.items.length ? applyChanges(db, this.items) : db;
  }

  /**
   * Zapis: od razu do bazy, a przy braku sieci — do kolejki. Gdy kolejka nie jest pusta, nowa zmiana idzie
   * za starszymi (żeby starsza wersja rekordu nie nadpisała nowszej). Błąd bazy (nie sieci) — wyjątek.
   */
  async submit(changes: Change[]): Promise<'sent' | 'queued'> {
    if (!this.items.length && !this.running) {
      try {
        await this.repo.apply(changes);
        return 'sent';
      } catch (e) {
        if (!this.isNet(e)) throw e;
        this.set(enqueue(this.items, changes));
        return 'queued';
      }
    }
    this.set(enqueue(this.items, changes));
    const queued = this.items.filter((x) => changes.includes(x));
    const r = await this.flush();
    if (r.failed.some((x) => queued.includes(x))) throw new Error('Zapis odrzucony przez bazę');
    return this.items.some((x) => queued.includes(x)) ? 'queued' : 'sent';
  }

  /** Wysyła kolejkę po kolei; przy braku sieci przerywa, odrzucone przez bazę usuwa. */
  flush(): Promise<FlushResult> {
    if (this.running) return this.running.then(() => this.flush());
    const run = (async () => {
      const res: FlushResult = { sent: 0, failed: [], offline: false };
      while (this.items.length) {
        const ch = this.items[0];
        try {
          await this.repo.apply([ch]);
          res.sent++;
        } catch (e) {
          if (this.isNet(e)) {
            res.offline = true;
            break;
          }
          res.failed.push(ch);
        }
        // nowsza wersja tego rekordu (zapisana w trakcie wysyłki) zostaje w kolejce
        this.set(this.items.filter((x) => x !== ch));
      }
      return res;
    })();
    this.running = run;
    return run.finally(() => {
      this.running = null;
    });
  }

  clear() {
    this.set([]);
  }
}
