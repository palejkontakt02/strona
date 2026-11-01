import { useState } from 'react';
import type { Client } from '../domain';
import { ImportActivity } from '../components/ImportActivity';
import { Sheet } from '../components/Sheet';
import { Icon } from '../components/ui';
import { saveSession, sessionsOf } from '../data/ops';
import { useStore } from '../data/store';
import { fmtDay, fnum, uid } from '../format';
import { addDays, todayISO } from '../lib/dates';
import { pastForm } from '../lib/gender';
import { quickRunProblem, quickRunSession, runMinutes, type QuickRunInput } from '../lib/quickRun';
import { paceText, parseKm, runTotals } from '../lib/running';

const EMPTY: QuickRunInput = { km: '', time: '', effort: '', hr: '' };

/** Karta na Dziś dla biegających: „Biegłam / Biegłem” (szybki wpis w jednym ekranie) i import z zegarka. */
export function QuickRun({ client }: { client: Client }) {
  const [open, setOpen] = useState(false);
  const word = pastForm(client as Client & { sex?: string }, 'Biegłam', 'Biegłem');
  return (
    <section className="acard r7-qrun" aria-label="Bieg">
      <span className="eyebrow">Bieg poza aplikacją</span>
      <div className="r7-qrun-row">
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
          <Icon name="run" size={18} /> {word} — wpisz bieg
        </button>
        <ImportActivity clientId={client.id} small />
      </div>
      {open && <QuickRunSheet client={client} word={word} onClose={() => setOpen(false)} />}
    </section>
  );
}

function QuickRunSheet({ client, word, onClose }: { client: Client; word: string; onClose: () => void }) {
  const { db, apply, ask, toast } = useStore();
  const today = todayISO();
  const [f, setF] = useState<QuickRunInput>(EMPTY);
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof QuickRunInput, v: string) => setF((x) => ({ ...x, [k]: v }));
  const km = parseKm(f.km.replace(/\s*km$/i, ''));
  const min = runMinutes(f.time);
  const pace = paceText(min, km);

  const save = async () => {
    const bad = quickRunProblem(f);
    if (bad) return toast(bad);
    if (date > today || date < addDays(today, -60)) return toast('Data: od 60 dni wstecz do dziś.');
    const dup = sessionsOf(db, client.id).find((s) => s.date === date && Math.abs((runTotals(s)?.km ?? -1) - (km ?? 0)) < 0.1);
    if (dup && !(await ask(`Bieg ${fmtDay(date)} na ${fnum(km, 2)} km już jest zapisany. Zapisać drugi raz?`, { confirm: 'Zapisz' }))) return;
    const session = quickRunSession(f, { id: uid(), clientId: client.id, date, name: `Bieg ${fnum(km, 2)} km` });
    setBusy(true);
    // konto podopiecznego zapisuje tylko treningi — bez wizyty i płatności
    const { changes } = saveSession(db, { session, isNew: true, matchAppointment: false });
    const ok = await apply(changes.filter((c) => c.col === 'sessions'), 'Bieg zapisany — trener go zobaczy.');
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Sheet label={`${word} — szybki wpis`} onClose={onClose}>
      <div className="between sheet-top">
        <h2>{word}</h2>
        <button className="icon-btn" aria-label="Zamknij" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <div className="r7-qrun-grid">
        <label className="field">
          <span>Dystans (km)</span>
          <input className="input" inputMode="decimal" placeholder="np. 5,2" value={f.km} onChange={(e) => set('km', e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Czas</span>
          <input className="input" inputMode="numeric" placeholder="mm:ss lub h:mm:ss" value={f.time} onChange={(e) => set('time', e.target.value)} />
        </label>
      </div>
      {pace && <p className="muted small r7-qrun-pace">Tempo {pace}</p>}
      <div className="field">
        <span>Wysiłek (1 = bardzo lekko, 10 = maksymalnie)</span>
        <div className="scale r7-scale10" role="radiogroup" aria-label="Wysiłek 1–10">
          {Array.from({ length: 10 }, (_, i) => String(i + 1)).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={f.effort === v} className={f.effort === v ? 'active' : ''} onClick={() => set('effort', v)}>
              {v}
            </button>
          ))}
        </div>
      </div>
      <div className="r7-qrun-grid">
        <label className="field">
          <span>Tętno śr. (opcjonalnie)</span>
          <input className="input" inputMode="numeric" placeholder="np. 150" value={f.hr} onChange={(e) => set('hr', e.target.value)} />
        </label>
        <label className="field">
          <span>Kiedy</span>
          <input className="input" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <button type="button" className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={() => void save()}>
        {busy ? 'Zapisuję…' : 'Zapisz bieg'}
      </button>
    </Sheet>
  );
}
