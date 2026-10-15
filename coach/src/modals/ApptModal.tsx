import { useState } from 'react';
import { Field, Modal } from '../components/ui';
import type { Appointment, AppointmentStatus } from '../domain';
import { put } from '../data/db';
import { clientById, deleteAppointment, saveAppointment, updateSeries } from '../data/ops';
import { useStore } from '../data/store';
import { fmtShort, uid } from '../format';
import { clashes, weeklyDates } from '../lib/calendar';
import { todayISO } from '../lib/dates';
import { num, numIn } from '../lib/parse';
import { useNav, type ModalState } from '../nav';
import { APPT_STATUS } from '../views/CalendarView';
import { ClientSelect } from './ModalHost';
import { LocationSelect } from '../components/location';

export function ApptModal({ m }: { m: Extract<ModalState, { kind: 'appt' }> }) {
  const { db, apply, ask, toast } = useStore();
  const { closeModal, openModal, startLive } = useNav();
  const editing = m.appt;
  const [clientId, setClientId] = useState(editing?.clientId ?? m.clientId ?? '');
  const [date, setDate] = useState(editing?.date ?? m.date ?? todayISO());
  const [time, setTime] = useState(editing?.time ?? m.time ?? '17:00');
  const [duration, setDuration] = useState(String(editing?.duration ?? 60));
  const [locationId, setLocationId] = useState(editing?.locationId ?? clientById(db, editing?.clientId ?? m.clientId)?.locationId ?? db.locations[0]?.id ?? '');
  const [location, setLocation] = useState(editing?.location ?? '');
  const [note, setNote] = useState(editing?.note ?? '');
  const [status, setStatus] = useState<AppointmentStatus>(editing?.status ?? 'planned');
  const [repeat, setRepeat] = useState(false);
  const [weeks, setWeeks] = useState('8');

  const draft: Appointment = {
    ...(editing ?? {}),
    id: editing?.id ?? uid(),
    clientId,
    date,
    time,
    duration: numIn(duration, 5, 600) ?? 60,
    locationId: locationId || undefined,
    location: location.trim() || db.locations.find((l) => l.id === locationId)?.name || undefined,
    note: note.trim() || undefined,
    status,
  };
  // Kolizje sprawdzamy dla każdego terminu serii (wizyty cykliczne), nie tylko pierwszego.
  const repeatN = repeat && !editing ? Math.min(24, Math.max(4, num(weeks) ?? 8)) : 1;
  const clash = weeklyDates(draft.date, repeatN).flatMap((d) => clashes({ ...draft, date: d }, db.appointments));

  const save = async () => {
    if (!clientId) return;
    if (duration.trim() && numIn(duration, 5, 600) == null) return toast('Czas wizyty: od 5 do 600 minut.');
    const n = repeat && !editing ? Math.min(24, Math.max(4, num(weeks) ?? 8)) : 1;
    const seriesChanged = !!editing?.seriesId && (editing.time !== draft.time || (editing.duration ?? 60) !== draft.duration || editing.locationId !== draft.locationId);
    const allNext = seriesChanged && (await ask('To wizyta cykliczna. Zmienić godzinę / czas / miejsce także w kolejnych zaplanowanych wizytach z tej serii?', { confirm: 'Ta i następne', danger: false }));
    await apply(allNext ? updateSeries(db, draft) : saveAppointment(draft, n), n > 1 ? `Dodano ${n} wizyt (co tydzień).` : allNext ? 'Zmieniono tę i kolejne wizyty z serii.' : editing ? 'Wizyta zapisana.' : 'Wizyta dodana.');
    // „Odbyta” bez zapisanego treningu nie zejdzie z pakietu ani nie doliczy się klubowi
    if (draft.status === 'done' && !draft.sessionId && editing?.status !== 'done') {
      if (await ask('Wizyta odbyta, ale bez zapisanego treningu — nie zejdzie z pakietu ani nie doliczy się klubowi. Zapisać trening teraz?', { confirm: 'Zapisz trening', danger: false })) {
        openModal({ kind: 'session', appt: draft, clientId: draft.clientId, date: draft.date });
        return;
      }
    }
    closeModal();
  };

  const remove = async () => {
    if (!editing) return;
    let whole = false;
    if (editing.seriesId) {
      whole = await ask('To wizyta cykliczna. Usunąć też kolejne zaplanowane wizyty z tej serii?', { confirm: 'Usuń całą serię' });
      if (!whole && !(await ask('Usunąć tylko tę wizytę?'))) return;
    } else if (!(await ask('Usunąć tę wizytę?'))) return;
    await apply(deleteAppointment(db, editing, whole), 'Wizyta usunięta.');
    closeModal();
  };

  const linkedSession = editing?.sessionId ? db.sessions.find((s) => s.id === editing.sessionId) : undefined;

  return (
    <Modal
      title={editing ? 'Wizyta' : 'Nowa wizyta'}
      onClose={closeModal}
      onSubmit={save}
      submitLabel="Zapisz wizytę"
      extraActions={
        editing && (
          <>
            <button type="button" className="btn btn-ghost btn-danger-text" onClick={remove}>
              Usuń
            </button>
            {linkedSession ? (
              <button type="button" className="btn btn-secondary" onClick={() => openModal({ kind: 'session', session: linkedSession })}>
                Pokaż trening
              </button>
            ) : (
              status !== 'cancel' && (
                <>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={async () => {
                    await apply([put('appointments', draft)]);
                    startLive(clientId, draft.id);
                  }}
                >
                  Prowadź trening
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={async () => {
                    await apply([put('appointments', draft)]);
                    openModal({ kind: 'session', appt: draft, clientId, date });
                  }}
                >
                  Zapisz trening
                </button>
                </>
              )
            )}
          </>
        )
      }
    >
      <div className="form-grid">
        <Field label="Podopieczny" wide>
          <ClientSelect
            value={clientId}
            onChange={(id) => {
              setClientId(id);
              const loc = clientById(db, id)?.locationId;
              if (loc && !editing) setLocationId(loc);
            }}
          />
        </Field>
        <Field label="Data">
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Godzina">
          <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        </Field>
        <Field label="Czas (min)">
          <input className="input" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} />
        </Field>
        <Field label="Miejsce">
          <LocationSelect value={locationId} onChange={(v) => { setLocationId(v); setLocation(''); }} />
        </Field>
        {editing && (
          <Field label="Status" wide>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as AppointmentStatus)}>
              {(Object.keys(APPT_STATUS) as AppointmentStatus[]).map((s) => (
                <option key={s} value={s}>
                  {APPT_STATUS[s].label}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Notatka" wide>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {editing?.seriesId && <p className="muted small field-wide">↻ Wizyta cykliczna (co tydzień). Zmianę godziny, czasu lub miejsca możesz zastosować do kolejnych wizyt z serii.</p>}
        {!editing && (
          <div className="field-wide check-row">
            <label className="check">
              <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} /> Powtarzaj co tydzień
            </label>
            {repeat && (
              <label className="check">
                przez
                <input className="input input-xs" inputMode="numeric" value={weeks} onChange={(e) => setWeeks(e.target.value)} /> tyg. (4–24)
              </label>
            )}
          </div>
        )}
      </div>
      {clash.length > 0 && (
        <p className="warn-box">
          Kolizja{repeatN > 1 ? ` (${clash.length} w serii)` : ''}: {clash.map((c) => `${repeatN > 1 ? fmtShort(c.date) + ' ' : ''}${clientById(db, c.clientId)?.name ?? '—'} ${c.time}`).join(', ')}
        </p>
      )}
    </Modal>
  );
}
