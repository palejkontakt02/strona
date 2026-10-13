import type { Billing, Location } from '../domain';
import { useStore } from '../data/store';

export const CHARGE_OPTIONS: [Billing, string][] = [
  ['pakiet', 'z pakietu'],
  ['abonament', 'abonament'],
  ['pojedyncza', 'sesja pojedyncza'],
  ['klub', 'przez klub (klub mi wypłaca)'],
  ['brak', 'bez rozliczenia'],
];

export const BILLING_LABEL: Record<Billing, string> = {
  pakiet: 'Pakiet',
  abonament: 'Abonament',
  pojedyncza: 'Sesje pojedyncze',
  klub: 'Przez klub',
  brak: 'Bez rozliczeń',
};

export const CHARGE_SHORT: Record<Billing, string> = {
  pakiet: 'pakiet',
  abonament: 'abonament',
  pojedyncza: 'pojedyncza',
  klub: 'klub',
  brak: '—',
};

export function ChargeSelect({ value, onChange, id }: { value: Billing; onChange: (b: Billing) => void; id?: string }) {
  return (
    <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value as Billing)}>
      {CHARGE_OPTIONS.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

export const locStyle = (l?: Location) => (l ? ({ '--lhue': l.hue } as React.CSSProperties) : undefined);

/** Oznaczenie miejsca: kolorowa kropka + nazwa. */
export function LocationTag({ id, short }: { id?: string; short?: boolean }) {
  const { db } = useStore();
  const l = db.locations.find((x) => x.id === id);
  if (!l) return null;
  return (
    <span className="loc-tag" style={locStyle(l)} title={l.name}>
      <i />
      {short ? shortName(l.name) : l.name}
    </span>
  );
}

export function shortName(name: string): string {
  const clean = name.replace(/\(.*?\)/g, '').replace(/^(Klub Fitness|Klub)\s+/i, '').trim();
  return clean.length > 14 ? clean.slice(0, 13) + '…' : clean;
}

export function LocationSelect({ value, onChange, allowEmpty = true, id }: { value: string; onChange: (id: string) => void; allowEmpty?: boolean; id?: string }) {
  const { db } = useStore();
  return (
    <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty && <option value="">— nie wybrano —</option>}
      {db.locations.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
          {l.kind === 'klub' ? ' · klub' : ''}
        </option>
      ))}
    </select>
  );
}
