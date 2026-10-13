import { useStore } from '../data/store';
import { TEST_CATALOGUE } from '../lib/tests';
import type { ModalState } from '../nav';
import { ApptModal } from './ApptModal';
import { ClientModal, DataModal, ExerciseModal, InjuryModal, MeasurementModal, PaymentModal, TestModal } from './SimpleModals';
import { PlanEditor } from './PlanEditor';
import { LocationModal, LocationsModal } from './LocationModals';
import { SessionModal } from './SessionModal';

export function ModalHost({ modal }: { modal: ModalState }) {
  const { db } = useStore();
  const testNames = [...new Set([...TEST_CATALOGUE, ...db.clients.flatMap((c) => c.tests.map((t) => t.name))])];
  return (
    <>
      <datalist id="lib-exercises">
        {db.library.map((e) => (
          <option key={e.id} value={e.name} />
        ))}
      </datalist>
      <datalist id="test-names">
        {testNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      {modal.kind === 'appt' && <ApptModal m={modal} />}
      {modal.kind === 'session' && <SessionModal m={modal} />}
      {modal.kind === 'plan' && <PlanEditor m={modal} />}
      {modal.kind === 'client' && <ClientModal m={modal} />}
      {modal.kind === 'measurement' && <MeasurementModal m={modal} />}
      {modal.kind === 'test' && <TestModal m={modal} />}
      {modal.kind === 'payment' && <PaymentModal m={modal} />}
      {modal.kind === 'injury' && <InjuryModal m={modal} />}
      {modal.kind === 'exercise' && <ExerciseModal m={modal} />}
      {modal.kind === 'data' && <DataModal />}
      {modal.kind === 'locations' && <LocationsModal />}
      {modal.kind === 'location' && <LocationModal m={modal} />}
    </>
  );
}

/** Lista klientów do wyboru (aktywni pierwsi). */
export function ClientSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { db } = useStore();
  const sorted = [...db.clients].sort((a, b) => Number(b.status === 'aktywny') - Number(a.status === 'aktywny') || a.name.localeCompare(b.name, 'pl'));
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} required>
      <option value="" disabled>
        Wybierz podopiecznego…
      </option>
      {sorted.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
          {c.status !== 'aktywny' ? ` (${c.status})` : ''}
        </option>
      ))}
    </select>
  );
}
