import { useMemo, useState } from 'react';
import { Field, Modal } from '../components/ui';
import type { Client } from '../domain';
import { put } from '../data/db';
import { useStore } from '../data/store';
import { plural } from '../format';
import { AUDIENCE_LABEL, audience, broadcastClients, fillName, type Audience } from '../lib/broadcast';
import { todayISO } from '../lib/dates';

const KINDS: Audience[] = ['active', 'picked', 'club', 'idle7'];
const osob = (n: number) => `${n} ${plural(n, 'osoby', 'osób', 'osób')}`;

/** Wiadomości → „Nowa wiadomość do…”: ta sama wiadomość (z {imię}) do wielu podopiecznych naraz. */
export function BroadcastModal({ onClose }: { onClose: () => void }) {
  const { db, apply, ask, toast } = useStore();
  const today = todayISO();
  const [kind, setKind] = useState<Audience>('active');
  const [loc, setLoc] = useState(db.locations[0]?.id ?? '');
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [text, setText] = useState('Cześć {imię}! ');
  const [busy, setBusy] = useState(false);
  const active = useMemo(() => db.clients.filter((c) => c.status === 'aktywny').sort((a, b) => a.name.localeCompare(b.name, 'pl')), [db.clients]);
  const to: Client[] = useMemo(() => audience(db.clients, db.sessions, kind, today, { locationId: loc, ids: [...ids] }), [db.clients, db.sessions, kind, today, loc, ids]);
  const sample = to[0] ?? active[0];
  const body = text.trim();

  const send = async () => {
    if (busy) return;
    if (!body) return toast('Wpisz treść wiadomości.');
    if (!to.length) return toast('Brak odbiorców — wybierz inną grupę.');
    if (!(await ask(`Wyślesz do ${osob(to.length)}: ${to.slice(0, 5).map((c) => c.name.split(' ')[0]).join(', ')}${to.length > 5 ? ` i ${to.length - 5} innych` : ''}. Każdy dostanie ją w swojej rozmowie (i powiadomienie na telefon, jeśli je włączył).`, { confirm: `Wyślij do ${osob(to.length)}`, danger: false }))) return;
    setBusy(true);
    const ok = await apply(broadcastClients(to, body).map((c) => put('clients', c)), `Wysłano do ${osob(to.length)}.`);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal title="Nowa wiadomość do…" onClose={onClose} onSubmit={() => void send()} submitLabel={busy ? 'Wysyłam…' : to.length ? `Wyślij do ${osob(to.length)}` : 'Wyślij'}>
      <div className="bc-kinds chips" role="radiogroup" aria-label="Odbiorcy">
        {KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={`chip${kind === k ? ' active' : ''}`} onClick={() => setKind(k)}>
            {AUDIENCE_LABEL[k]}
          </button>
        ))}
      </div>
      {kind === 'club' && (
        <Field label="Miejsce treningów (domyślne u podopiecznego)" wide>
          <select className="input" value={loc} onChange={(e) => setLoc(e.target.value)}>
            {db.locations.length === 0 && <option value="">Brak miejsc — dodaj w Ustawieniach</option>}
            {db.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {kind === 'picked' && (
        <ul className="bc-pick rows" aria-label="Wybierz odbiorców">
          {active.map((c) => (
            <li key={c.id} className="row">
              <label className="tp-check grow">
                <input
                  type="checkbox"
                  checked={ids.has(c.id)}
                  onChange={(e) =>
                    setIds((s) => {
                      const x = new Set(s);
                      if (e.target.checked) x.add(c.id);
                      else x.delete(c.id);
                      return x;
                    })
                  }
                />
                <span className="ellipsis">{c.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <p className="small bc-count" aria-live="polite">
        {to.length ? (
          <>
            <b>{osob(to.length)}</b>
            <span className="muted">
              {' · '}
              {to.slice(0, 6).map((c) => c.name.split(' ')[0]).join(', ')}
              {to.length > 6 ? '…' : ''}
            </span>
          </>
        ) : (
          <span className="muted">Brak odbiorców w tej grupie (tylko aktywni podopieczni).</span>
        )}
      </p>
      <Field label="Treść" wide hint="{imię} zamieni się na imię każdego podopiecznego.">
        <textarea className="input" rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} aria-label="Treść wiadomości do wielu" />
      </Field>
      {body && sample && (
        <div className="bc-preview">
          <span className="eyebrow">Podgląd — {sample.name.split(' ')[0]}</span>
          <p className="pre">{fillName(body, sample)}</p>
        </div>
      )}
    </Modal>
  );
}
