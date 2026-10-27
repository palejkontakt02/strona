import { useState } from 'react';
import { Card } from '../../components/ui';
import type { Client } from '../../domain';
import { put } from '../../data/db';
import { useStore } from '../../data/store';
import { numIn } from '../../lib/parse';
import { comebackRule } from '../../lib/comeback';

/**
 * Ustawienie trenera „Powrót po przerwie” (karta klienta → Profil): od ilu dni bez treningu
 * i o ile % lżejsze podpowiedzi ciężaru w pierwszym treningu (domyślnie 14 dni, −15%). Zapis: client.comeback.
 */
export function ComebackSettings({ client }: { client: Client }) {
  const { apply, toast } = useStore();
  const cur = comebackRule(client.comeback);
  const [on, setOn] = useState(!cur.off);
  const [days, setDays] = useState(String(cur.days));
  const [pct, setPct] = useState(String(cur.pct));
  const dirty = on !== !cur.off || days !== String(cur.days) || pct !== String(cur.pct);
  const save = async () => {
    const d = numIn(days, 7, 90);
    const p = numIn(pct, 5, 40);
    if (d == null || !Number.isInteger(d)) return toast('Próg przerwy: od 7 do 90 dni.');
    if (p == null) return toast('Obniżka ciężaru: od 5 do 40%.');
    await apply([put('clients', { ...client, comeback: { days: d, pct: Math.round(p), ...(on ? {} : { off: true }) } })], 'Zapisano ustawienie powrotu po przerwie.');
  };
  return (
    <Card title="Powrót po przerwie" className="comeback-settings">
      <p className="muted small">Pierwszy trening po dłuższej przerwie (także po zgłoszonej nieobecności) dostaje lżejsze podpowiedzi ciężaru. Podopieczny może wrócić do pełnych jednym przyciskiem.</p>
      <label className="check">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> Obniżaj ciężary po przerwie
      </label>
      <div className="comeback-grid">
        <label className="field">
          <span>Po ilu dniach bez treningu</span>
          <input className="input" inputMode="numeric" value={days} disabled={!on} onChange={(e) => setDays(e.target.value)} />
        </label>
        <label className="field">
          <span>Obniżka ciężaru (%)</span>
          <input className="input" inputMode="numeric" value={pct} disabled={!on} onChange={(e) => setPct(e.target.value)} />
        </label>
      </div>
      <button className="btn btn-primary btn-sm" disabled={!dirty} onClick={() => void save()}>
        Zapisz
      </button>
    </Card>
  );
}
