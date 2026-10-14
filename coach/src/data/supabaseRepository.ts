import type { Checkin, ClientNote } from '../domain';
import { normalizeDb, type Change, type Collection, type Db, type Repository } from './db';
import { supabase } from './supabase';

const TABLES: Collection[] = ['clients', 'plans', 'sessions', 'appointments', 'library', 'locations'];
const PAGE = 1000;

type Row = { id: string; data: unknown; client_id?: string; email?: string | null; updated_at?: string };

function toRow(col: Collection, item: { id: string } & Record<string, unknown>): Row {
  const row: Row = { id: item.id, data: item, updated_at: new Date().toISOString() };
  if (col === 'clients') row.email = typeof item.email === 'string' && item.email ? item.email.trim().toLowerCase() : null;
  if (col === 'plans' || col === 'sessions' || col === 'appointments') row.client_id = String(item.clientId);
  return row;
}

async function selectAll(table: Collection): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select('data').range(from, from + PAGE - 1);
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
        if (error) throw error;
      }
    },

    async replaceAll(next: Db) {
      for (const t of TABLES) {
        const { error } = await supabase.from(t).delete().neq('id', '');
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
    },

    async addClientNote(clientId: string, note: ClientNote) {
      const { error } = await supabase.rpc('add_client_note', { p_client_id: clientId, p_note: note });
      if (error) throw error;
    },

    async saveCheckin(clientId: string, checkin: Checkin) {
      const { error } = await supabase.rpc('save_checkin', { p_client_id: clientId, p_checkin: checkin });
      if (error) throw error;
    },
  };
}
