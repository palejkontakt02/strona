/**
 * Połączenie z Supabase. Adres i klucz publiczny (publishable) są jawne z założenia —
 * dostęp do danych ograniczają reguły RLS w bazie (supabase/schema.sql).
 */
export const SUPABASE_URL = 'https://pmsspumbjsapjqkvjscz.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_WTAEHHICN_ZdqJnJTKNUpQ_sGD71FXb';

/**
 * Tryb chmury (logowanie + wspólne dane) działa na docelowej stronie.
 * Lokalnie i w podglądzie aplikacja działa na danych przykładowych w przeglądarce.
 * Wymuszenie trybu chmury do testów: localStorage['fitowa-cloud'] = '1'.
 */
export function cloudMode(): boolean {
  try {
    if (localStorage.getItem('fitowa-cloud') === '1') return true;
  } catch {
    // brak localStorage
  }
  return /(^|\.)sebastianpalej\.pl$/.test(location.hostname);
}
