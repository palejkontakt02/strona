import { useMemo, useState, type ReactNode } from 'react';
import { Icon, Seg } from '../components/ui';
import { useStore } from '../data/store';
import { fmtDay, fmtWeekday, pln } from '../format';
import { todayISO } from '../lib/dates';
import { DEFAULT_DIR, overviewRows, sortRows, type OverviewRow, type SortKey, type Tone } from '../lib/overviewTable';
import { useNav } from '../nav';

const FILTERS = ['Wszyscy', 'Wymagają uwagi'] as const;

const COLS: { key: SortKey; label: string; title?: string }[] = [
  { key: 'name', label: 'Podopieczny' },
  { key: 'last', label: 'Ostatni trening', title: 'Dni od ostatniego treningu (bursztyn > 7, czerwony > 14)' },
  { key: 'next', label: 'Następna wizyta' },
  { key: 'pkg', label: 'Pakiet', title: 'Ile treningów zostało w pakiecie' },
  { key: 'overdue', label: 'Zaległość' },
  { key: 'wellness', label: 'Samopoczucie', title: 'Ostatni odczyt (średnia 1–5); bursztyn — wyraźny spadek względem poprzednich' },
  { key: 'food', label: 'Jedzenie 7 dni', title: 'Średnio z dni z wpisem względem celu: kalorie i białko' },
  { key: 'habits', label: 'Nawyki 7 dni', title: 'Odhaczone zadania dzienne z 7 dni' },
  { key: 'report', label: 'Raport', title: 'Raport tygodniowy za bieżący tydzień' },
  { key: 'unread', label: 'Wiadomości', title: 'Nieprzeczytane wiadomości' },
];

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const toneCls = (t: Tone | 'ok') => (t ? ` ov-${t}` : '');

function Cell({ tone, children, label }: { tone?: Tone | 'ok'; children: ReactNode; label?: string }) {
  return (
    <td className={`ov-cell${toneCls(tone)}`} aria-label={label}>
      {children}
    </td>
  );
}

/** Tabela wszystkich aktywnych podopiecznych: sygnały w jednym miejscu, sortowanie po kolumnach. */
export function OverviewTable({ compact }: { compact?: boolean }) {
  const { db } = useStore();
  const { openClient } = useNav();
  const today = todayISO();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('Wszyscy');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });
  const all = useMemo(() => overviewRows(db, today), [db, today]);
  const rows = sortRows(filter === 'Wszyscy' ? all : all.filter((r) => r.attention), sort.key, sort.dir);
  const attention = all.filter((r) => r.attention).length;

  const clickSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: DEFAULT_DIR[key] }));

  return (
    <div className={`ov${compact ? ' ov-compact' : ''}`}>
      <div className="ov-head">
        {!compact && (
          <div>
            <h2>Wszyscy podopieczni</h2>
            <p className="muted small">Kliknij nagłówek, by posortować, a wiersz — by otworzyć kartę podopiecznego.</p>
          </div>
        )}
        <Seg options={FILTERS} value={filter} onChange={setFilter} label="Filtr tabeli" />
        <span className="muted small ov-count">
          {attention} z {all.length} wymaga uwagi
        </span>
      </div>
      <div className="ov-scroll" tabIndex={0} role="region" aria-label="Tabela podopiecznych">
        <table className="ov-table">
          <thead>
            <tr>
              {COLS.map((c) => (
                <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined} className={c.key === 'name' ? 'ov-sticky' : ''}>
                  <button className="ov-sort" onClick={() => clickSort(c.key)} title={c.title}>
                    {c.label}
                    <span className="ov-arrow" aria-hidden>
                      {sort.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Row key={r.id} r={r} today={today} onOpen={() => openClient(r.id)} />
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLS.length} className="empty">
                  {filter === 'Wszyscy' ? 'Brak aktywnych podopiecznych.' : 'Nikt nie wymaga teraz uwagi.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ r, today, onOpen }: { r: OverviewRow; today: string; onOpen: () => void }) {
  const food = [r.kcalPct != null && `kcal ${pct(r.kcalPct)}`, r.proteinPct != null && `B ${pct(r.proteinPct)}`].filter(Boolean).join(' · ');
  return (
    <tr className={`ov-row${r.attention ? ' ov-attn' : ''}`} onClick={onOpen}>
      <th scope="row" className="ov-sticky ov-name">
        <button className="link" onClick={(e) => (e.stopPropagation(), onOpen())}>
          {r.name}
        </button>
      </th>
      <Cell tone={r.lastTone}>{r.lastDays == null ? 'brak' : r.lastDays === 0 ? 'dziś' : r.lastDays === 1 ? 'wczoraj' : `${r.lastDays} dni`}</Cell>
      <Cell>{r.next ? (r.next.date === today ? `dziś ${r.next.time}` : `${fmtWeekday(r.next.date)} ${fmtDay(r.next.date)} ${r.next.time}`) : '—'}</Cell>
      <Cell tone={r.pkgTone}>{r.pkgLeft == null ? '—' : r.pkgLeft < 0 ? `${-r.pkgLeft} ponad` : `zostało ${r.pkgLeft}`}</Cell>
      <Cell tone={r.overdue > 0 ? 'danger' : undefined}>{r.overdue > 0 ? pln(r.overdue) : '—'}</Cell>
      <Cell tone={r.wellnessDrop ? 'warn' : undefined} label={r.wellnessDrop ? 'spadek samopoczucia' : undefined}>
        {r.wellness == null ? '—' : `${r.wellness.toLocaleString('pl-PL', { maximumFractionDigits: 1 })}/5${r.wellnessDrop ? ' ↓' : ''}`}
      </Cell>
      <Cell tone={r.foodTone}>{food || '—'}</Cell>
      <Cell tone={r.habitsTone}>{pct(r.habitsPct)}</Cell>
      <Cell tone={r.report === 'sent' ? 'ok' : r.report === 'missing' ? 'warn' : undefined}>{r.report === 'sent' ? 'wysłany' : r.report === 'missing' ? 'brak' : '—'}</Cell>
      <Cell tone={r.unread ? 'warn' : undefined}>
        {r.unread ? (
          <span className="ov-unread">
            <Icon name="mail" size={13} /> {r.unread}
          </span>
        ) : (
          '—'
        )}
      </Cell>
    </tr>
  );
}
