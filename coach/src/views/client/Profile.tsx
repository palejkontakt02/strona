import { ClientHealth, ClientIntakeCard } from './Health';
import { useEffect, useRef, useState } from 'react';
import { Card, Empty, Field, IconBtn, Tag } from '../../components/ui';
import type { Billing, Client, ClientStatus } from '../../domain';
import { del, put } from '../../data/db';
import { sessionsOf } from '../../data/ops';
import { useStore } from '../../data/store';
import { fmtDate, slugify } from '../../format';
import { num } from '../../lib/parse';
import { parseDur } from '../../lib/running';
import { useNav } from '../../nav';
import { LocationSelect } from '../../components/location';
import { AccountStatusCard } from '../../components/accounts';
import { isEmail, normalizePhone } from '../../lib/onboarding';

type Draft = Record<string, string>;

const TEXT_FIELDS = ['name', 'phone', 'email', 'goal', 'level', 'sport', 'position', 'experience', 'injuries', 'notes'] as const;
const DATE_FIELDS = ['dob', 'targetDate', 'startDate'] as const;
const NUM_FIELDS = ['height', 'daysPerWeek', 'singleRate', 'pairRate', 'subRate', 'pkgSize', 'pkgPrice'] as const;

export function toDraft(c: Partial<Client>): Draft {
  const d: Draft = { status: c.status ?? 'aktywny', billing: c.billing ?? '', dominant: c.dominant ?? '', locationId: c.locationId ?? '' };
  for (const k of [...TEXT_FIELDS, ...DATE_FIELDS]) d[k] = (c[k] as string | undefined) ?? '';
  for (const k of NUM_FIELDS) d[k] = c[k] != null ? String(c[k]) : '';
  d.runHrMax = c.run?.hrMax != null ? String(c.run.hrMax) : '';
  d.runT5k = c.run?.t5k ?? '';
  d.runLthr = c.run?.lthr != null ? String(c.run.lthr) : '';
  return d;
}

export function fromDraft(base: Client, d: Draft): Client {
  const c: Client = { ...base, status: d.status as ClientStatus, billing: (d.billing || undefined) as Billing | undefined, dominant: d.dominant as Client['dominant'], locationId: d.locationId || undefined };
  for (const k of TEXT_FIELDS) (c as unknown as Record<string, unknown>)[k] = d[k].trim() || undefined;
  c.name = d.name.trim();
  // telefon: polski numer zapisany jednolicie (+48 600 100 200); nierozpoznany zostaje jak wpisany
  if (c.phone) c.phone = normalizePhone(c.phone) ?? c.phone;
  if (c.email) c.email = c.email.toLowerCase();
  for (const k of DATE_FIELDS) (c as unknown as Record<string, unknown>)[k] = d[k] || undefined;
  for (const k of NUM_FIELDS) (c as unknown as Record<string, unknown>)[k] = num(d[k]) ?? undefined;
  // bieganie: strefy tętna / tempa (pola z formularza; brak — bez zmian w zapisie)
  if (d.runHrMax !== undefined || d.runT5k !== undefined || d.runLthr !== undefined) {
    const hrMax = num(d.runHrMax ?? '') ?? undefined;
    const t5k = (d.runT5k ?? '').trim() || undefined;
    // tętno progowe: pole może nie istnieć w starszych formularzach — wtedy zostaje zapisane
    const lthr = d.runLthr !== undefined ? num(d.runLthr) ?? undefined : base.run?.lthr;
    c.run = hrMax || t5k || lthr ? { ...base.run, hrMax, t5k, lthr } : undefined;
  }
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
      <Field label="Telefon" hint={d.phone?.trim() && !normalizePhone(d.phone) ? <span className="warn-text">Sprawdź numer — np. 600 100 200 albo +48 600 100 200.</span> : undefined}>
        {inp('phone', 'tel', {
          inputMode: 'tel',
          autoComplete: 'off',
          placeholder: '+48 600 100 200',
          onBlur: () => {
            const n = normalizePhone(d.phone);
            if (n && n !== d.phone) set('phone', n);
          },
        })}
      </Field>
      <Field
        label="E-mail"
        hint={d.email?.trim() && !isEmail(d.email) ? <span className="warn-text">Sprawdź adres e-mail — tym adresem podopieczny założy konto.</span> : compact ? 'Potrzebny do konta w aplikacji.' : undefined}
      >
        {inp('email', 'email', { inputMode: 'email', autoComplete: 'off', autoCapitalize: 'none', spellCheck: false, placeholder: 'np. anna@gmail.com' })}
      </Field>
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
          <Field label="Bieg: tętno maks.">
            {inp('runHrMax', 'text', { inputMode: 'numeric', placeholder: 'z testu, np. 192' })}
            {d.runHrMax?.trim() && !((num(d.runHrMax) ?? 0) > 120 && (num(d.runHrMax) ?? 0) < 230) && <span className="small warn-text">Tętno maks. zwykle 121–229 — przy tej wartości strefy liczą się z wieku.</span>}
          </Field>
          <Field label="Tętno progowe (LTHR)" hint="Test: 30 min biegu solo na maksa, równym tempem; LTHR = średnie tętno z ostatnich 20 min. Gdy wpisane, strefy liczą się od progu.">
            {inp('runLthr', 'text', { inputMode: 'numeric', placeholder: 'z testu, np. 172' })}
            {d.runLthr?.trim() && !((num(d.runLthr) ?? 0) >= 100 && (num(d.runLthr) ?? 0) <= 215) && <span className="small warn-text">Tętno progowe zwykle 100–215 — przy tej wartości strefy liczą się z tętna maks.</span>}
          </Field>
          <Field label="Bieg: czas na 5 km">
            {inp('runT5k', 'text', { placeholder: 'np. 25:30' })}
            {d.runT5k?.trim() && !((parseDur(d.runT5k) ?? 0) > 10 && (parseDur(d.runT5k) ?? 0) < 90) && <span className="small warn-text">Wpisz czas całych 5 km (np. 25:30), nie tempo na km — inaczej tempa stref się nie policzą.</span>}
          </Field>
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
      <Field label="Stawka w parze (zł)">{inp('pairRate', 'text', { inputMode: 'decimal', placeholder: 'za osobę' })}</Field>
      {!compact && (
        <>
          <Field label="Abonament (zł / mies.)">{inp('subRate', 'text', { inputMode: 'decimal' })}</Field>
          <Field label="Pakiet – liczba sesji">{inp('pkgSize', 'text', { inputMode: 'numeric' })}</Field>
          <Field label="Pakiet – cena (zł)">{inp('pkgPrice', 'text', { inputMode: 'decimal' })}</Field>
          <Field label="Urazy (podsumowanie)" wide>
            {inp('injuries')}
          </Field>
          <Field label="Notatki" wide hint="Podopieczny ma techniczny dostęp do swojego profilu — nie wpisuj tu nic, czego nie powinien przeczytać.">
            <textarea className="input" rows={3} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </>
      )}
    </div>
  );
}

const INJ_TONE = { aktywny: 'danger', 'w rehabilitacji': 'warn', przewlekły: 'muted', wyleczony: 'ok' } as const;

export function ClientProfile({ client }: { client: Client }) {
  const { db, apply, ask } = useStore();
  const { openModal, closeClient } = useNav();
  const [d, setD] = useState<Draft>(() => toDraft(client));
  const [dirty, setDirty] = useState(false);
  const set = (k: string, v: string) => {
    setD((x) => ({ ...x, [k]: v }));
    setDirty(true);
  };

  const save = async (quiet = false) => {
    if (!d.name.trim()) return;
    await apply([put('clients', fromDraft(client, d))], quiet ? undefined : 'Zapisano zmiany.');
    setDirty(false);
  };
  // autozapis: chwilę po ostatniej zmianie i przy wyjściu z zakładki (zmiany nie giną po przejściu do „Przegląd”)
  const latest = useRef({ d, dirty, client, apply });
  latest.current = { d, dirty, client, apply };
  useEffect(() => {
    if (!dirty) return;
    const t = window.setTimeout(() => void save(true), 1500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, dirty]);
  useEffect(
    () => () => {
      const { d: dd, dirty: dt, client: c, apply: ap } = latest.current;
      if (dt && dd.name.trim()) void ap([put('clients', fromDraft(c, dd))], 'Zapisano zmiany w profilu.');
    },
    [],
  );

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
        ...db.trainer_notes.filter((n) => n.clientId === client.id).map((n) => del('trainer_notes', n.id)),
      ],
      'Podopieczny usunięty.',
    );
    closeClient();
  };

  const injuries = [...client.injuryLog].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="stack profile-stack">
      <AccountStatusCard client={client} />
      <ClientIntakeCard client={client} />
      <ClientHealth client={client} />
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="card-head">
          <h4>Dane zawodnika</h4>
          {dirty ? (
            <button type="submit" className="btn btn-primary btn-sm">
              Zapisz
            </button>
          ) : (
            <span className="save-state">✓ Zapisano</span>
          )}
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
    </div>
  );
}
