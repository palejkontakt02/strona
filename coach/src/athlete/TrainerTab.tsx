import { useState } from 'react';
import { Chat } from '../components/Chat';
import { LocationTag } from '../components/location';
import { Sheet } from '../components/Sheet';
import { Icon } from '../components/ui';
import type { Appointment, Client } from '../domain';
import { useStore } from '../data/store';
import { fmtLong } from '../format';
import { CANCEL_HOURS, hoursUntil, isLateCancel } from '../lib/appts';
import { todayISO } from '../lib/dates';
import { apptIcs, icsName } from '../lib/ics';
import { upcomingVisits } from './History';

const OPEN_KEY = 'fitowa-visits-open';

/** Plik .ics: udostępnij (telefon — „Dodaj do kalendarza” w menu systemowym) albo pobierz. */
async function addToCalendar(a: Appointment, location?: string) {
  const ics = apptIcs(a, { location });
  const name = icsName(a);
  const file = new File([ics], name, { type: 'text/calendar' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Trening z trenerem' });
      return;
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Zwijany blok „Najbliższe wizyty”: potwierdź, odwołaj (z powodem), dodaj do kalendarza. */
export function Visits({ client, preview }: { client: Client; preview?: boolean }) {
  const { db, respondAppointment, toast } = useStore();
  const today = todayISO();
  const next = upcomingVisits(db.appointments, client.id).slice(0, 6);
  // odwołane przez podopiecznego (do dziś) — żeby widział, że trener dostał informację
  const cancelled = db.appointments
    .filter((a) => a.clientId === client.id && a.status === 'cancel' && a.reply?.kind === 'cancel' && a.date >= today)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
    .slice(0, 3);
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(OPEN_KEY, open ? '0' : '1');
    } catch {
      /* bez pamięci — tylko na teraz */
    }
  };
  if (!next.length && !cancelled.length) return null;
  const locName = (a: Appointment) => db.locations.find((l) => l.id === a.locationId)?.name ?? a.location;
  const confirm = async (a: Appointment) => {
    setBusy(a.id);
    if (await respondAppointment(a.id, 'confirm')) toast(preview ? 'Potwierdzono (podgląd).' : 'Potwierdzone — trener dostał informację.');
    setBusy(null);
  };
  return (
    <section className={`acard visits${open ? ' open' : ''}`}>
      <button type="button" className="visits-head" aria-expanded={open} onClick={toggle}>
        <span className="grow">
          <b>Najbliższe wizyty</b>
          {!open && next[0] && (
            <span className="muted small">
              {' '}
              · {next[0].date === today ? 'dziś' : fmtLong(next[0].date)} {next[0].time}
            </span>
          )}
        </span>
        <Icon name={open ? 'up' : 'chevD'} size={18} />
      </button>
      {open && (
        <ul className="visits-list">
          {next.map((a) => {
            const confirmed = a.reply?.kind === 'confirm';
            return (
              <li key={a.id} className="visit">
                <div className="visit-when">
                  <span className="visit-time">{a.time}</span>
                  <div className="grow">
                    <span className="first-cap">{a.date === today ? 'Dziś' : fmtLong(a.date)}</span>
                    <div className="small muted">
                      <LocationTag id={a.locationId} />
                      {!a.locationId && a.location}
                    </div>
                  </div>
                  {confirmed && (
                    <span className="visit-ok">
                      <Icon name="check" size={14} /> Potwierdzona
                    </span>
                  )}
                </div>
                <div className="visit-actions">
                  {!confirmed && (
                    <button className="btn btn-secondary btn-sm" disabled={busy === a.id} onClick={() => void confirm(a)}>
                      <Icon name="check" size={16} /> Potwierdzam
                    </button>
                  )}
                  <button className="btn btn-ghost btn-sm visit-cancel" disabled={busy === a.id} onClick={() => setCancelling(a)}>
                    Odwołaj
                  </button>
                  <button className="btn btn-ghost btn-sm visit-ics" aria-label="Dodaj do kalendarza" title="Dodaj do kalendarza (.ics)" onClick={() => void addToCalendar(a, locName(a))}>
                    <Icon name="cal" size={16} /> <span className="visit-ics-txt">Do kalendarza</span>
                  </button>
                </div>
              </li>
            );
          })}
          {cancelled.map((a) => (
            <li key={a.id} className="visit visit-cancelled">
              <div className="visit-when">
                <span className="visit-time">{a.time}</span>
                <div className="grow">
                  <span className="first-cap">{a.date === today ? 'Dziś' : fmtLong(a.date)}</span>
                  <div className="small muted">Odwołana{a.reply?.reason ? `: ${a.reply.reason}` : ''}</div>
                </div>
                {a.reply?.late && <span className="visit-late">Późno</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {cancelling && <CancelSheet a={cancelling} preview={preview} onClose={() => setCancelling(null)} />}
    </section>
  );
}

function CancelSheet({ a, preview, onClose }: { a: Appointment; preview?: boolean; onClose: () => void }) {
  const { respondAppointment, toast } = useStore();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const late = isLateCancel(a);
  const h = Math.max(0, Math.floor(hoursUntil(a)));
  const submit = async () => {
    setBusy(true);
    const ok = await respondAppointment(a.id, 'cancel', reason);
    setBusy(false);
    if (ok) {
      toast(preview ? 'Wizyta odwołana (podgląd).' : 'Wizyta odwołana — trener dostał informację.');
      onClose();
    }
  };
  return (
    <Sheet label="Odwołaj wizytę" onClose={onClose}>
      <div className="between">
        <h3>Odwołać wizytę?</h3>
        <button className="icon-btn" aria-label="Zamknij" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <p>
        <b className="first-cap">{fmtLong(a.date)}</b>, godz. {a.time}
      </p>
      {late ? (
        <div className="visit-warn" role="alert">
          <Icon name="alert" size={18} />
          <p>
            Do wizyty {h < 1 ? 'zostało mniej niż godzinę' : `zostało ok. ${h} h`} — to mniej niż {CANCEL_HOURS} h. Przy późnym odwołaniu trening może przepaść (zostać pobrany z pakietu). Trener zdecyduje.
          </p>
        </div>
      ) : (
        <p className="muted small">Odwołanie co najmniej {CANCEL_HOURS} h przed wizytą — trening nie przepada.</p>
      )}
      <label className="field">
        <span className="small">Powód (trener go zobaczy)</span>
        <textarea className="input" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Np. choroba, wyjazd służbowy…" />
      </label>
      <div className="sheet-actions">
        <button className="btn btn-ghost" onClick={onClose}>
          Nie odwołuj
        </button>
        <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Zapisuję…' : 'Odwołaj wizytę'}
        </button>
      </div>
    </Sheet>
  );
}

/**
 * Zakładka „Trener”: zwijany blok najbliższych wizyt, pod nim rozmowa na całą wysokość
 * (pole wpisywania przyklejone na dole nad dolnym paskiem, przewinięta do najnowszej wiadomości).
 * `mode="preview"` — trener w trybie zawodnika: pisze jako trener.
 */
export function TrainerTab({ client, mode }: { client: Client; mode: 'client' | 'preview' }) {
  const preview = mode === 'preview';
  return (
    <div className="trainer-tab">
      <Visits client={client} preview={preview} />
      <section className="trainer-chat" aria-label={preview ? `Rozmowa: ${client.name}` : 'Rozmowa z trenerem'}>
        <h2 className="trainer-chat-title">{preview ? `Rozmowa: ${client.name}` : 'Rozmowa z trenerem'}</h2>
        <Chat client={client} side="client" asTrainer={preview} full />
      </section>
    </div>
  );
}
