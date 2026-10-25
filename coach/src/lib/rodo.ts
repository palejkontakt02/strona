/**
 * RODO w panelu podopiecznego: zgody (dane o zdrowiu — art. 9, zdjęcia i nagrania), eksport danych
 * (prawo dostępu i przenoszenia), prośba o usunięcie konta i tryb „współpraca zakończona”.
 * Czyste funkcje — bez Reacta i bez sieci (testy: rodo.test.ts).
 */
import type { Client, ConsentEntry, ConsentKind, TrainingSession } from '../domain';
import type { Db } from '../data/db';

/**
 * Administrator danych = trener. Pola w nawiasach [UZUPEŁNIJ …] trener wpisuje sam (raport rodo).
 * Nazwa i e-mail — z podpisu na ekranie logowania i adresu, na który przychodzą wiadomości (data/mail.ts).
 */
export const ADMIN = {
  name: 'Sebastian Palej',
  email: 'kontakt@sebastianpalej.com',
  /** Adres prowadzenia działalności (wymagany w klauzuli). */
  address: '[UZUPEŁNIJ: adres prowadzenia działalności]',
  /** NIP — jeśli działalność gospodarcza (pusty = nie pokazujemy). */
  nip: '',
  /** Jak długo trzymasz dane po zakończeniu współpracy (Twoja decyzja — wpisz konkretny okres). */
  retention: '[UZUPEŁNIJ: np. 3 lata]',
  /** Region bazy Supabase (Project Settings → General → Region), np. „UE (Frankfurt)”. */
  hostingRegion: '[UZUPEŁNIJ: region serwera, np. UE — Frankfurt]',
};

/** Wersja klauzuli informacyjnej — zwiększ, gdy zmienisz jej treść (zapisuje się przy zgodzie). */
export const CLAUSE_VERSION = 1;

export const CONSENT_TEXT: Record<ConsentKind, { title: string; short: string; needed: string }> = {
  health: {
    title: 'Dane o zdrowiu',
    short: 'Urazy, choroby, ból, ankieta PAR-Q i samopoczucie — trener używa ich tylko do bezpiecznego planowania Twoich treningów.',
    needed: 'Bez tej zgody nie wypełnisz ankiety zdrowotnej ani nie zapiszesz bólu i samopoczucia.',
  },
  media: {
    title: 'Zdjęcia sylwetki i nagrania techniki',
    short: 'Zdjęcia postępów i filmy z serii — widzi je tylko Twój trener, do oceny techniki i postępów.',
    needed: 'Bez tej zgody zdjęcia i nagrania są wyłączone. Reszta aplikacji działa normalnie.',
  },
};

const latest = (c: Pick<Client, 'consents'> | undefined, id: ConsentEntry['id']): ConsentEntry | undefined =>
  (c?.consents ?? []).filter((x) => x && x.id === id).at(-1);

/**
 * Stan zgody: 'on' (udzielona), 'off' (wycofana / odmowa), 'unset' (jeszcze nie pytano).
 * Dane o zdrowiu: zgoda z dawnej ankiety (intake.consentAt) liczy się jako udzielona, dopóki jej nie wycofa.
 */
export function consentState(c: Pick<Client, 'consents' | 'intake'> | undefined, kind: ConsentKind): 'on' | 'off' | 'unset' {
  const e = latest(c, kind);
  if (e) return e.on ? 'on' : 'off';
  if (kind === 'health' && c?.intake?.consentAt) return 'on';
  return 'unset';
}

/** Czy podopieczny udzielił zgody (i jej nie wycofał). Brak decyzji = brak zgody. */
export function hasConsent(c: Pick<Client, 'consents' | 'intake'> | undefined, kind: ConsentKind): boolean {
  return consentState(c, kind) === 'on';
}

/** Zgoda wprost wycofana (albo odmowa) — trener widzi bursztynową informację w karcie klienta. */
export function consentWithdrawn(c: Pick<Client, 'consents' | 'intake'> | undefined, kind: ConsentKind): boolean {
  return consentState(c, kind) === 'off';
}

/** Data udzielenia zgody (ISO) — do wyświetlenia przy przełączniku. */
export function consentDate(c: Pick<Client, 'consents' | 'intake'> | undefined, kind: ConsentKind): string | undefined {
  const e = latest(c, kind);
  if (e) return e.on ? (e.givenAt ?? e.at) : (e.withdrawnAt ?? e.at);
  return kind === 'health' ? c?.intake?.consentAt : undefined;
}

/** Podopieczny jeszcze nie zdecydował o żadnej zgodzie — pokaż ekran zgód przy pierwszym logowaniu. */
export function needsConsentPrompt(c: Pick<Client, 'consents' | 'intake'> | undefined): boolean {
  return (['health', 'media'] as ConsentKind[]).some((k) => consentState(c, k) === 'unset');
}

/** Nowy wpis zgody / prośby (w chmurze daty i tak ustawia baza — sekcja 24). */
export function consentEntry(prev: ConsentEntry | undefined, id: ConsentEntry['id'], on: boolean, now = new Date().toISOString()): ConsentEntry {
  const changed = !prev || prev.on !== on;
  return {
    id,
    on,
    at: changed ? now : prev!.at,
    givenAt: on ? (changed ? now : prev?.givenAt ?? now) : prev?.givenAt,
    withdrawnAt: on ? prev?.withdrawnAt : changed ? now : prev?.withdrawnAt,
    v: CLAUSE_VERSION,
    log: changed ? [...(prev?.log ?? []), { on, at: now }].slice(-20) : prev?.log,
  };
}

export function consentOf(c: Pick<Client, 'consents'> | undefined, id: ConsentEntry['id']): ConsentEntry | undefined {
  return latest(c, id);
}

/** Początek wiadomości do trenera z prośbą o usunięcie konta (po niej rozpoznajemy „odczytana”). */
export const ERASURE_PREFIX = 'Prośba o usunięcie konta';

/** Prośba o usunięcie konta: brak / wysłana / odczytana przez trenera (wiadomość z prośbą oznaczona jako przeczytana). */
export function erasureStatus(c: Pick<Client, 'consents' | 'inbox'> | undefined): { state: 'none' } | { state: 'sent' | 'read'; at: string } {
  const e = latest(c, 'erasure');
  if (!e?.on) return { state: 'none' };
  const note = (c?.inbox ?? []).filter((n) => n.text.startsWith(ERASURE_PREFIX)).at(-1);
  return { state: note?.read ? 'read' : 'sent', at: e.givenAt ?? e.at };
}

/** Współpraca zakończona — konto tylko do odczytu (historia i eksport zostają). */
export function isArchived(c: Pick<Client, 'status'> | undefined): boolean {
  return c?.status === 'zakończony';
}

/* ---------- Eksport danych (art. 15 i 20 RODO) ---------- */

/** Usuwa odwołania do innych podopiecznych (trening w parze, wspólna wizyta). */
function ownSession(s: TrainingSession): TrainingSession {
  const { withIds: _w, ...rest } = s;
  void _w;
  return rest;
}

/**
 * Wszystko, co dotyczy jednego podopiecznego: profil (z ankietą, pomiarami, check-inami, wiadomościami,
 * wpisami dziennymi, raportami, zgodami), plany, treningi, wizyty. Bez danych innych klientów.
 */
export function exportData(db: Db, clientId: string, now = new Date()) {
  const client = db.clients.find((c) => c.id === clientId);
  if (!client) return null;
  const plans = db.plans.filter((p) => p.clientId === clientId && !p.template);
  const sessions = db.sessions
    .filter((s) => s.clientId === clientId)
    .map(ownSession)
    .sort((a, b) => (a.date + (a.createdAt ?? '')).localeCompare(b.date + (b.createdAt ?? '')));
  const appointments = db.appointments
    .filter((a) => a.clientId === clientId)
    .map(({ groupId: _g, seriesId: _s, ...a }) => (void _g, void _s, a))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const usedLocations = new Set([client.locationId, ...sessions.map((s) => s.locationId), ...appointments.map((a) => a.locationId)].filter(Boolean));
  const locations = db.locations.filter((l) => usedLocations.has(l.id)).map((l) => ({ id: l.id, name: l.name, address: l.address }));
  return {
    format: 'fitowa-export',
    version: 1,
    exportedAt: now.toISOString(),
    administrator: { name: ADMIN.name, email: ADMIN.email },
    note: 'Twoje dane z aplikacji Fitowa (art. 15 i 20 RODO). Zdjęcia, nagrania i pliki z ankiety są tu jako odnośniki — same pliki pobierzesz w aplikacji albo poprosisz o nie trenera.',
    profile: client,
    plans,
    sessions,
    appointments,
    locations,
  };
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : typeof v === 'number' || (typeof v === 'string' && /^-?\d+\.\d+$/.test(v)) ? String(v).replace('.', ',') : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Treningi jako CSV (Excel w polskiej wersji: średnik, przecinek dziesiętny, BOM) — jedna seria w wierszu. */
export function sessionsCsv(sessions: TrainingSession[]): string {
  const head = ['data', 'trening', 'czas_min', 'srpe', 'bol', 'cwiczenie', 'seria', 'rozgrzewka', 'ciezar_kg', 'powtorzenia', 'powtorzenia_prawa', 'jednostka', 'rpe', 'dystans_km', 'tetno', 'notatka'];
  const rows: unknown[][] = [];
  const sorted = [...sessions].sort((a, b) => (a.date + (a.createdAt ?? '')).localeCompare(b.date + (b.createdAt ?? '')));
  for (const s of sorted) {
    const base = [s.date, s.workoutName ?? '', s.duration, s.srpe, s.pain];
    if (!s.exercises.length) rows.push([...base, '', '', '', '', '', '', '', '', '', '', s.notes ?? '']);
    for (const ex of s.exercises) {
      const sets = ex.setsLog ?? [];
      if (!sets.length) rows.push([...base, ex.name, '', '', ex.load ?? '', ex.reps ?? '', '', '', ex.rpe ?? '', '', '', ex.notes ?? '']);
      sets.forEach((x, i) => rows.push([...base, ex.name, i + 1, x.warmup ? 'tak' : '', x.load, x.reps, x.repsR, x.unit ?? '', x.rpe, x.dist, x.hr, i === 0 ? (ex.notes ?? '') : '']));
    }
  }
  return '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

/** Nazwa pliku: fitowa-dane-jan-kowalski-2026-10-25.json */
export function exportFileName(name: string, ext: 'json' | 'csv', today: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `fitowa-${ext === 'csv' ? 'treningi' : 'dane'}-${slug || 'konto'}-${today}.${ext}`;
}
