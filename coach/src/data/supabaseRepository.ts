import type { Checkin, ClientNote, Measurement } from '../domain';
import type { Intake } from '../lib/intake';
import { normalizeDb, type Change, type Collection, type Db, type Repository } from './db';
import { supabase } from './supabase';

const TABLES: Collection[] = ['clients', 'plans', 'sessions', 'appointments', 'library', 'locations', 'trainer_notes'];
/** Tabele dodane później (SQL może nie być jeszcze uruchomiony) — brak tabeli nie blokuje aplikacji. */
const OPTIONAL: Collection[] = ['trainer_notes'];
const PAGE = 1000;

type Row = { id: string; data: unknown; client_id?: string; email?: string | null; updated_at?: string };

function toRow(col: Collection, item: { id: string } & Record<string, unknown>): Row {
  const row: Row = { id: item.id, data: item, updated_at: new Date().toISOString() };
  if (col === 'clients') row.email = typeof item.email === 'string' && item.email ? item.email.trim().toLowerCase() : null;
  if (col === 'plans' || col === 'sessions' || col === 'appointments' || col === 'trainer_notes') row.client_id = String(item.clientId);
  return row;
}

async function selectAll(table: Collection): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select('data').range(from, from + PAGE - 1);
    if (error && OPTIONAL.includes(table)) return out;
    if (error) throw error;
    out.push(...(data ?? []).map((r) => (r as { data: unknown }).data));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/**
 * Dane w Supabase: każda kolekcja to tabela (id, data jsonb). Reguły RLS decydują,
 * co widzi trener (wszystko), a co klient (tylko swoje).
 * `role` = 'client': klient zapisuje tylko treningi, a check-iny przez funkcję.
 */
export function createSupabaseRepository(role: 'trainer' | 'client'): Repository {
  return {
    async load() {
      const lists = await Promise.all(TABLES.map(selectAll));
      return normalizeDb(Object.fromEntries(TABLES.map((t, i) => [t, lists[i]])) as Partial<Db>);
    },

    async apply(changes: Change[]) {
      for (const ch of changes) {
        if (ch.op === 'del') {
          const { error } = await supabase.from(ch.col).delete().eq('id', ch.id);
          if (error) throw error;
          continue;
        }
        const row = toRow(ch.col, ch.item as unknown as { id: string } & Record<string, unknown>);
        // Klient zapisuje tylko swoje treningi (rozliczenie pilnuje baza: hardening.sql); wizyt nie zmienia.
        if (role === 'client' && ch.col !== 'sessions') continue;
        const { error } = await supabase.from(ch.col).upsert(row);
        if (error && OPTIONAL.includes(ch.col) && /does not exist|schema cache|relation/i.test(error.message)) throw new Error('Brak tabeli trainer_notes — uruchom w Supabase sekcję 15 z hardening.sql.');
        if (error) throw error;
      }
    },

    async replaceAll(next: Db) {
      for (const t of TABLES) {
        const { error } = await supabase.from(t).delete().neq('id', '');
        if (error && OPTIONAL.includes(t)) continue;
        if (error) throw error;
        const rows = (next[t] as unknown as ({ id: string } & Record<string, unknown>)[]).map((item) => toRow(t, item));
        for (let i = 0; i < rows.length; i += 500) {
          const { error: e2 } = await supabase.from(t).insert(rows.slice(i, i + 500));
          if (e2) throw e2;
        }
      }
    },

    async saveHabitDay(clientId: string, date: string, done: string[]) {
      const { error } = await supabase.rpc('save_habit_day', { p_client_id: clientId, p_date: date, p_done: done });
      if (error) throw error;
      // kontrola: stara wersja funkcji w bazie bywa cofana przez strażnika profilu — wtedy zapis „znika”
      const { data } = await supabase.from('clients').select('data').eq('id', clientId).maybeSingle();
      const log = ((data as { data?: { habitLog?: { date: string; done: string[] }[] } } | null)?.data?.habitLog ?? []).find((d) => d.date === date)?.done ?? [];
      if (data && (log.length !== done.length || done.some((x) => !log.includes(x)))) throw new Error('DB_OUTDATED');
    },

    async addClientNote(clientId: string, note: ClientNote) {
      const { error } = await supabase.rpc('add_client_note', { p_client_id: clientId, p_note: note });
      if (error) throw error;
    },

    async saveIntake(clientId: string, intake: Intake) {
      const { error } = await supabase.rpc('save_intake', { p_client_id: clientId, p_intake: intake });
      if (error) throw error;
      // stara wersja save_intake (przed sekcją 18) gubi listę plików — sprawdzamy, czy się zapisała
      if (intake.files?.length) {
        const { data } = await supabase.from('clients').select('data').eq('id', clientId).maybeSingle();
        const saved = (data as { data?: { intake?: { files?: unknown[] } } } | null)?.data?.intake?.files;
        if (data && (saved?.length ?? 0) !== intake.files.length) throw new Error('DB_OUTDATED');
      }
    },

    async addMeasurement(clientId: string, m: Measurement) {
      const { error } = await supabase.rpc('add_measurement', { p_client_id: clientId, p_meas: m });
      if (error) throw error;
    },

    async saveCheckin(clientId: string, checkin: Checkin) {
      const { error } = await supabase.rpc('save_checkin', { p_client_id: clientId, p_checkin: checkin });
      if (error) throw error;
      const { data } = await supabase.from('clients').select('data').eq('id', clientId).maybeSingle();
      const saved = ((data as { data?: { checkins?: { date: string }[] } } | null)?.data?.checkins ?? []).some((c) => c.date === checkin.date);
      if (data && !saved) throw new Error('DB_OUTDATED');
    },
  };
}
