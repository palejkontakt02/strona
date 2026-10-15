import { useState } from 'react';
import { Field, IconBtn, Modal, Tag } from '../components/ui';
import { locStyle } from '../components/location';
import type { Location } from '../domain';
import { put, del } from '../data/db';
import { useStore } from '../data/store';
import { pln, uid } from '../format';
import { clubMonths, clubOutstanding } from '../lib/club';
import { num } from '../lib/parse';
import { useNav, type ModalState } from '../nav';

const HUES = [165, 200, 230, 265, 300, 340, 10, 28, 45, 95];

export function LocationsModal() {
  const { db } = useStore();
  const { closeModal, openModal } = useNav();
  return (
    <Modal title="Miejsca i kluby" onClose={closeModal}>
      <p className="muted small">
        Miejsce oznacza wizyty w kalendarzu i treningi. Przy klubie fitness możesz ustawić stawkę, którą klub wypłaca Ci za trening klienta rozliczanego
        „przez klub”.
      </p>
      <ul className="rows">
        {db.locations.map((l) => {
          const clients = db.clients.filter((c) => c.locationId === l.id).length;
          return (
            <li key={l.id} className="row">
              <span className="loc-dot" style={locStyle(l)} />
              <div className="grow">
                <strong>{l.name}</strong>
                <div className="muted small">
                  {l.kind === 'klub' ? `klub · wypłaca ${pln(l.clubRate)} za trening` : 'własne'} · {clients} {clients === 1 ? 'klient' : 'klientów'}
                </div>
              </div>
              {l.kind === 'klub' && <Tag tone="accent">klub</Tag>}
              <IconBtn icon="edit" label={`Edytuj ${l.name}`} onClick={() => openModal({ kind: 'location', location: l })} />
            </li>
          );
        })}
      </ul>
      <button type="button" className="btn btn-primary" onClick={() => openModal({ kind: 'location' })}>
        + Dodaj miejsce
      </button>
    </Modal>
  );
}

export function LocationModal({ m }: { m: Extract<ModalState, { kind: 'location' }> }) {
  const { db, apply, ask, toast } = useStore();
  const { openModal } = useNav();
  const l = m.location;
  const [name, setName] = useState(l?.name ?? '');
  const [kind, setKind] = useState<Location['kind']>(l?.kind ?? 'własne');
  const [hue, setHue] = useState(l?.hue ?? HUES[db.locations.length % HUES.length]);
  const [address, setAddress] = useState(l?.address ?? '');
  const [rate, setRate] = useState(l?.clubRate != null ? String(l.clubRate) : '');
  const back = () => openModal({ kind: 'locations' });

  return (
    <Modal
      title={l ? 'Miejsce' : 'Nowe miejsce'}
      onClose={back}
      extraActions={
        l && (
          <button
            type="button"
            className="btn btn-ghost btn-danger-text"
            onClick={async () => {
              // blokuje tylko należność za zakończone miesiące; bieżący miesiąc — ostrzeżenie
              const due = clubOutstanding(l, db.sessions).amount;
              if (l.kind === 'klub' && due > 0)
                return toast(`„${l.name}” ma jeszcze ${pln(due)} niewypłaconych należności. Najpierw oznacz wypłaty (Płatności → Od klubów), potem usuń klub.`);
              const curDue = clubMonths(l, db.sessions).find((m) => m.current)?.due ?? 0;
              const billed = db.clients.filter((c) => c.billing === 'klub' && c.locationId === l.id).length;
              const used = db.appointments.some((a) => a.locationId === l.id) || db.sessions.some((s) => s.locationId === l.id) || billed > 0;
              if (!(await ask(`${used ? `Usunąć „${l.name}”? Wizyty i treningi zostaną, ale stracą oznaczenie miejsca${billed ? `, a ${billed} ${billed === 1 ? 'klient rozliczany' : 'klientów rozliczanych'} przez ten klub trzeba będzie przepiąć` : ''}.` : `Usunąć „${l.name}”?`}${curDue > 0 ? ` W tym miesiącu klub ma do wypłaty ${pln(curDue)} — ta kwota przestanie być widoczna.` : ''}`))) return;
              await apply([del('locations', l.id)], 'Miejsce usunięte.');
              back();
            }}
          >
            Usuń
          </button>
        )
      }
      onSubmit={async () => {
        if (!name.trim()) return;
        const loc: Location = {
          id: l?.id ?? uid(),
          name: name.trim(),
          kind,
          hue,
          address: address.trim() || undefined,
          clubRate: kind === 'klub' ? num(rate) ?? undefined : undefined,
          payouts: l?.payouts ?? [],
        };
        await apply([put('locations', loc)], 'Zapisano miejsce.');
        back();
      }}
    >
      <div className="form-grid">
        <Field label="Nazwa" wide>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="np. Klub Fitness Energy" required autoFocus />
        </Field>
        <Field label="Rodzaj" wide>
          <div className="seg">
            <button type="button" className={kind === 'własne' ? 'active' : ''} onClick={() => setKind('własne')}>
              Własne / wynajęte
            </button>
            <button type="button" className={kind === 'klub' ? 'active' : ''} onClick={() => setKind('klub')}>
              Klub fitness
            </button>
          </div>
        </Field>
        {kind === 'klub' && (
          <Field label="Klub wypłaca mi za trening (zł)" wide hint="Dotyczy klientów rozliczanych „przez klub”. Rozliczenia miesięczne znajdziesz w Płatności → Od klubów.">
            <input className="input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="np. 90" />
          </Field>
        )}
        <Field label="Adres / sala" wide>
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <div className="field field-wide">
          <span>Kolor oznaczenia</span>
          <div className="hues" role="radiogroup" aria-label="Kolor oznaczenia">
            {HUES.map((h) => (
              <button key={h} type="button" role="radio" aria-checked={hue === h} aria-label={`Kolor ${h}`} className={`hue ${hue === h ? 'active' : ''}`} style={{ '--lhue': h } as React.CSSProperties} onClick={() => setHue(h)} />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
