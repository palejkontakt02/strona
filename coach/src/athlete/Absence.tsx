import { useState } from 'react';
import { Sheet } from '../components/Sheet';
import { Icon } from '../components/ui';
import type { Absence, AbsenceReason, Client } from '../domain';
import { useStore } from '../data/store';
import { uid } from '../format';
import { todayISO } from '../lib/dates';
import { ABSENCE_REASONS, absenceCard, absenceMessage, absenceProblem, defaultAbsenceRange, endEarly, returnMessage, upcomingAbsence } from '../lib/absence';

const dm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

/** „Wypadam z planu”: od–do (domyślnie dziś + 7 dni), powód i notatka; trener dostaje wiadomość. */
export function AbsenceSheet({ client, onClose, notify = true }: { client: Client; onClose: () => void; notify?: boolean }) {
  const { saveClientEntry, sendClientNote, toast } = useStore();
  const today = todayISO();
  const def = defaultAbsenceRange(today);
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);
  const [reason, setReason] = useState<AbsenceReason>('urlop');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const bad = absenceProblem(from, to, today);
    if (bad) return toast(bad);
    const a: Absence = { id: uid(), from, to, reason, at: new Date().toISOString(), ...(note.trim() ? { note: note.trim().slice(0, 500) } : {}) };
    setBusy(true);
    const ok = await saveClientEntry(client.id, 'absences', a, notify ? undefined : 'Zapisano nieobecność.');
    setBusy(false);
    if (!ok) return;
    // wiadomość do trenera (push jak przy każdej wiadomości); w podglądzie trenera — bez wiadomości
    if (notify) void sendClientNote(client.id, absenceMessage(a));
    onClose();
  };
  return (
    <Sheet label="Wypadam z planu" onClose={onClose}>
      <div className="between sheet-top">
        <h2>Wypadam z planu</h2>
        <button className="icon-btn" aria-label="Zamknij" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <p className="muted small">W tym czasie nie dostaniesz przypomnień o treningu i samopoczuciu, a seria tygodni się nie przerwie. Trener dostanie wiadomość.</p>
      <div className="absence-dates">
        <label className="field">
          <span>Od</span>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          <span>Do (włącznie)</span>
          <input className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <div className="field">
        <span>Powód</span>
        <div className="seg absence-reasons" role="radiogroup" aria-label="Powód">
          {ABSENCE_REASONS.map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={reason === k} className={reason === k ? 'active' : ''} onClick={() => setReason(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>Notatka (opcjonalnie)</span>
        <input className="input" value={note} maxLength={500} placeholder="np. wyjazd, wracam na pełnych obrotach" onChange={(e) => setNote(e.target.value)} />
      </label>
      <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => void save()}>
        {busy ? 'Zapisuję…' : 'Zgłoś nieobecność'}
      </button>
    </Sheet>
  );
}

/** Karta na Dziś w czasie nieobecności: spokojnie, bez treningu z planu; „Wracam wcześniej” i trening własny. */
export function AbsenceToday({ client, absence, onOwn, notify = true }: { client: Client; absence: Absence; onOwn: () => void; notify?: boolean }) {
  const { saveClientEntry, sendClientNote, ask } = useStore();
  const today = todayISO();
  const card = absenceCard(absence, today);
  const back = async () => {
    if (!(await ask('Wracasz wcześniej? Nieobecność skończy się wczoraj, a plan i przypomnienia wrócą od dziś.', { confirm: 'Wracam', danger: false }))) return;
    const ok = await saveClientEntry(client.id, 'absences', endEarly(absence, today), 'Witaj z powrotem!');
    if (ok && notify) void sendClientNote(client.id, returnMessage(absence, today));
  };
  return (
    <section className="acard acard-hero absence-card" aria-label="Nieobecność">
      <span className="eyebrow">Przerwa w planie</span>
      <h2>{card.title}</h2>
      <p className="muted">{card.text.slice(card.title.length + 3)}</p>
      {absence.note && <p className="muted small">{absence.note}</p>}
      <div className="actions">
        <button className="btn btn-secondary" onClick={() => void back()}>
          Wracam wcześniej
        </button>
        <button className="btn btn-ghost own-btn" onClick={onOwn}>
          <Icon name="plus" size={18} /> Trening własny
        </button>
      </div>
    </section>
  );
}

/** Mała informacja o zaplanowanej nieobecności i link „Wypadam z planu”. */
export function AbsenceLink({ client, onOpen }: { client: Client; onOpen: () => void }) {
  const up = upcomingAbsence(client.absences, todayISO());
  return (
    <p className="absence-link small">
      {up && (
        <span className="muted">
          Zaplanowana nieobecność: {dm(up.from)}–{dm(up.to)} ·{' '}
        </span>
      )}
      <button type="button" className="link small" onClick={onOpen}>
        Wypadam z planu
      </button>
    </p>
  );
}
