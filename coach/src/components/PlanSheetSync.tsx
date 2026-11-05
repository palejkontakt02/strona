import { useState } from 'react';
import type { Client, Plan } from '../domain';
import { put } from '../data/db';
import { useStore } from '../data/store';
import { createPlanSheet, pullPlanSheet, pushPlanSheet, sheetUrl } from '../lib/gsheets';
import { PlanImport } from './PlanImport';
import { Icon, Modal } from './ui';

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

/**
 * Plan ↔ Arkusz Google: utworzenie arkusza z planem, „Wyślij do arkusza” (aplikacja → arkusz) i
 * „Pobierz zmiany z arkusza” (arkusz → ten sam plan, z podglądem różnic). Edytuje tylko trener.
 */
export function PlanSheetSync({ plan, client, onClose }: { plan: Plan; client: Client; onClose: () => void }) {
  const { apply, ask, toast } = useStore();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [rows, setRows] = useState<string[][] | null>(null);
  const id = plan.gsheet?.id;

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setErr('');
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Nie udało się połączyć z Arkuszami Google.');
    } finally {
      setBusy('');
    }
  };

  const create = () =>
    run('create', async () => {
      const sid = await createPlanSheet(plan, client.name);
      await apply([put('plans', { ...plan, gsheet: { id: sid, at: new Date().toISOString() } })]);
      toast('Arkusz Google utworzony i połączony z planem.', { label: 'Otwórz', run: () => window.open(sheetUrl(sid), '_blank', 'noopener') });
    });
  const push = () =>
    run('push', async () => {
      if (!id) return;
      if (!(await ask('Wysłać plan do arkusza? Zakładka „Plan” w arkuszu zostanie zastąpiona planem z aplikacji — zmiany w arkuszu, których nie pobrałeś, przepadną.', { confirm: 'Wyślij do arkusza', danger: false }))) return;
      await pushPlanSheet(id, plan);
      await apply([put('plans', { ...plan, gsheet: { id, at: new Date().toISOString() } })], 'Plan wysłany do arkusza.');
    });
  const pull = () =>
    run('pull', async () => {
      if (!id) return;
      const r = await pullPlanSheet(id);
      if (r.length < 2) throw new Error('Zakładka „Plan” w arkuszu jest pusta.');
      setRows(r);
    });
  const unlink = async () => {
    if (!(await ask('Odłączyć arkusz od planu? Plik zostaje na Twoim Dysku Google, tylko przestanie być połączony.', { confirm: 'Odłącz', danger: false }))) return;
    const { gsheet: _drop, ...rest } = plan;
    void _drop;
    await apply([put('plans', rest as Plan)], 'Arkusz odłączony.');
    onClose();
  };

  if (rows && id)
    return (
      <PlanImport
        clientId={client.id}
        active={plan.active}
        target={plan}
        initialRows={rows}
        source={`Arkusz Google „${plan.name}”`}
        onClose={() => setRows(null)}
        onDone={(p) => {
          setRows(null);
          void apply([put('plans', { ...p, gsheet: { id, at: new Date().toISOString() } })], `Zaktualizowano „${plan.name}” z arkusza Google.`);
          onClose();
        }}
      />
    );

  return (
    <Modal title={`Arkusz Google — ${plan.name}`} onClose={onClose}>
      {!id ? (
        <>
          <p className="small">
            Utworzę na Twoim Dysku Google arkusz z tym planem (zakładka „Plan”: wiersz = ćwiczenie i jego serie). Edytujesz go w Arkuszach Google, a w aplikacji klikasz „Pobierz zmiany” — plan zaktualizuje się z podglądem różnic, wykonane treningi i notatki podopiecznego zostają.
          </p>
          <p className="muted small">Aplikacja dostaje dostęp tylko do arkuszy, które sama utworzy — nie do reszty Dysku. Przy pierwszym użyciu Google zapyta o zgodę.</p>
          <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void create()}>
            {busy === 'create' ? 'Tworzę arkusz…' : 'Utwórz arkusz Google'}
          </button>
        </>
      ) : (
        <>
          <p className="small">
            <a href={sheetUrl(id)} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
              <Icon name="link" size={16} /> Otwórz arkusz
            </a>
            {plan.gsheet?.at && <span className="muted"> · ostatnia synchronizacja {when(plan.gsheet.at)}</span>}
          </p>
          <div className="gs-actions">
            <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void pull()}>
              <Icon name="download" size={16} /> {busy === 'pull' ? 'Pobieram…' : 'Pobierz zmiany z arkusza'}
            </button>
            <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => void push()}>
              <Icon name="up" size={16} /> {busy === 'push' ? 'Wysyłam…' : 'Wyślij plan do arkusza'}
            </button>
          </div>
          <p className="muted small">„Pobierz” — arkusz → aplikacja (najpierw zobaczysz, co się zmieni). „Wyślij” — aplikacja → arkusz (np. po zmianach w edytorze planu).</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void unlink()}>
            Odłącz arkusz
          </button>
        </>
      )}
      {err && (
        <p className="pi-error small" role="alert">
          {err}
        </p>
      )}
    </Modal>
  );
}
