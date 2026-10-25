import { useEffect, useRef, useState } from 'react';
import { Card, Field, Icon, IconBtn, Tag } from '../../components/ui';
import type { Client, HealthIntake, TrainerNotes } from '../../domain';
import { put } from '../../data/db';
import { useStore } from '../../data/store';
import { fmtDay, uid } from '../../format';
import { addDays, todayISO } from '../../lib/dates';
import { INTAKE, intakeProgress, parqYesCount, type Intake } from '../../lib/intake';
import { useNav } from '../../nav';
import { ClientFiles } from '../../components/ClientFiles';

/** PAR-Q (wersja skrócona, 7 pytań) — „tak” przy którymkolwiek = przed intensywnym treningiem zgoda lekarza. */
export const PARQ: [string, string][] = [
  ['heart', 'Czy lekarz stwierdził chorobę serca lub nadciśnienie?'],
  ['chest', 'Ból w klatce piersiowej w spoczynku, w codziennych czynnościach lub przy wysiłku?'],
  ['dizzy', 'Zawroty głowy z utratą równowagi albo utrata przytomności w ostatnich 12 miesiącach?'],
  ['chronic', 'Inna rozpoznana choroba przewlekła (np. cukrzyca, astma, osteoporoza)?'],
  ['meds', 'Leki przyjmowane na stałe?'],
  ['joints', 'Problem z kośćmi, stawami lub mięśniami, który może się nasilić przy wysiłku?'],
  ['supervised', 'Lekarz zalecił aktywność tylko pod nadzorem medycznym?'],
];

export function trainerNotesOf(list: TrainerNotes[], clientId: string): TrainerNotes {
  return list.find((n) => n.clientId === clientId) ?? { id: clientId, clientId };
}

/** Sygnały z wywiadu: „tak” w PAR-Q bez zgody lekarza, brak wywiadu, przeciwwskazania. */
export function healthFlags(h: HealthIntake | undefined, intake?: Intake): { level: 'red' | 'yellow'; text: string }[] {
  const out: { level: 'red' | 'yellow'; text: string }[] = [];
  const yes = Math.max(PARQ.filter(([k]) => h?.parq?.[k]).length, parqYesCount(intake));
  if (yes && !h?.clearanceDate) out.push({ level: 'red', text: `PAR-Q: ${yes}× „tak”${parqYesCount(intake) ? ' (ankieta podopiecznego)' : ''} — brak zgody lekarza w wywiadzie` });
  // zgoda lekarza jest starsza niż zmiana ankiety z „tak” — trzeba sprawdzić, czy dalej obowiązuje
  else if (h?.clearanceDate && parqYesCount(intake) && (intake?.updatedAt ?? '').slice(0, 10) > h.clearanceDate)
    out.push({ level: 'red', text: `PAR-Q: ankieta zmieniona ${fmtDay(intake!.updatedAt!.slice(0, 10))} (${parqYesCount(intake)}× „tak”) — po zgodzie lekarza z ${fmtDay(h.clearanceDate)}; sprawdź, czy zgoda jest aktualna` });
  if (h?.updated && h.updated < addDays(todayISO(), -365)) out.push({ level: 'yellow', text: 'Wywiad zdrowotny starszy niż rok — zaktualizuj' });
  return out;
}

/** Odpowiedzi z ankiety podopiecznego (tylko do odczytu; poprawia podopieczny w „Moja ankieta”). */
export function ClientIntakeCard({ client }: { client: Client }) {
  const { startAthlete } = useNav();
  const [open, setOpen] = useState(false);
  const i = client.intake;
  const prog = intakeProgress(i);
  return (
    <Card
      title={
        <>
          Ankieta podopiecznego {i?.completedAt ? <Tag tone="ok">wypełniona</Tag> : <Tag tone="warn">niewypełniona</Tag>}{' '}
          {parqYesCount(i) > 0 && <Tag tone="danger">PAR-Q: {parqYesCount(i)}× tak</Tag>}{' '}
          {i?.files?.length ? <Tag tone="muted"><Icon name="clip" size={13} /> {i.files.length}</Tag> : null}
        </>
      }
      action={
        i?.completedAt ? (
          <button className="btn btn-ghost btn-sm" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? 'Zwiń' : 'Pokaż odpowiedzi'}
          </button>
        ) : undefined
      }
    >
      {!i?.completedAt ? (
        <p className="muted small">
          Podopieczny wypełnia ankietę po pierwszym zalogowaniu (zdrowie, styl życia, odżywianie, sport, cele). Możesz też uzupełnić ją z nim:{' '}
          <button className="link small" onClick={() => startAthlete(client.id)}>
            Tryb zawodnika → „Ankieta podopiecznego”
          </button>
          .
        </p>
      ) : (
        <p className="muted small">
          Wypełniona {fmtDay(i.completedAt.slice(0, 10))}
          {i.updatedAt && i.updatedAt !== i.completedAt ? ` · zmieniona ${fmtDay(i.updatedAt.slice(0, 10))}` : ''} · {prog.done}/{prog.total} odpowiedzi
          {i.consentAt ? ` · zgoda RODO ${fmtDay(i.consentAt.slice(0, 10))}` : ' · bez zgody RODO'}
        </p>
      )}
      {i?.files?.length ? (
        <div className="sub-section">
          <h4 className="sub-title">Zdjęcia i dokumenty od podopiecznego</h4>
          <ClientFiles clientId={client.id} files={i.files} editable={false} />
        </div>
      ) : null}
      {open && i && (
        <div className="intake-answers">
          {INTAKE.map((sec) => {
            const rows = sec.fields.filter((f) => (i.answers[f.key] ?? '').trim());
            if (!rows.length) return null;
            return (
              <div key={sec.id}>
                <h4>{sec.title}</h4>
                <dl>
                  {rows.map((f) => (
                    <div key={f.key} className={f.key.startsWith('parq_') && i.answers[f.key] === 'tak' ? 'flag' : ''}>
                      <dt>{f.label}</dt>
                      <dd>{i.answers[f.key]}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/** Wywiad zdrowotny i prywatne notatki — osobna tabela, podopieczny ich nie widzi. */
export function ClientHealth({ client }: { client: Client }) {
  const { db, apply, ask } = useStore();
  const rec = trainerNotesOf(db.trainer_notes, client.id);
  const [h, setH] = useState<HealthIntake>(rec.health ?? {});
  const [notes, setNotes] = useState(rec.notes ?? '');
  const [dirty, setDirty] = useState(false);
  const [visit, setVisit] = useState('');
  const [open, setOpen] = useState(!rec.health);
  useEffect(() => {
    setH(rec.health ?? {});
    setNotes(rec.notes ?? '');
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  const upd = (patch: Partial<HealthIntake>) => {
    setH((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  /** Rekord do zapisu; data wywiadu zmienia się tylko, gdy zmieniły się pola wywiadu (nie przy notatce z wizyty). */
  const record = (hh: HealthIntake, nn: string, base: TrainerNotes, extra: Partial<TrainerNotes> = {}): TrainerNotes => {
    const changed = JSON.stringify({ ...hh, updated: undefined }) !== JSON.stringify({ ...(base.health ?? {}), updated: undefined });
    return { ...base, health: { ...hh, updated: changed || !base.health?.updated ? todayISO() : base.health.updated }, notes: nn.trim() || undefined, ...extra };
  };
  const save = (extra: Partial<TrainerNotes> = {}, msg = 'Zapisano wywiad (widzisz go tylko Ty).') =>
    apply([put('trainer_notes', record(h, notes, rec, extra))], msg).then((ok) => {
      if (ok) setDirty(false);
      return ok;
    });
  // autozapis 2 s po zmianie
  useEffect(() => {
    if (!dirty) return;
    const t = window.setTimeout(() => void save({}, 'Zapisano wywiad.'), 2000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h, notes, dirty]);
  // wyjście z karty przed autozapisem — zapis od razu (inaczej zmiana by przepadła)
  const latest = useRef({ h, notes, dirty, rec, apply });
  latest.current = { h, notes, dirty, rec, apply };
  useEffect(
    () => () => {
      const l = latest.current;
      if (l.dirty) void l.apply([put('trainer_notes', record(l.h, l.notes, l.rec))], 'Zapisano wywiad.');
    },
    // karta klienta montuje się od nowa przy zmianie podopiecznego — tylko odmontowanie
    [],
  );

  const yes = PARQ.filter(([k]) => h.parq?.[k]).length;
  const visits = [...(rec.visits ?? [])].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const tf = (k: keyof HealthIntake) => ({
    value: (h[k] as string | undefined) ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => upd({ [k]: e.target.value || undefined } as Partial<HealthIntake>),
  });

  return (
    <Card
      title={
        <>
          Zdrowie i wywiad <Tag tone="muted">tylko trener</Tag> {yes > 0 && <Tag tone={h.clearanceDate ? 'warn' : 'danger'}>PAR-Q: {yes}× tak</Tag>}
        </>
      }
      action={
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Zwiń' : 'Pokaż'}
        </button>
      }
    >
      <p className="muted small">Te dane są w osobnej tabeli — podopieczny ich nie widzi. Aplikacja nie stawia diagnoz: „tak” w PAR-Q = przed intensywnym treningiem zgoda lekarza.</p>
      {(h.contraindications || h.restrictions) && (
        <div className="coach-note">
          <span className="eyebrow">Unikać / ograniczenia</span>
          <p>{[h.contraindications, h.restrictions].filter(Boolean).join(' · ')}</p>
        </div>
      )}
      {open && (
        <>
          {(() => {
            // odpowiedzi podopiecznego z ankiety — do przepisania jednym kliknięciem (bez nadpisywania już wpisanych)
            const fromIntake = PARQ.filter(([k]) => h.parq?.[k] == null && (client.intake?.answers[`parq_${k}`] === 'tak' || client.intake?.answers[`parq_${k}`] === 'nie'));
            return fromIntake.length > 0 ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => upd({ parq: { ...h.parq, ...Object.fromEntries(fromIntake.map(([k]) => [k, client.intake!.answers[`parq_${k}`] === 'tak'])) } })}>
                Przepisz PAR-Q z ankiety podopiecznego ({fromIntake.length})
              </button>
            ) : null;
          })()}
          <div className="parq">
            {PARQ.map(([k, q]) => (
              <div key={k} className="parq-row">
                <span>
                  {q}
                  {h.parq?.[k] == null && client.intake?.answers[`parq_${k}`] && (
                    <span className={`small ${client.intake.answers[`parq_${k}`] === 'tak' ? 'warn-text' : 'muted'}`}> · w ankiecie: {String(client.intake.answers[`parq_${k}`])}</span>
                  )}
                </span>
                <div className="seg seg-sm" role="radiogroup" aria-label={q}>
                  {[
                    [false, 'nie'],
                    [true, 'tak'],
                  ].map(([v, l]) => (
                    <button key={String(v)} type="button" role="radio" aria-checked={(h.parq?.[k] ?? null) === v} className={(h.parq?.[k] ?? null) === v ? 'active' : ''} onClick={() => upd({ parq: { ...h.parq, [k]: v as boolean } })}>
                      {l as string}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="form-grid">
            <Field label="Choroby / rozpoznania">
              <input className="input" {...tf('conditions')} placeholder="np. gonartroza kolana P, nadciśnienie" />
            </Field>
            <Field label="Leki">
              <input className="input" {...tf('meds')} placeholder="np. beta-bloker (niższe tętno!)" />
            </Field>
            <Field label="Ciśnienie spoczynkowe">
              <input className="input" {...tf('bp')} placeholder="np. 135/85" />
            </Field>
            <Field label="Zgoda / zalecenia od (lekarz, fizjo)">
              <input className="input" {...tf('clearanceBy')} placeholder="np. dr Kowalski, ortopeda" />
            </Field>
            <Field label="Data zgody">
              <input className="input" type="date" {...tf('clearanceDate')} />
            </Field>
            <Field label="Ograniczenia od lekarza">
              <input className="input" {...tf('restrictions')} placeholder="np. bez skoków do 12 tyg." />
            </Field>
            <Field label="Czego unikać na treningu (pokaże się przy prowadzeniu)" wide>
              <input className="input" {...tf('contraindications')} placeholder="np. głębokie zgięcie kolana pod obciążeniem, Valsalva" />
            </Field>
            <Field label="Prywatne notatki trenera" wide>
              <textarea
                className="input"
                rows={3}
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  setDirty(true);
                }}
                placeholder="Rzeczy, których podopieczny nie powinien widzieć."
              />
            </Field>
          </div>
          <div className="between save-row">
            <span className="muted small">{rec.health?.updated ? `Wywiad z ${fmtDay(rec.health.updated)}` : 'Uzupełnij — zapisuje się samo'}</span>
            {dirty ? (
              <button className="btn btn-primary btn-sm" onClick={() => void save()}>
                Zapisz
              </button>
            ) : rec.health ? (
              <span className="save-state">✓ Zapisano</span>
            ) : null}
          </div>
        </>
      )}
      <div className="sub-section">
        <h4 className="sub-title">Notatki z wizyt <span className="muted">· prywatne</span></h4>
        <div className="reply-box">
          <textarea className="input" rows={2} value={visit} onChange={(e) => setVisit(e.target.value)} placeholder="np. S: ból 3/10 po schodach · O: przysiad do 90° bez bólu · A: lepiej · P: dodać step-up" aria-label="Notatka z wizyty" />
          <button
            className={`btn btn-sm ${visit.trim() ? 'btn-primary' : 'btn-ghost'}`}
            disabled={!visit.trim()}
            onClick={() =>
              void save({ visits: [...(rec.visits ?? []), { id: uid(), date: todayISO(), text: visit.trim().slice(0, 4000) }] }, 'Notatka z wizyty zapisana.').then((ok) => ok && setVisit(''))
            }
          >
            Dodaj notatkę
          </button>
        </div>
        {visits.length > 0 && (
          <ul className="rows">
            {visits.slice(0, 20).map((v) => (
              <li key={v.id} className="row row-top">
                <span className="row-time">{fmtDay(v.date)}</span>
                <p className="pre grow">{v.text}</p>
                <IconBtn
                  icon="trash"
                  label="Usuń notatkę"
                  danger
                  onClick={async () => {
                    if (await ask('Usunąć tę notatkę z wizyty?')) void save({ visits: (rec.visits ?? []).filter((x) => x.id !== v.id) }, 'Notatka usunięta.');
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
