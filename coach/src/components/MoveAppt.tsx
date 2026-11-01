import { useState } from 'react';
import type { Appointment, Client } from '../domain';
import { put } from '../data/db';
import { clientById } from '../data/ops';
import { useStore } from '../data/store';
import { moveVisit } from '../lib/calendarMove';
import { todayISO } from '../lib/dates';
import { moveClashes, moveOptions, moveReply, nextAppointment, whenLabel } from '../lib/moveAppt';
import { Icon } from './ui';

/**
 * Rozmowa (strona trenera): „Przesuń wizytę” — najbliższa wizyta podopiecznego, szybkie +1 h / −1 h / jutro
 * albo inna data i godzina; kolizje sprawdzane przed zapisem; po zapisie gotowa odpowiedź do wysłania.
 */
export function MoveApptBar({ client, onReply }: { client: Client; onReply: (text: string) => void }) {
  const { db, apply, ask, toast } = useStore();
  const today = todayISO();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const appt = nextAppointment(db.appointments, client.id, today);
  if (!appt) return null;

  const go = async (a: Appointment, d: string, t: string) => {
    if (busy || !d || !t) return;
    if (d < today) return toast('Ta data już minęła.');
    if (d === a.date && t === a.time) return setOpen(false);
    const hit = moveClashes(a, d, t, db.appointments);
    if (hit.length && !(await ask(`Kolizja: ${hit.map((x) => `${clientById(db, x.clientId)?.name ?? '—'} ${x.time}`).join(', ')}. Przesunąć mimo to?`, { confirm: 'Przesuń mimo to', danger: false }))) return;
    setBusy(true);
    const changes = moveVisit(db, a, d, t);
    const ids = changes.map((c) => (c as { item: Appointment }).item.id);
    const before = db.appointments.filter((x) => ids.includes(x.id));
    const ok = await apply(changes);
    setBusy(false);
    if (!ok) return;
    toast(`Wizyta przeniesiona na ${whenLabel(d, t, today)}.`, { label: 'Cofnij', run: () => void apply(before.map((x) => put('appointments', x)), 'Cofnięto przeniesienie.') });
    onReply(moveReply(d, t, today));
    setOpen(false);
    setCustom(false);
  };

  return (
    <div className="mv-bar">
      <button type="button" className="btn btn-ghost btn-sm mv-toggle" aria-expanded={open} onClick={() => (setOpen(!open), setDate(appt.date), setTime(appt.time))}>
        <Icon name="cal" size={14} /> Przesuń wizytę <span className="muted">· {whenLabel(appt.date, appt.time, today)}</span>
      </button>
      {open && (
        <div className="mv-panel" role="group" aria-label="Przesuń najbliższą wizytę">
          <div className="mv-quick">
            {moveOptions(appt).map((o) => (
              <button key={o.key} type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void go(appt, o.date, o.time)} title={whenLabel(o.date, o.time, today)}>
                {o.label}
              </button>
            ))}
            <button type="button" className={`btn btn-sm ${custom ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={custom} onClick={() => setCustom(!custom)}>
              inna data i godzina
            </button>
          </div>
          {custom && (
            <div className="mv-custom">
              <input className="input input-sm" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Nowa data wizyty" />
              <input className="input input-sm" type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Nowa godzina wizyty" />
              <button type="button" className="btn btn-primary btn-sm" disabled={busy || !date || !time} onClick={() => void go(appt, date, time)}>
                Przesuń
              </button>
            </div>
          )}
          {date && time && (date !== appt.date || time !== appt.time) && custom && moveClashes(appt, date, time, db.appointments).length > 0 && (
            <p className="small warn-text">Kolizja z inną wizytą o tej porze.</p>
          )}
        </div>
      )}
    </div>
  );
}
