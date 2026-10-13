import { useRef, useState } from 'react';
import { Field, Modal } from '../components/ui';
import { EXERCISE_CATEGORIES, type Client, type ExerciseCategory, type Injury, type Measurement, type Payment, type TestResult } from '../domain';
import { del, normalizeDb, put, type Db } from '../data/db';
import { clientById } from '../data/ops';
import { useStore } from '../data/store';
import { fnum, uid } from '../format';
import { addDays, todayISO } from '../lib/dates';
import { num } from '../lib/parse';
import { computeLsi } from '../lib/tests';
import { useNav, type ModalState } from '../nav';
import { MEASURE_FIELDS } from '../views/client/Measurements';
import { getPalette, PALETTES, setPalette, type PaletteId } from '../theme';
import { ClientFields, fromDraft, toDraft } from '../views/client/Profile';
import { ClientSelect } from './ModalHost';

function useClient(id: string): Client | undefined {
  const { db } = useStore();
  return clientById(db, id);
}

/* ---------- nowy podopieczny ---------- */
export function ClientModal({ m }: { m: Extract<ModalState, { kind: 'client' }> }) {
  const { apply } = useStore();
  const { closeModal, openClient } = useNav();
  const [d, setD] = useState(() => toDraft(m.client ?? { status: 'aktywny' }));
  const set = (k: string, v: string) => setD((x) => ({ ...x, [k]: v }));
  return (
    <Modal
      title={m.client ? 'Edytuj podopiecznego' : 'Nowy podopieczny'}
      onClose={closeModal}
      onSubmit={async () => {
        if (!d.name.trim()) return;
        const base: Client = m.client ?? { id: uid(), name: '', status: 'aktywny', startDate: todayISO(), createdAt: new Date().toISOString(), payments: [], measurements: [], tests: [], injuryLog: [], checkins: [] };
        const c = fromDraft(base, d);
        if (!m.client && !c.startDate) c.startDate = todayISO();
        await apply([put('clients', c)], m.client ? 'Zapisano.' : 'Dodano podopiecznego.');
        closeModal();
        openClient(c.id, m.client ? undefined : 'Profil');
      }}
    >
      <ClientFields d={d} set={set} compact />
      {!m.client && <p className="muted small">Pozostałe dane (data urodzenia, staż, urazy…) uzupełnisz w zakładce Profil.</p>}
    </Modal>
  );
}

/* ---------- pomiar ---------- */
export function MeasurementModal({ m }: { m: Extract<ModalState, { kind: 'measurement' }> }) {
  const { apply, toast } = useStore();
  const { closeModal } = useNav();
  const client = useClient(m.clientId);
  const [date, setDate] = useState(todayISO());
  const [v, setV] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  if (!client) return null;
  return (
    <Modal
      title="Nowy pomiar"
      onClose={closeModal}
      onSubmit={async () => {
        const meas: Measurement = { id: uid(), date, note: note.trim() || undefined };
        let any = false;
        for (const [k] of MEASURE_FIELDS) {
          const n = num(v[k]);
          if (n != null) {
            meas[k] = n;
            any = true;
          }
        }
        if (!any) return toast('Wpisz przynajmniej jeden pomiar.');
        await apply([put('clients', { ...client, measurements: [...client.measurements, meas] })], 'Pomiar dodany.');
        closeModal();
      }}
    >
      <div className="form-grid form-grid-3">
        <Field label="Data">
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        {MEASURE_FIELDS.map(([k, label, unit], i) => (
          <Field key={k} label={`${label} (${unit})`}>
            <input className="input" inputMode="decimal" value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} autoFocus={i === 0} />
          </Field>
        ))}
        <Field label="Notatka" wide>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/* ---------- test ---------- */
const lowerByName = (n: string) => /\(s\)|czas|sprint|timed|tętno/i.test(n);

export function TestModal({ m }: { m: Extract<ModalState, { kind: 'test' }> }) {
  const { apply, toast } = useStore();
  const { closeModal } = useNav();
  const client = useClient(m.clientId);
  const [name, setName] = useState(m.name ?? '');
  const [date, setDate] = useState(todayISO());
  const [value, setValue] = useState('');
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [unit, setUnit] = useState('');
  const [involved, setInvolved] = useState<'' | 'L' | 'P'>('');
  const [lower, setLower] = useState(lowerByName(m.name ?? ''));
  const [note, setNote] = useState('');
  if (!client) return null;
  const L = num(left);
  const P = num(right);
  const lsi = L != null && P != null ? computeLsi(L, P, { involved: involved || undefined, lowerIsBetter: lower }) : null;
  const guessUnit = (n: string) => n.match(/\(([^)]+)\)\s*$/)?.[1] ?? (/^1RM/.test(n) ? 'kg' : '');

  return (
    <Modal
      title="Wynik testu"
      onClose={closeModal}
      onSubmit={async () => {
        if (!name.trim()) return;
        if (num(value) == null && !value.trim() && (L == null || P == null)) return toast('Wpisz wynik albo obie strony.');
        const t: TestResult = { id: uid(), date, name: name.trim(), value: num(value) ?? (value.trim() || undefined), unit: unit.trim() || undefined, note: note.trim() || undefined };
        if (L != null) t.left = L;
        if (P != null) t.right = P;
        if (lsi != null) t.lsi = lsi;
        if (involved) t.involved = involved;
        await apply([put('clients', { ...client, tests: [...client.tests, t] })], 'Wynik dodany.');
        closeModal();
      }}
    >
      <div className="form-grid">
        <Field label="Test" wide>
          <input
            className="input"
            list="test-names"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setLower(lowerByName(e.target.value));
              if (!unit) setUnit(guessUnit(e.target.value));
            }}
            required
            autoFocus={!m.name}
          />
        </Field>
        <Field label="Data">
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Jednostka">
          <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} />
        </Field>
        <Field label="Wynik ogólny" wide>
          <input className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus={!!m.name} />
        </Field>
        <Field label="Lewa">
          <input className="input" inputMode="decimal" value={left} onChange={(e) => setLeft(e.target.value)} />
        </Field>
        <Field label="Prawa">
          <input className="input" inputMode="decimal" value={right} onChange={(e) => setRight(e.target.value)} />
        </Field>
        <Field label="Kończyna operowana / kontuzjowana">
          <select className="input" value={involved} onChange={(e) => setInvolved(e.target.value as '' | 'L' | 'P')}>
            <option value="">— (słabsza / silniejsza)</option>
            <option value="L">lewa</option>
            <option value="P">prawa</option>
          </select>
        </Field>
        <div className="field check-row">
          <label className="check">
            <input type="checkbox" checked={lower} onChange={(e) => setLower(e.target.checked)} /> niższy wynik = lepszy
          </label>
        </div>
        <p className="muted small field-wide">
          Wpisz wynik ogólny albo lewa/prawa — LSI policzy się automatycznie.
          {lsi != null && (
            <strong className={lsi >= 90 ? 'text-ok' : lsi >= 80 ? 'text-warn' : 'text-danger'}> LSI: {fnum(lsi)}%</strong>
          )}
        </p>
        <Field label="Notatka" wide>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/* ---------- płatność ---------- */
const PAY_TITLE = { pakiet: 'Pakiet', abonament: 'Abonament', pojedyncza: 'Sesja pojedyncza' } as const;

export function PaymentModal({ m }: { m: Extract<ModalState, { kind: 'payment' }> }) {
  const { db, apply } = useStore();
  const { closeModal } = useNav();
  const p = m.payment;
  const [clientId, setClientId] = useState(m.clientId ?? '');
  const client = clientById(db, clientId);
  const today = todayISO();
  const defAmount = (c?: Client) => (m.type === 'pakiet' ? c?.pkgPrice : m.type === 'abonament' ? c?.subRate : c?.singleRate);
  const [amount, setAmount] = useState(p ? String(p.amount) : String(defAmount(client) ?? ''));
  const [sessions, setSessions] = useState(String(p?.sessions ?? client?.pkgSize ?? 10));
  const [month, setMonth] = useState(p?.month ?? today.slice(0, 7));
  const [desc, setDesc] = useState(p?.desc ?? '');
  const [date, setDate] = useState(p?.date ?? today);
  const [dueDate, setDueDate] = useState(p?.dueDate ?? addDays(today, 7));
  const [paid, setPaid] = useState(p ? p.status === 'paid' : m.type !== 'abonament');

  return (
    <Modal
      title={`${p ? 'Edytuj' : 'Nowa płatność'} – ${PAY_TITLE[m.type]}`}
      onClose={closeModal}
      onSubmit={async () => {
        if (!client) return;
        const pay: Payment = {
          id: p?.id ?? uid(),
          type: m.type,
          amount: num(amount) ?? 0,
          date,
          dueDate: dueDate || undefined,
          desc: desc.trim() || undefined,
          status: paid ? 'paid' : 'due',
          paidDate: paid ? (p?.paidDate ?? today) : undefined,
        };
        if (m.type === 'pakiet') pay.sessions = parseInt(sessions, 10) || 0;
        if (m.type === 'abonament') pay.month = month;
        const payments = p ? client.payments.map((x) => (x.id === p.id ? pay : x)) : [...client.payments, pay];
        await apply([put('clients', { ...client, payments })], p ? 'Płatność zapisana.' : 'Płatność dodana.');
        closeModal();
      }}
    >
      <div className="form-grid">
        {!m.clientId && (
          <Field label="Podopieczny" wide>
            <ClientSelect
              value={clientId}
              onChange={(id) => {
                setClientId(id);
                const c = clientById(db, id);
                if (defAmount(c) != null) setAmount(String(defAmount(c)));
                if (c?.pkgSize) setSessions(String(c.pkgSize));
              }}
            />
          </Field>
        )}
        {m.type === 'pakiet' && (
          <Field label="Liczba sesji">
            <input className="input" inputMode="numeric" value={sessions} onChange={(e) => setSessions(e.target.value)} required />
          </Field>
        )}
        {m.type === 'abonament' && (
          <Field label="Miesiąc">
            <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
          </Field>
        )}
        <Field label="Kwota (zł)">
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </Field>
        {m.type === 'pojedyncza' && (
          <Field label="Opis">
            <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Sesja pojedyncza" />
          </Field>
        )}
        <Field label="Data">
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Termin płatności">
          <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <div className="field-wide check-row">
          <label className="check">
            <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} /> Opłacone
          </label>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- uraz ---------- */
export function InjuryModal({ m }: { m: Extract<ModalState, { kind: 'injury' }> }) {
  const { apply, ask } = useStore();
  const { closeModal } = useNav();
  const client = useClient(m.clientId);
  const i = m.injury;
  const [f, setF] = useState({ name: i?.name ?? '', date: i?.date ?? todayISO(), side: i?.side ?? '', status: i?.status ?? 'aktywny', returnDate: i?.returnDate ?? '', note: i?.note ?? '' });
  if (!client) return null;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal
      title={i ? 'Uraz' : 'Nowy uraz'}
      onClose={closeModal}
      extraActions={
        i && (
          <button
            type="button"
            className="btn btn-ghost btn-danger-text"
            onClick={async () => {
              if (!(await ask('Usunąć ten uraz z historii?'))) return;
              await apply([put('clients', { ...client, injuryLog: client.injuryLog.filter((x) => x.id !== i.id) })], 'Uraz usunięty.');
              closeModal();
            }}
          >
            Usuń
          </button>
        )
      }
      onSubmit={async () => {
        if (!f.name.trim()) return;
        const inj: Injury = { id: i?.id ?? uid(), name: f.name.trim(), date: f.date, side: f.side || undefined, status: f.status as Injury['status'], returnDate: f.returnDate || undefined, note: f.note.trim() || undefined };
        const injuryLog = i ? client.injuryLog.map((x) => (x.id === i.id ? inj : x)) : [...client.injuryLog, inj];
        await apply([put('clients', { ...client, injuryLog })], 'Zapisano uraz.');
        closeModal();
      }}
    >
      <div className="form-grid">
        <Field label="Uraz" wide>
          <input className="input" value={f.name} onChange={set('name')} required autoFocus />
        </Field>
        <Field label="Data">
          <input className="input" type="date" value={f.date} onChange={set('date')} required />
        </Field>
        <Field label="Strona">
          <select className="input" value={f.side} onChange={set('side')}>
            <option value="">—</option>
            <option value="lewa">lewa</option>
            <option value="prawa">prawa</option>
            <option value="obie">obie</option>
          </select>
        </Field>
        <Field label="Status">
          <select className="input" value={f.status} onChange={set('status')}>
            <option value="aktywny">aktywny</option>
            <option value="w rehabilitacji">w rehabilitacji</option>
            <option value="wyleczony">wyleczony</option>
          </select>
        </Field>
        <Field label="Planowany powrót">
          <input className="input" type="date" value={f.returnDate} onChange={set('returnDate')} />
        </Field>
        <Field label="Notatka" wide>
          <input className="input" value={f.note} onChange={set('note')} />
        </Field>
      </div>
    </Modal>
  );
}

/* ---------- ćwiczenie w bibliotece ---------- */
export function ExerciseModal({ m }: { m: Extract<ModalState, { kind: 'exercise' }> }) {
  const { apply, ask } = useStore();
  const { closeModal } = useNav();
  const e = m.exercise;
  const [name, setName] = useState(e?.name ?? '');
  const [cat, setCat] = useState<ExerciseCategory>(e?.cat ?? 'Dół ciała');
  const [video, setVideo] = useState(e?.video ?? '');
  return (
    <Modal
      title={e ? 'Ćwiczenie' : 'Nowe ćwiczenie'}
      onClose={closeModal}
      extraActions={
        e && (
          <button
            type="button"
            className="btn btn-ghost btn-danger-text"
            onClick={async () => {
              if (!(await ask(`Usunąć „${e.name}” z biblioteki? Plany i treningi zostaną bez zmian.`))) return;
              await apply([del('library', e.id)], 'Usunięto z biblioteki.');
              closeModal();
            }}
          >
            Usuń
          </button>
        )
      }
      onSubmit={async () => {
        if (!name.trim()) return;
        await apply([put('library', { id: e?.id ?? uid(), name: name.trim(), cat, video: video.trim() || undefined })], 'Zapisano ćwiczenie.');
        closeModal();
      }}
    >
      <div className="form-grid">
        <Field label="Nazwa" wide>
          <input className="input" value={name} onChange={(ev) => setName(ev.target.value)} required autoFocus />
        </Field>
        <Field label="Kategoria" wide>
          <select className="input" value={cat} onChange={(ev) => setCat(ev.target.value as ExerciseCategory)}>
            {EXERCISE_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Link do wideo" wide>
          <input className="input" type="url" value={video} onChange={(ev) => setVideo(ev.target.value)} placeholder="https://…" />
        </Field>
      </div>
    </Modal>
  );
}

/* ---------- dane: eksport, import, reset ---------- */
export function DataModal() {
  const { db, reset, importDb, ask, toast } = useStore();
  const { closeModal, go, openModal } = useNav();
  const file = useRef<HTMLInputElement>(null);
  const [palette, setPal] = useState<PaletteId>(getPalette());

  const exportAll = () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `panel-trenera-kopia-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onImport = async (f: File) => {
    try {
      const data = JSON.parse(await f.text()) as Db;
      if (!Array.isArray(data.clients) || !Array.isArray(data.sessions)) throw new Error('format');
      if (!(await ask('Zastąpić obecne dane danymi z pliku?', { confirm: 'Importuj' }))) return;
      await importDb(normalizeDb(data));
      closeModal();
      go('Pulpit');
    } catch {
      toast('Nie udało się wczytać pliku — to nie jest kopia z tej aplikacji.');
    }
  };

  return (
    <Modal title="Ustawienia" onClose={closeModal}>
      <h4>Kolory</h4>
      <div className="palettes" role="radiogroup" aria-label="Motyw kolorystyczny">
        {PALETTES.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={palette === p.id}
            className={`palette ${palette === p.id ? 'active' : ''}`}
            onClick={() => {
              setPalette(p.id);
              setPal(p.id);
            }}
          >
            <span className="swatch" style={{ background: p.bg }}>
              <i style={{ background: p.accent }} />
            </span>
            {p.name}
          </button>
        ))}
      </div>
      <h4 className="form-section">Miejsca treningów</h4>
      <p className="muted small">{db.locations.map((l) => l.name).join(' · ') || 'Brak zapisanych miejsc.'}</p>
      <button type="button" className="btn btn-secondary" onClick={() => openModal({ kind: 'locations' })}>
        Miejsca i kluby…
      </button>
      <h4 className="form-section">Dane</h4>
      <p className="small">
        Dane są teraz zapisywane <strong>tylko w tej przeglądarce</strong> na tym urządzeniu. Rób kopię zapasową, zanim wyczyścisz dane przeglądarki.
        Po podłączeniu bazy w chmurze (Supabase) dane będą wspólne dla wszystkich urządzeń i dostępne dla klientów po zalogowaniu.
      </p>
      <p className="muted small">
        {db.clients.length} podopiecznych · {db.sessions.length} treningów · {db.appointments.length} wizyt · {db.plans.length} planów
      </p>
      <div className="stack-sm">
        <button type="button" className="btn btn-secondary" onClick={exportAll}>
          Pobierz kopię zapasową (JSON)
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => file.current?.click()}>
          Wczytaj kopię z pliku…
        </button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
        <button
          type="button"
          className="btn btn-ghost"
          onClick={async () => {
            if (await ask('Zastąpić obecne dane danymi przykładowymi?', { confirm: 'Wczytaj przykładowe' })) {
              await reset('seed');
              closeModal();
              go('Pulpit');
            }
          }}
        >
          Wczytaj dane przykładowe
        </button>
        <button
          type="button"
          className="btn btn-danger"
          onClick={async () => {
            if (await ask('Usunąć wszystkich podopiecznych, plany, treningi i wizyty? Biblioteka ćwiczeń zostanie. Zrób wcześniej kopię zapasową.', { confirm: 'Wyczyść wszystko' })) {
              await reset('empty');
              closeModal();
              go('Pulpit');
            }
          }}
        >
          Wyczyść dane i zacznij od zera
        </button>
      </div>
    </Modal>
  );
}
