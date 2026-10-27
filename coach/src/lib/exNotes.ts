/**
 * Prywatne notatki podopiecznego do ćwiczeń („siedzisko na 4”, „lewy kabel”).
 * Klucz = znormalizowana nazwa ćwiczenia (bez wielkości liter i polskich znaków), więc notatka wraca
 * przy każdym treningu z tym ćwiczeniem. Zapis: wpis klienta `exNotes` (save_client_entry, sekcja 26).
 */
import type { ExNote } from '../domain';
import { normName } from './progressMuscles';

/** Klucz notatki: znormalizowana nazwa, najwyżej 64 znaki (limit id w bazie). */
export const exNoteKey = (name: string) => normName(name).replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 64);

/** Notatka do ćwiczenia (pusta = brak). */
export function exNoteFor(notes: ExNote[] | undefined, name: string): ExNote | null {
  const k = exNoteKey(name);
  if (!k) return null;
  const n = (notes ?? []).find((x) => x.id === k);
  return n && n.text.trim() ? n : null;
}

/** Nowy wpis do zapisu (tekst przycięty do 300 znaków; pusty = usunięcie notatki). */
export function exNoteEntry(name: string, text: string, at = new Date().toISOString()): ExNote {
  return { id: exNoteKey(name), name: name.trim().slice(0, 120), text: text.trim().slice(0, 300), at };
}
