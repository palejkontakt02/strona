import { useRef, useState } from 'react';
import { Field, Icon, Modal } from '../components/ui';
import type { Appointment, AppointmentStatus } from '../domain';
import { put } from '../data/db';
import { clientById, deleteAppointment, groupOf, saveAppointment, saveGroupAppointments, sessionsOf } from '../data/ops';
import { canMove, moveVisit, seriesEdit, visitsLeftInPackage } from '../lib/calendarMove';
import { packageStatus } from '../lib/billing';
import { useStore } from '../data/store';
import { fmtShort, fmtWeekday, plural, uid } from '../format';
import { clashes, weeklyDates } from '../lib/calendar';
import { addDays, todayISO } from '../lib/dates';
import { suggestSlot } from '../lib/apptSuggest';
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
  // nowa wizyta bez wskazanej godziny: zwyczaj klienta albo pierwsza wolna pełna godzina (7–20) — dopóki trener jej nie zmieni
  const autoSlot = !editing && !m.time;
  const slotTouched = useRef(false);
  const slotFor = (cid: string, d: string) => {
    const now = new Date();
    return suggestSlot(db.appointments, cid, d, d === todayISO() ? now.getHours() * 60 + now.getMinutes() : undefined);
  };
  const [initialSlot] = useState(() => (autoSlot ? slotFor(m.clientId ?? '', m.date ?? todayISO()) : null));
  const [time, setTime] = useState(editing?.time ?? m.time ?? initialSlot?.time ?? '17:00');
  const [duration, setDuration] = useState(String(editing?.duration ?? initialSlot?.duration ?? 60));
  const resuggest = (cid: string, d: string) => {
    if (!autoSlot || slotTouched.current) return;
    const sl = slotFor(cid, d);
    setTime(sl.time);
    setDuration(String(sl.duration));
  };
  const [locationId, setLocationId] = useState(editing?.locationId ?? clientById(db, editing?.clientId ?? m.clientId)?.locationId ?? db.locations[0]?.id ?? '');
  const [location, setLocation] = useState(editing?.location ?? '');
  const [note, setNote] = useState(editing?.note ?? '');
  const [status, setStatus] = useState<AppointmentStatus>(editing?.status ?? 'planned');
  const [repeat, setRepeat] = useState(false);
  const cl = clientById(db, clientId);
  const pk = cl ? packageStatus(cl, sessionsOf(db, cl.id)) : null;
  const [charged, setCharged] = useState(!!editing && !!cl?.noShowCharges?.includes(editing.id));
  const [weeks, setWeeks] = useState('8');
  // trening w parze / małej grupie: pozostałe osoby w tym terminie
  const group = editing ? groupOf(db.appointments, editing).filter((x) => x.id !== editing.id) : [];
  const [partners, setPartners] = useState<string[]>(() => group.map((x) => x.clientId));
  const [addingPartner, setAddingPartner] = useState(false);

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
    groupId: partners.length ? editing?.groupId : undefined,
  };
  // Kolizje sprawdzamy dla każdego terminu serii (wizyty cykliczne), nie tylko pierwszego.
  const repeatN = repeat && !editing ? Math.min(24, Math.max(2, num(weeks) ?? 8)) : 1;
  // „do końca pakietu”: pozostałe treningi minus już zaplanowane wizyty
  const untilPkg = pk && !editing ? Math.min(24, visitsLeftInPackage(db, clientId, pk.left, todayISO())) : 0;
  const dateRef = useRef<HTMLInputElement>(null);
  const clash = weeklyDates(draft.date, repeatN).flatMap((d) => clashes({ ...draft, date: d }, db.appointments)).filter((c) => !partners.includes(c.clientId) || c.date !== draft.date || c.time !== draft.time);

  const save = async () => {
    if (!clientId) return;
    if (duration.trim() && numIn(duration, 5, 600) == null) return toast('Czas wizyty: od 5 do 600 minut.');
    const n = repeatN;
    const seriesChanged = !!editing?.seriesId && (editing.date !== draft.date || editing.time !== draft.time || (editing.duration ?? 60) !== draft.duration || editing.locationId !== draft.locationId);
    const allNext = seriesChanged && (await ask(editing.date !== draft.date ? 'To wizyta cykliczna. Przesunąć także kolejne zaplanowane wizyty z tej serii (o tyle samo dni, z tą godziną, czasem i miejscem)?' : 'To wizyta cykliczna. Zmienić godzinę / czas / miejsce także w kolejnych zaplanowanych wizytach z tej serii?', { confirm: 'Ta i następne', danger: false }));
    // nieobecność / późne odwołanie: opcjonalnie 1 trening z pakietu
    const chargeNow = charged && (draft.status === 'noshow' || draft.status === 'cancel');
    const wasCharged = !!cl?.noShowCharges?.includes(draft.id);
    const chargeChange = cl && chargeNow !== wasCharged ? [put('clients', { ...cl, noShowCharges: chargeNow ? [...(cl.noShowCharges ?? []), draft.id] : (cl.noShowCharges ?? []).filter((x) => x !== draft.id) })] : [];
    if (partners.includes(clientId)) return toast('Ta sama osoba jest wybrana dwa razy.');
    const grouped = partners.length > 0 || !!editing?.groupId;
    const d2: Appointment = { ...draft, groupId: partners.length ? (editing?.groupId ?? uid()) : undefined };
    const main = grouped ? saveGroupAppointments(db, d2, partners, allNext ? 1 : n, editing) : saveAppointment(d2, n);
    const pairMsg = partners.length ? ` W parze z: ${partners.map((id) => clientById(db, id)?.name.split(' ')[0]).join(', ')}.` : '';
    const msg = n > 1 ? `Dodano ${n} ${plural(n, 'wizytę', 'wizyty', 'wizyt')} (co tydzień).` : allNext ? 'Zmieniono tę i kolejne wizyty z serii.' : chargeNow && !wasCharged ? 'Wizyta zapisana — 1 trening pobrany z pakietu.' : editing ? 'Wizyta zapisana.' : 'Wizyta dodana.';
    if (!(await apply([...main, ...(allNext && editing ? seriesEdit(db, editing, d2) : []), ...chargeChange], msg + pairMsg))) return;
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
    const others = group.filter((x) => x.status === 'planned' && !x.sessionId);
    const withPartners = others.length > 0 && (await ask(`To trening w parze. Usunąć też wizytę: ${others.map((x) => clientById(db, x.clientId)?.name ?? '—').join(', ')}?`, { confirm: 'Usuń też', cancel: 'Tylko tę' }));
    await apply(deleteAppointment(db, editing, whole, withPartners), 'Wizyta usunięta.');
    closeModal();
  };

  const linkedSession = editing?.sessionId ? db.sessions.find((s) => s.id === editing.sessionId) : undefined;

  /** Szybkie przesunięcie (telefon): od razu zapis, para razem, seria — pytanie „Ta i następne?”, z „Cofnij”. */
  const quickMove = async (to: string) => {
    if (!editing || to === editing.date) return;
    const later = !!editing.seriesId && db.appointments.some((x) => x.seriesId === editing.seriesId && x.date > editing.date && x.status === 'planned');
    const all = later && (await ask('To wizyta cykliczna. Przesunąć też kolejne zaplanowane wizyty z tej serii o tyle samo dni?', { confirm: 'Ta i następne', cancel: 'Tylko ta', danger: false }));
    const changes = moveVisit(db, editing, to, editing.time, all);
    const ids = changes.map((c) => (c as { item: Appointment }).item.id);
    const before = db.appointments.filter((x) => ids.includes(x.id));
    if (!(await apply(changes))) return;
    closeModal();
    toast(`Przeniesiono na ${fmtWeekday(to)} ${fmtShort(to)}, ${editing.time}${all ? ` (i ${ids.length - 1} kolejne)` : ''}.`, {
      label: 'Cofnij',
      run: () => void apply(before.map((x) => put('appointments', x)), 'Cofnięto przeniesienie.'),
    });
  };
  const tomorrow = addDays(todayISO(), 1);
  const plusOne = editing ? addDays(editing.date, 1) : '';

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
                    // z partnerami — najpierw zapis pary, żeby prowadzenie otworzyło obie osoby
                    if (!(await apply(partners.length || editing.groupId ? saveGroupAppointments(db, draft, partners, 1, editing) : [put('appointments', draft)]))) return;
                    startLive(clientId, draft.id);
                  }}
                >
                  {partners.length ? 'Prowadź w parze' : 'Prowadź trening'}
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
              resuggest(id, date);
              const loc = clientById(db, id)?.locationId;
              if (loc && !editing) setLocationId(loc);
            }}
          />
        </Field>
        <div className="field field-wide">
          <span>Trening w parze / grupie</span>
          <div className="pair-chips">
            {partners.map((id) => {
              const pa = group.find((x) => x.clientId === id);
              return (
                <span key={id} className="pair-chip">
                  <Icon name="users" size={14} /> {clientById(db, id)?.name ?? '—'}
                  {pa && pa.status !== 'planned' && <i className="muted small"> · {APPT_STATUS[pa.status].label.toLowerCase()}</i>}
                  <button type="button" className="icon-btn icon-btn-sm" aria-label={`Usuń ${clientById(db, id)?.name ?? ''} z pary`} onClick={() => setPartners(partners.filter((x) => x !== id))}>
                    ×
                  </button>
                </span>
              );
            })}
            {addingPartner ? (
              <ClientSelect
                value=""
                required={false}
                onChange={(id) => {
                  if (id && id !== clientId && !partners.includes(id)) setPartners([...partners, id]);
                  setAddingPartner(false);
                }}
              />
            ) : (
              partners.length < 3 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddingPartner(true)} disabled={!clientId}>
                  + {partners.length ? 'kolejna osoba' : 'dodaj osobę (w parze)'}
                </button>
              )
            )}
          </div>
          {partners.length > 0 && <span className="muted small">Każda osoba ma swoją wizytę, status, trening i rozliczenie. Godzina, czas i miejsce są wspólne.</span>}
        </div>
        <Field label="Data">
          <input ref={dateRef} className="input" type="date" value={date} onChange={(e) => (setDate(e.target.value), resuggest(clientId, e.target.value))} required />
        </Field>
        <Field label="Godzina">
          <input className="input" type="time" value={time} onChange={(e) => ((slotTouched.current = true), setTime(e.target.value))} required />
        </Field>
        <Field label="Czas (min)">
          <input className="input" inputMode="numeric" value={duration} onChange={(e) => ((slotTouched.current = true), setDuration(e.target.value))} />
        </Field>
        <Field label="Miejsce">
          <LocationSelect value={locationId} onChange={(v) => { setLocationId(v); setLocation(''); }} />
        </Field>
        {editing && canMove(editing) && (
          <div className="field field-wide appt-move">
            <span>Przesuń{group.length ? ' (razem z parą)' : ''}</span>
            <div className="appt-move-btns">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void quickMove(plusOne)}>
                +1 dzień
              </button>
              {tomorrow !== plusOne && tomorrow !== editing.date && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void quickMove(tomorrow)}>
                  Jutro, {editing.time}
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  const el = dateRef.current;
                  el?.focus();
                  try {
                    el?.showPicker?.();
                  } catch {
                    // przeglądarka bez okienka wyboru daty — pole ma fokus
                  }
                }}
              >
                Wybierz…
              </button>
            </div>
          </div>
        )}
        {editing && (
          <Field label={partners.length ? `Status — ${cl?.name.split(' ')[0] ?? ''}` : 'Status'} wide>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as AppointmentStatus)}>
              {(Object.keys(APPT_STATUS) as AppointmentStatus[]).map((s) => (
                <option key={s} value={s}>
                  {APPT_STATUS[s].label}
                </option>
              ))}
            </select>
          </Field>
        )}
        {editing && (status === 'noshow' || status === 'cancel') && pk && (
          <label className="check field-wide">
            <input type="checkbox" checked={charged} onChange={(e) => setCharged(e.target.checked)} /> Pobierz 1 trening z pakietu (nieobecność / późne odwołanie)
          </label>
        )}
        {!editing && repeat && pk && pk.left < repeatN && (
          <p className="small warn-text field-wide">Pakiet: zostało {pk.left} {pk.left === 1 ? 'trening' : 'treningów'}, a dodajesz {repeatN} {plural(repeatN, 'wizytę', 'wizyty', 'wizyt')} — przypomnij o nowym pakiecie.</p>
        )}
        <Field label="Notatka" wide>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {editing?.seriesId && <p className="muted small field-wide">↻ Wizyta cykliczna (co tydzień). Zmianę godziny, czasu lub miejsca możesz zastosować do kolejnych wizyt z serii.</p>}
        {!editing && (
          <div className="field-wide check-row repeat-row">
            <label className="check">
              <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} /> Powtarzaj co tydzień
            </label>
            {/* jedno stuknięcie: liczba tygodni od razu (włącza powtarzanie) */}
            <span className="repeat-chips" role="group" aria-label="Ile tygodni">
              {[
                ['×4', 4],
                ['×8', 8],
                ...(untilPkg >= 2 ? [[`do końca pakietu (${untilPkg})`, untilPkg] as const] : []),
              ].map(([label, n]) => (
                <button
                  key={label}
                  type="button"
                  className={`chip-btn ${repeat && num(weeks) === n ? 'active' : ''}`}
                  aria-pressed={repeat && num(weeks) === n}
                  onClick={() => {
                    setRepeat(true);
                    setWeeks(String(n));
                  }}
                >
                  {label}
                </button>
              ))}
            </span>
            {repeat && (
              <label className="check">
                przez
                <input className="input input-xs" inputMode="numeric" value={weeks} onChange={(e) => setWeeks(e.target.value)} /> tyg. (2–24)
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
