import { useMemo, useRef, useState } from 'react';
import { useSendMessage } from '../../components/Chat';
import { Sheet } from '../../components/Sheet';
import { Field, Icon, Modal } from '../../components/ui';
import type { Client, Payment, PaymentType } from '../../domain';
import { put, type Db } from '../../data/db';
import { clientById, paymentLabel } from '../../data/ops';
import { useStore } from '../../data/store';
import { useTrainerProfile } from '../../data/trainerProfile';
import { fmtDate, fmtMonth, plural, pln, uid } from '../../format';
import { defaultSubDue, defaultSubMonth, isOverdue, subscriptionCandidates, subscriptionPayment } from '../../lib/billing';
import { todayISO } from '../../lib/dates';
import { num, numIn } from '../../lib/parse';
import { daysOverdue, overdueText, reminderText, remindedText, smsHref } from '../../lib/payReminder';
import { useNav } from '../../nav';

/* ---------- „+ Płatność” — jeden przycisk, arkusz z wyborem typu ---------- */

const PAY_TYPES: { type: PaymentType; label: string; hint: string }[] = [
  { type: 'pakiet', label: 'Pakiet', hint: 'np. 10 sesji, płatne z góry' },
  { type: 'abonament', label: 'Abonament', hint: 'opłata za miesiąc' },
  { type: 'pojedyncza', label: 'Sesja', hint: 'jeden trening' },
  { type: 'inna', label: 'Inna', hint: 'plan dietetyczny, konsultacja…' },
];

export function AddPaymentButton({ clientId }: { clientId?: string }) {
  const { openModal } = useNav();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
        <Icon name="plus" size={16} /> Płatność
      </button>
      {open && (
        <Sheet label="Nowa płatność" onClose={() => setOpen(false)}>
          <div className="between">
            <h3>Nowa płatność</h3>
            <button type="button" className="icon-btn" aria-label="Zamknij" onClick={() => setOpen(false)}>
              <Icon name="x" />
            </button>
          </div>
          <div className="pay-type-list" role="list">
            {PAY_TYPES.map((t) => (
              <button
                key={t.type}
                type="button"
                role="listitem"
                className="pay-type-item"
                onClick={() => {
                  setOpen(false);
                  openModal({ kind: 'payment', type: t.type, ...(clientId ? { clientId } : {}) });
                }}
              >
                <span className="grow">
                  <strong>{t.label}</strong>
                  <span className="muted small">{t.hint}</span>
                </span>
                <Icon name="chevR" size={18} />
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}

/* ---------- komórka „Termin” ---------- */

export function DueCell({ p }: { p: Payment }) {
  const today = todayISO();
  if (p.status === 'paid') return <span className="muted small">opł. {fmtDate(p.paidDate)}</span>;
  const late = daysOverdue(p, today);
  return (
    <span className="pay-due">
      <span>{fmtDate(p.dueDate)}</span>
      {late > 0 && <span className="small text-danger">{overdueText(late)}</span>}
      {p.remindedAt && <span className="small muted">{remindedText(p.remindedAt, today)}</span>}
    </span>
  );
}

/* ---------- filtry jako chipy w jednym rzędzie ---------- */

export function ChipRow<A extends string, B extends string>({
  a,
  aValue,
  onA,
  b,
  bValue,
  onB,
}: {
  a: readonly A[];
  aValue: A;
  onA: (v: A) => void;
  b: readonly B[];
  bValue: B;
  onB: (v: B) => void;
}) {
  return (
    <div className="pay-chips" role="toolbar" aria-label="Filtry płatności">
      <div className="pay-chip-group" role="group" aria-label="Status">
        {a.map((o) => (
          <button key={o} type="button" className={`chip ${aValue === o ? 'active' : ''}`} aria-pressed={aValue === o} onClick={() => onA(o)}>
            {o}
          </button>
        ))}
      </div>
      <span className="pay-chip-sep" aria-hidden="true" />
      <div className="pay-chip-group" role="group" aria-label="Typ">
        {b.map((o) => (
          <button key={o} type="button" className={`chip ${bValue === o ? 'active' : ''}`} aria-pressed={bValue === o} onClick={() => onB(o)}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- „Przypomnij” ---------- */

export function RemindButton({ client, p, onOpen }: { client: Client; p: Payment; onOpen: (r: { clientId: string; paymentId: string }) => void }) {
  if (p.status === 'paid') return null;
  return (
    <button type="button" className={`btn btn-sm ${isOverdue(p) ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => onOpen({ clientId: client.id, paymentId: p.id })}>
      Przypomnij
    </button>
  );
}

export function ReminderModal({ clientId, paymentId, onClose }: { clientId: string; paymentId: string; onClose: () => void }) {
  const { db, apply, toast } = useStore();
  const { profile } = useTrainerProfile();
  const client = clientById(db, clientId);
  const p = client?.payments.find((x) => x.id === paymentId);
  const today = todayISO();
  const initial = useMemo(() => (client && p ? reminderText(client.name, p, paymentLabel(p), profile, today) : ''), [client?.name, p?.id, profile, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const [text, setText] = useState<string | null>(null);
  const body = text ?? initial;
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  // klient z datą przypomnienia — jeden zapis: wiadomość + „przypomniano”
  const marked: Client | undefined = client && p ? { ...client, payments: client.payments.map((x) => (x.id === p.id ? { ...x, remindedAt: today } : x)) } : undefined;
  const send = useSendMessage(marked ?? ({ id: clientId, name: '' } as Client), true);
  if (!client || !p || !marked) return null;
  const first = client.name.split(' ')[0];
  const markOnly = (msg: string) => apply([put('clients', marked)], msg);
  const noBank = !profile.bankAccount?.trim() && !profile.blikPhone?.trim();

  return (
    <Modal
      title={`Przypomnienie – ${client.name}`}
      onClose={onClose}
      submitLabel={busy ? 'Wysyłanie…' : 'Wyślij w aplikacji'}
      onSubmit={async () => {
        if (busy || !body.trim()) return;
        setBusy(true);
        const ok = await send(body, { okMessage: `Wysłano przypomnienie — ${first} zobaczy je w aplikacji.` });
        setBusy(false);
        if (ok) onClose();
      }}
      extraActions={
        <span className="pay-remind-extra">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(body);
              } catch {
                area.current?.select();
                document.execCommand?.('copy');
              }
              void markOnly('Skopiowano — wklej w SMS albo komunikatorze.');
            }}
          >
            <Icon name="copy" size={16} /> Kopiuj
          </button>
          <a className="btn btn-ghost" href={smsHref(client.phone, body)} onClick={() => void markOnly('Otwarto SMS — przypomnienie zapisane.')}>
            <Icon name="chat" size={16} /> SMS
          </a>
        </span>
      }
    >
      <p className="muted small pay-remind-meta">
        {paymentLabel(p)} · {pln(p.amount)}
        {p.dueDate ? ` · termin ${fmtDate(p.dueDate)}` : ''}
        {daysOverdue(p, today) > 0 ? ` · ${overdueText(daysOverdue(p, today))}` : ''}
        {p.remindedAt ? ` · ${remindedText(p.remindedAt, today)}` : ''}
      </p>
      <Field label="Wiadomość" wide hint={noBank ? 'Dodaj numer konta i BLIK w profilu trenera — będą wstawiane automatycznie.' : undefined}>
        <textarea ref={area} className="input pay-remind-text" rows={9} value={body} onChange={(e) => setText(e.target.value)} />
      </Field>
      {!client.phone && <p className="muted small">Brak numeru telefonu klienta — SMS otworzy się bez odbiorcy.</p>}
    </Modal>
  );
}

/* ---------- „Wystaw abonamenty za <miesiąc>” ---------- */

export function hasSubscriptionClients(db: Db): boolean {
  return db.clients.some((c) => c.billing === 'abonament' && c.status !== 'zakończony');
}

export function BulkSubsModal({ onClose, latest }: { onClose: () => void; latest: () => Db }) {
  const { db, apply, toast } = useStore();
  const { profile } = useTrainerProfile();
  const today = todayISO();
  const [month, setMonth] = useState(() => defaultSubMonth(today));
  const [due, setDue] = useState(() => defaultSubDue(defaultSubMonth(today), today));
  const [dueTouched, setDueTouched] = useState(false);
  const list = subscriptionCandidates(db.clients, month, profile.prices?.subscription);
  // wybór i kwoty per miesiąc (zmiana miesiąca = świeże domyślne)
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const key = (id: string) => `${month}|${id}`;
  const isOn = (c: (typeof list)[number]) => !c.issued && (pick[key(c.client.id)] ?? c.checked);
  const amountOf = (c: (typeof list)[number]) => amounts[key(c.client.id)] ?? (c.amount ? String(c.amount) : '');
  const chosen = list.filter(isOn);
  const sum = chosen.reduce((a, c) => a + (num(amountOf(c)) ?? 0), 0);
  const skipped = list.filter((c) => c.issued).length;

  return (
    <Modal
      title={`Wystaw abonamenty za ${fmtMonth(month)}`}
      onClose={onClose}
      submitLabel={`Wystaw (${chosen.length})`}
      onSubmit={async () => {
        if (!chosen.length) return toast('Zaznacz co najmniej jedną osobę.');
        const bad = chosen.find((c) => numIn(amountOf(c), 0.01, 1_000_000) == null);
        if (bad) return toast(`Podaj kwotę dla: ${bad.client.name}.`);
        const created: Record<string, string> = {};
        const changes = chosen.map((c) => {
          const id = uid();
          created[c.client.id] = id;
          return put('clients', { ...c.client, payments: [...c.client.payments, subscriptionPayment(id, month, num(amountOf(c))!, due, today)] });
        });
        if (!(await apply(changes))) return;
        onClose();
        const n = chosen.length;
        toast(`Wystawiono ${n} ${plural(n, 'abonament', 'abonamenty', 'abonamentów')} za ${fmtMonth(month)}.`, {
          label: 'Cofnij',
          run: () => {
            const now = latest();
            const undo = Object.entries(created).flatMap(([cid, pid]) => {
              const c = clientById(now, cid);
              return c ? [put('clients', { ...c, payments: c.payments.filter((x) => x.id !== pid) })] : [];
            });
            void apply(undo, 'Cofnięto — abonamenty usunięte.');
          },
        });
      }}
    >
      <div className="form-grid">
        <Field label="Miesiąc">
          <input
            className="input"
            type="month"
            value={month}
            required
            onChange={(e) => {
              if (!e.target.value) return;
              setMonth(e.target.value);
              if (!dueTouched) setDue(defaultSubDue(e.target.value, today));
            }}
          />
        </Field>
        <Field label="Termin płatności">
          <input
            className="input"
            type="date"
            value={due}
            required
            onChange={(e) => {
              setDue(e.target.value);
              setDueTouched(true);
            }}
          />
        </Field>
      </div>
      {list.length === 0 ? (
        <p className="muted">Nikt nie ma rozliczenia „abonament”. Ustaw je w Profilu klienta (Rozliczenie).</p>
      ) : (
        <ul className="pay-bulk-list">
          {list.map((c) => {
            const on = isOn(c);
            return (
              <li key={c.client.id} className={c.issued ? 'is-issued' : ''}>
                <label className="check grow">
                  <input type="checkbox" checked={on} disabled={c.issued} onChange={(e) => setPick((s) => ({ ...s, [key(c.client.id)]: e.target.checked }))} />
                  <span className="pay-bulk-name">
                    {c.client.name}
                    {c.issued ? <span className="small muted">już wystawiony</span> : c.client.status === 'pauza' ? <span className="small muted">pauza</span> : !c.amount ? <span className="small text-warn">brak stawki w profilu</span> : null}
                  </span>
                </label>
                {!c.issued && (
                  <span className="pay-bulk-amount">
                    <input
                      className="input input-sm"
                      inputMode="decimal"
                      aria-label={`Kwota – ${c.client.name}`}
                      value={amountOf(c)}
                      onChange={(e) => {
                        const v = e.target.value;
                        setAmounts((s) => ({ ...s, [key(c.client.id)]: v }));
                        if (v && pick[key(c.client.id)] == null) setPick((s) => ({ ...s, [key(c.client.id)]: true }));
                      }}
                    />
                    <span className="muted small">zł</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="muted small">
        Razem {pln(sum)} · termin {fmtDate(due)}
        {skipped ? ` · pominięto ${skipped} (już ${plural(skipped, 'ma', 'mają', 'ma')} abonament za ten miesiąc)` : ''}
      </p>
    </Modal>
  );
}
