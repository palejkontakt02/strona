import { useState } from 'react';
import type { CoachActions } from '../data/useCoach';
import type { Client, Goal, SessionType } from '../types';
import { GOALS, SESSION_TYPES } from '../types';
import { todayISO } from '../utils';
import { Field, Modal } from './ui';

export type ModalState =
  | { type: 'measurement'; clientId: string }
  | { type: 'exercise'; clientId: string; dayId: string }
  | { type: 'session'; clientId?: string }
  | { type: 'payment'; clientId?: string }
  | { type: 'client' };

interface Props {
  modal: ModalState;
  clients: Client[];
  actions: CoachActions;
  onClose: () => void;
  onClientCreated: (id: string) => void;
}

const num = (v: string): number | undefined => {
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};

function ClientPicker({ clients, value, onChange }: { clients: Client[]; value: string; onChange: (v: string) => void }) {
  const sorted = [...clients].sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  return (
    <Field label="Podopieczny">
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="" disabled>
          Wybierz…
        </option>
        {sorted.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function ModalHost(props: Props) {
  switch (props.modal.type) {
    case 'measurement':
      return <MeasurementModal {...props} clientId={props.modal.clientId} />;
    case 'exercise':
      return <ExerciseModal {...props} clientId={props.modal.clientId} dayId={props.modal.dayId} />;
    case 'session':
      return <SessionModal {...props} fixedClientId={props.modal.clientId} />;
    case 'payment':
      return <PaymentModal {...props} fixedClientId={props.modal.clientId} />;
    case 'client':
      return <ClientModal {...props} />;
  }
}

function MeasurementModal({ clientId, actions, onClose }: Props & { clientId: string }) {
  const [f, setF] = useState({ date: todayISO(), weight: '', chest: '', waist: '', hips: '', note: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal
      title="Nowy pomiar"
      onClose={onClose}
      onSubmit={async () => {
        const weight = num(f.weight);
        if (weight === undefined) return;
        await actions.addMeasurement(clientId, {
          date: f.date,
          weight,
          chest: num(f.chest),
          waist: num(f.waist),
          hips: num(f.hips),
          note: f.note.trim() || undefined,
        });
        onClose();
      }}
    >
      <Field label="Data">
        <input className="input" type="date" value={f.date} onChange={set('date')} required />
      </Field>
      <Field label="Waga (kg)">
        <input className="input" inputMode="decimal" value={f.weight} onChange={set('weight')} required autoFocus />
      </Field>
      <div className="field-row">
        <Field label="Klatka (cm)">
          <input className="input" inputMode="decimal" value={f.chest} onChange={set('chest')} />
        </Field>
        <Field label="Talia (cm)">
          <input className="input" inputMode="decimal" value={f.waist} onChange={set('waist')} />
        </Field>
        <Field label="Biodra (cm)">
          <input className="input" inputMode="decimal" value={f.hips} onChange={set('hips')} />
        </Field>
      </div>
      <Field label="Notatka">
        <input className="input" value={f.note} onChange={set('note')} />
      </Field>
    </Modal>
  );
}

function ExerciseModal({ clientId, dayId, actions, onClose }: Props & { clientId: string; dayId: string }) {
  const [name, setName] = useState('');
  const [sets, setSets] = useState('4');
  const [reps, setReps] = useState('10');
  return (
    <Modal
      title="Nowe ćwiczenie"
      onClose={onClose}
      onSubmit={async () => {
        if (!name.trim()) return;
        await actions.addExercise(clientId, dayId, { name: name.trim(), sets, reps });
        onClose();
      }}
    >
      <Field label="Nazwa">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </Field>
      <div className="field-row">
        <Field label="Serie">
          <input className="input" value={sets} onChange={(e) => setSets(e.target.value)} required />
        </Field>
        <Field label="Powtórzenia">
          <input className="input" value={reps} onChange={(e) => setReps(e.target.value)} required />
        </Field>
      </div>
    </Modal>
  );
}

function SessionModal({ clients, fixedClientId, actions, onClose }: Props & { fixedClientId?: string }) {
  const [clientId, setClientId] = useState(fixedClientId ?? '');
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState('10:00');
  const [type, setType] = useState<SessionType>('Trening siłowy');
  return (
    <Modal
      title="Nowa sesja"
      onClose={onClose}
      onSubmit={async () => {
        if (!clientId) return;
        await actions.addSession(clientId, { date, time, type });
        onClose();
      }}
    >
      {!fixedClientId && <ClientPicker clients={clients} value={clientId} onChange={setClientId} />}
      <div className="field-row">
        <Field label="Data">
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Godzina">
          <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        </Field>
      </div>
      <Field label="Typ">
        <select className="input" value={type} onChange={(e) => setType(e.target.value as SessionType)}>
          {SESSION_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </Field>
    </Modal>
  );
}

function PaymentModal({ clients, fixedClientId, actions, onClose }: Props & { fixedClientId?: string }) {
  const [clientId, setClientId] = useState(fixedClientId ?? '');
  const [amount, setAmount] = useState('400');
  const [description, setDescription] = useState('Karnet miesięczny');
  const [date, setDate] = useState(todayISO());
  return (
    <Modal
      title="Nowa płatność"
      onClose={onClose}
      onSubmit={async () => {
        const value = num(amount);
        if (!clientId || value === undefined) return;
        await actions.addPayment(clientId, { amount: value, description: description.trim(), date });
        onClose();
      }}
    >
      {!fixedClientId && <ClientPicker clients={clients} value={clientId} onChange={setClientId} />}
      <Field label="Kwota (PLN)">
        <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
      </Field>
      <Field label="Opis">
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} required />
      </Field>
      <Field label="Data">
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </Field>
    </Modal>
  );
}

function ClientModal({ actions, onClose, onClientCreated }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [goal, setGoal] = useState<Goal>(GOALS[0]);
  return (
    <Modal
      title="Nowy podopieczny"
      onClose={onClose}
      onSubmit={async () => {
        if (!name.trim()) return;
        const client = await actions.addClient({ name: name.trim(), email: email.trim(), goal });
        onClientCreated(client.id);
        onClose();
      }}
    >
      <Field label="Imię i nazwisko">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </Field>
      <Field label="Email">
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Cel">
        <select className="input" value={goal} onChange={(e) => setGoal(e.target.value as Goal)}>
          {GOALS.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
      </Field>
    </Modal>
  );
}
