import { useEffect, useState } from 'react';
import { normalizeProfile } from '../lib/trainerProfile';
import { cloudMode } from './config';
import { supabase } from './supabase';

/**
 * Profil trenera — widoczny także dla podopiecznych (imię, zdjęcie, telefon, dane do przelewu,
 * godziny odpowiedzi, urlop). Jeden rekord. W chmurze: tabela `trainer_profile` (sekcja 29
 * w hardening.sql; zapis tylko trener, odczyt każdy zalogowany). Lokalnie: localStorage.
 * Logika (urlop, cennik, porządkowanie): lib/trainerProfile.ts.
 */
export interface TrainerProfile {
  name?: string;
  /** Odnośnik do pliku (sb:trainer/<plik> / idb:<id>) — data/files.ts, otwierany przez fileUrl(). */
  photo?: string;
  phone?: string;
  email?: string;
  bankAccount?: string;
  bankName?: string;
  blikPhone?: string;
  prices?: { single?: number; package?: { sessions: number; price: number }; subscription?: number };
  /** Domyślna długość wizyty w minutach. */
  defaultDuration?: number;
  /** Godziny pracy; days: 1 = poniedziałek … 7 = niedziela. */
  workHours?: { from: string; to: string; days: number[] };
  /** Np. „odpisuję do 20:00”. */
  replyHours?: string;
  /** „Zdanie na tydzień” — używa go zapowiedź tygodnia. */
  weeklyNote?: string;
  /** Urlop trenera: daty YYYY-MM-DD (włącznie); message — automatyczna odpowiedź w rozmowie. */
  vacation?: { from: string; to: string; message?: string };
}

/** Klucz w localStorage (tryb lokalny / demo). */
export const PROFILE_KEY = 'fitowa-trainer-profile';
/** Folder zdjęcia trenera w koszyku „client-files” (odczyt dla podopiecznych: sekcja 29). */
export const PROFILE_PHOTO_FOLDER = 'trainer';

/** Dane przykładowe (tryb lokalny, pierwsze uruchomienie) — żeby podgląd podopiecznego miał co pokazać. */
const DEMO: TrainerProfile = {
  name: 'Sebastian Palej',
  phone: '+48 600 100 200',
  email: 'trener@example.com',
  bankAccount: '11 1111 1111 1111 1111 1111 1111',
  bankName: 'Bank (dane przykładowe)',
  blikPhone: '+48 600 100 200',
  prices: { single: 150, package: { sessions: 10, price: 1300 }, subscription: 520 },
  defaultDuration: 60,
  workHours: { from: '07:00', to: '20:00', days: [1, 2, 3, 4, 5] },
  replyHours: 'Odpisuję w dni robocze do 20:00',
};

/* ---------- zapis lokalny ---------- */

export function loadProfileLocal(): TrainerProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw == null) {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(DEMO));
      return { ...DEMO };
    }
    return normalizeProfile(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveProfileLocal(p: TrainerProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(normalizeProfile(p)));
}

/* ---------- zapis w chmurze (tabela trainer_profile, sekcja 29) ---------- */

export async function loadProfileCloud(): Promise<TrainerProfile> {
  const { data, error } = await supabase.from('trainer_profile').select('data').eq('id', 'me').maybeSingle();
  if (error && /does not exist|schema cache|relation/i.test(error.message)) return {};
  if (error) throw error;
  return normalizeProfile((data as { data?: unknown } | null)?.data);
}

export async function saveProfileCloud(p: TrainerProfile): Promise<void> {
  const { error } = await supabase.from('trainer_profile').upsert({ id: 'me', data: normalizeProfile(p), updated_at: new Date().toISOString() });
  if (error && /does not exist|schema cache|relation/i.test(error.message)) throw new Error('DB_OUTDATED_29');
  if (error) throw error;
}

/* ---------- wspólny stan (wszystkie komponenty widzą ten sam profil) ---------- */

let cache: TrainerProfile | null = null;
let loading: Promise<void> | null = null;
const subs = new Set<(p: TrainerProfile) => void>();
const emit = (p: TrainerProfile) => {
  cache = p;
  subs.forEach((f) => f(p));
};

function ensureLoaded(): void {
  if (cache || loading) return;
  if (!cloudMode()) {
    emit(loadProfileLocal());
    return;
  }
  loading = loadProfileCloud()
    .then(emit)
    .catch(() => emit({}))
    .finally(() => {
      loading = null;
    });
}

/** Odświeżenie z chmury (np. po powrocie do aplikacji). */
export function reloadTrainerProfile(): void {
  cache = null;
  ensureLoaded();
}

if (typeof window !== 'undefined') {
  // tryb lokalny: zmiana w innej karcie (np. podgląd podopiecznego)
  window.addEventListener('storage', (e) => {
    if (e.key === PROFILE_KEY && !cloudMode()) emit(loadProfileLocal());
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && cloudMode() && subs.size) reloadTrainerProfile();
  });
}

/** Zapis profilu (trener). Zwraca false przy błędzie; `error` — komunikat do pokazania. */
export async function saveTrainerProfile(p: TrainerProfile): Promise<{ ok: boolean; error?: string }> {
  const next = normalizeProfile(p);
  const prev = cache;
  emit(next);
  try {
    if (cloudMode()) await saveProfileCloud(next);
    else saveProfileLocal(next);
    return { ok: true };
  } catch (e) {
    if (prev) emit(prev);
    return { ok: false, error: (e as Error).message === 'DB_OUTDATED_29' ? 'Profil nie zapisał się — uruchom w Supabase sekcję 29 z hardening.sql.' : 'Nie udało się zapisać profilu — sprawdź połączenie.' };
  }
}

/** Profil trenera (odczyt dla trenera i podopiecznych) + zapis. Na starcie pusty `{}`, potem wczytany. */
export function useTrainerProfile(): { profile: TrainerProfile; save(p: TrainerProfile): Promise<boolean>; loaded: boolean } {
  const [profile, setProfile] = useState<TrainerProfile>(() => cache ?? {});
  const [loaded, setLoaded] = useState(!!cache);
  useEffect(() => {
    const f = (p: TrainerProfile) => {
      setProfile(p);
      setLoaded(true);
    };
    subs.add(f);
    if (cache) f(cache);
    else ensureLoaded();
    return () => void subs.delete(f);
  }, []);
  return { profile, loaded, save: async (p) => (await saveTrainerProfile(p)).ok };
}

/** Ostatnio wczytany profil (bez Reacta) — np. do automatycznej odpowiedzi w czasie urlopu. */
export function getTrainerProfileCache(): TrainerProfile | null {
  if (!cache) ensureLoaded();
  return cache;
}
