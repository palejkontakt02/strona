import { useState } from 'react';
import { Card, Empty, Field, IconBtn, Tag } from '../../components/ui';
import type { Billing, Client, ClientStatus } from '../../domain';
import { del, put } from '../../data/db';
import { sessionsOf } from '../../data/ops';
import { useStore } from '../../data/store';
import { fmtDate, slugify } from '../../format';
import { num } from '../../lib/parse';
import { useNav } from '../../nav';
import { LocationSelect } from '../../components/location';

type Draft = Record<string, string>;

const TEXT_FIELDS = ['name', 'phone', 'email', 'goal', 'level', 'sport', 'position', 'experience', 'injuries', 'notes'] as const;
const DATE_FIELDS = ['dob', 'targetDate', 'startDate'] as const;
const NUM_FIELDS = ['height', 'daysPerWeek', 'singleRate', 'subRate', 'pkgSize', 'pkgPrice'] as const;

export function toDraft(c: Partial<Client>): Draft {
  const d: Draft = { status: c.status ?? 'aktywny', billing: c.billing ?? '', dominant: c.dominant ?? '', locationId: c.locationId ?? '' };
  for (const k of [...TEXT_FIELDS, ...DATE_FIELDS]) d[k] = (c[k] as string | undefined) ?? '';
  for (const k of NUM_FIELDS) d[k] = c[k] != null ? String(c[k]) : '';
  return d;
}

export function fromDraft(base: Client, d: Draft): Client {
  const c: Client = { ...base, status: d.status as ClientStatus, billing: (d.billing || undefined) as Billing | undefined, dominant: d.dominant as Client['dominant'], locationId: d.locationId || undefined };
  for (const k of TEXT_FIELDS) (c as unknown as Record<string, unknown>)[k] = d[k].trim() || undefined;
  c.name = d.name.trim();
  for (const k of DATE_FIELDS) (c as unknown as Record<string, unknown>)[k] = d[k] || undefined;
  for (const k of NUM_FIELDS) (c as unknown as Record<string, unknown>)[k] = num(d[k]) ?? undefined;
  return c;
}

/** Pola formularza danych klienta (używane w Profilu i w oknie „Nowy podopieczny”). */
export function ClientFields({ d, set, compact }: { d: Draft; set: (k: string, v: string) => void; compact?: boolean }) {
  const inp = (k: string, type = 'text', extra: Record<string, unknown> = {}) => (
    <input className="input" type={type} value={d[k]} onChange={(e) => set(k, e.target.value)} {...extra} />
  );
  return (
    <div className="form-grid">
      <Field label="Imię i nazwisko" wide={compact}>
        {inp('name', 'text', { required: true, autoFocus: compact })}
      </Field>
      <Field label="Telefon">{inp('phone', 'tel')}</Field>
      <Field label="E-mail">{inp('email', 'email')}</Field>
      <Field label="Cel" wide>
        {inp('goal')}
      </Field>
      <Field label="Sport / aktywność">{inp('sport')}</Field>
      {!compact && <Field label="Pozycja">{inp('position')}</Field>}
      {!compact && (
        <>
          <Field label="Data urodzenia">{inp('dob', 'date')}</Field>
          <Field label="Wzrost (cm)">{inp('height', 'text', { inputMode: 'numeric' })}</Field>
          <Field label="Strona dominująca">
            <select className="input" value={d.dominant} onChange={(e) => set('dominant', e.target.value)}>
              <option value="">—</option>
              <option value="prawa">prawa</option>
              <option value="lewa">lewa</option>
            </select>
          </Field>
          <Field label="Staż treningowy">{inp('experience')}</Field>
          <Field label="Poziom">{inp('level')}</Field>
          <Field label="Dni treningowe / tydz.">{inp('daysPerWeek', 'text', { inputMode: 'numeric' })}</Field>
          <Field label="Najbliższy start / cel">{inp('targetDate', 'date')}</Field>
          <Field label="Początek współpracy">{inp('startDate', 'date')}</Field>
          <Field label="Status">
            <select className="input" value={d.status} onChange={(e) => set('status', e.target.value)}>
              <option value="aktywny">aktywny</option>
              <option value="pauza">pauza</option>
              <option value="zakończony">zakończony</option>
            </select>
          </Field>
        </>
      )}
      <Field label="Rozliczenie">
        <select className="input" value={d.billing} onChange={(e) => set('billing', e.target.value)}>
          <option value="">automatycznie</option>
          <option value="pakiet">pakiet</option>
          <option value="abonament">abonament</option>
          <option value="pojedyncza">sesje pojedyncze</option>
          <option value="klub">przez klub (klub mi wypłaca)</option>
          <option value="brak">brak</option>
        </select>
      </Field>
      <Field label="Miejsce treningów">
        <LocationSelect value={d.locationId} onChange={(v) => set('locationId', v)} />
      </Field>
      <Field label="Stawka za sesję (zł)">{inp('singleRate', 'text', { inputMode: 'decimal' })}</Field>
      {!compact && (
        <>
          <Field label="Abonament (zł / mies.)">{inp('subRate', 'text', { inputMode: 'decimal' })}</Field>
          <Field label="Pakiet – liczba sesji">{inp('pkgSize', 'text', { inputMode: 'numeric' })}</Field>
          <Field label="Pakiet – cena (zł)">{inp('pkgPrice', 'text', { inputMode: 'decimal' })}</Field>
          <Field label="Urazy (podsumowanie)" wide>
            {inp('injuries')}
          </Field>
          <Field label="Notatki" wide>
            <textarea className="input" rows={3} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </>
      )}
    </div>
  );
}

const INJ_TONE = { aktywny: 'danger', 'w rehabilitacji': 'warn', wyleczony: 'ok' } as const;

export function ClientProfile({ client }: { client: Client }) {
  const { db, apply, ask } = useStore();
  const { openModal, closeClient } = useNav();
  const [d, setD] = useState<Draft>(() => toDraft(client));
  const [dirty, setDirty] = useState(false);
  const set = (k: string, v: string) => {
    setD((x) => ({ ...x, [k]: v }));
    setDirty(true);
  };

  const save = async () => {
    if (!d.name.trim()) return;
    await apply([put('clients', fromDraft(client, d))], 'Zapisano zmiany.');
    setDirty(false);
  };

  const exportData = () => {
    const data = {
      client,
      plans: db.plans.filter((p) => p.clientId === client.id),
      sessions: sessionsOf(db, client.id),
      appointments: db.appointments.filter((a) => a.clientId === client.id),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dane-${slugify(client.name)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const remove = async () => {
    if (!(await ask(`Usunąć podopiecznego ${client.name} razem z planami, treningami i wizytami? Tego nie da się cofnąć.`))) return;
    await apply(
      [
        del('clients', client.id),
        ...db.plans.filter((p) => p.clientId === client.id).map((p) => del('plans', p.id)),
        ...db.sessions.filter((s) => s.clientId === client.id).map((s) => del('sessions', s.id)),
        ...db.appointments.filter((a) => a.clientId === client.id).map((a) => del('appointments', a.id)),
      ],
      'Podopieczny usunięty.',
    );
    closeClient();
  };

  const injuries = [...client.injuryLog].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <>
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="card-head">
          <h4>Dane zawodnika</h4>
          <button type="submit" className="btn btn-primary btn-sm" disabled={!dirty}>
            {dirty ? 'Zapisz zmiany' : 'Zapisano'}
          </button>
        </div>
        <ClientFields d={d} set={set} />
      </form>

      <Card
        className="section-gap"
        title="Historia urazów"
        action={
          <button className="btn btn-secondary btn-sm" onClick={() => openModal({ kind: 'injury', clientId: client.id })}>
            + Uraz
          </button>
        }
      >
        {injuries.length === 0 ? (
          <Empty>Brak zapisanych urazów.</Empty>
        ) : (
          <ul className="rows">
            {injuries.map((i) => (
              <li key={i.id} className="row row-top">
                <div className="grow">
                  <strong>{i.name}</strong>
                  {i.side && <span className="muted"> · {i.side}</span>}
                  <div className="muted small">
                    {fmtDate(i.date)}
                    {i.returnDate && ` · powrót: ${fmtDate(i.returnDate)}`}
                  </div>
                  {i.note && <div className="small">{i.note}</div>}
                </div>
                <Tag tone={INJ_TONE[i.status]}>{i.status}</Tag>
                <IconBtn icon="edit" label="Edytuj uraz" onClick={() => openModal({ kind: 'injury', clientId: client.id, injury: i })} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="section-gap" title="Dane osobowe (RODO)">
        <p className="muted small">Eksport wszystkich danych podopiecznego do pliku albo trwałe usunięcie.</p>
        <div className="actions">
          <button className="btn btn-secondary btn-sm" onClick={exportData}>
            Eksportuj dane (JSON)
          </button>
          <button className="btn btn-danger btn-sm" onClick={remove}>
            Usuń podopiecznego
          </button>
        </div>
      </Card>
    </>
  );
}
