import { useEffect, useState } from 'react';
import type { Client } from '../domain';
import { useStore } from '../data/store';
import { INTAKE, INTAKE_PARQ, intakeProgress, type Intake, type IntakeField, type IntakeFile } from '../lib/intake';
import { ClientFiles } from '../components/ClientFiles';
import { Consents } from '../components/Consents';
import { CONSENT_TEXT, consentDate, hasConsent } from '../lib/rodo';

const DRAFT = (id: string) => `fitowa-intake-draft:${id}`;
const DRAFT_FILES = (id: string) => `fitowa-intake-files:${id}`;

/**
 * Ankieta podopiecznego krok po kroku: zdrowie → styl życia → odżywianie → sport → cele → zgoda.
 * Pierwszy raz po zalogowaniu, potem w każdej chwili do poprawienia („Moja ankieta”).
 * Szkic zapisuje się na urządzeniu, żeby nic nie zginęło przy przerwaniu.
 */
export function IntakeWizard({ client, onClose, first, asTrainer }: { client: Client; onClose: () => void; first?: boolean; asTrainer?: boolean }) {
  const { saveIntake, sendClientNote, toast } = useStore();
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT(client.id)) || 'null') as Record<string, string> | null;
      if (d) return { ...client.intake?.answers, ...d };
    } catch {
      // brak szkicu
    }
    return { ...client.intake?.answers };
  });
  const [files, setFiles] = useState<IntakeFile[]>(() => {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_FILES(client.id)) || 'null') as IntakeFile[] | null;
      if (Array.isArray(d)) return d;
    } catch {
      // brak szkicu
    }
    return client.intake?.files ?? [];
  });
  const [step, setStep] = useState(0);
  // dane o zdrowiu (art. 9 RODO): ankieta tylko po aktywnej zgodzie podopiecznego (zgody: components/Consents.tsx)
  const consent = hasConsent(client, 'health');
  const [busy, setBusy] = useState(false);
  // kroki: sekcje ankiety → zdjęcia i dokumenty → zgoda i zapis
  const steps = INTAKE.length + 2;
  const sec = INTAKE[step];
  const filesStep = step === INTAKE.length;

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT(client.id), JSON.stringify(answers));
    } catch {
      // brak miejsca — szkic tylko w pamięci
    }
  }, [answers, client.id]);
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_FILES(client.id), JSON.stringify(files));
    } catch {
      // brak miejsca
    }
  }, [files, client.id]);
  // klamry: nowsze przeglądarki zwracają z scrollTo obietnicę — React wziąłby ją za funkcję sprzątającą i wywołał
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);

  const set = (k: string, v: string) => setAnswers((a) => ({ ...a, [k]: v }));
  const prog = intakeProgress({ answers });

  const finish = async () => {
    if (!consent && !asTrainer) return toast('Bez zgody na przetwarzanie danych o zdrowiu nie zapiszesz ankiety — zaznaczysz ją w Ustawieniach → Moje dane.');
    setBusy(true);
    const now = new Date().toISOString();
    const clean = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v.trim().slice(0, 2000)]).filter(([, v]) => v));
    const intake: Intake = { answers: clean, files: files.length ? files : undefined, consentAt: client.intake?.consentAt ?? (consent ? (consentDate(client, 'health') ?? now) : undefined), completedAt: client.intake?.completedAt ?? now, updatedAt: now };
    const ok = await saveIntake(client.id, intake);
    setBusy(false);
    if (!ok) return;
    try {
      localStorage.removeItem(DRAFT(client.id));
      localStorage.removeItem(DRAFT_FILES(client.id));
    } catch {
      // nic
    }
    // nowe „tak” w pytaniach zdrowotnych (PAR-Q) — wprost w wiadomości do trenera
    const newYes = INTAKE_PARQ.filter((k) => clean[k] === 'tak' && client.intake?.answers[k] !== 'tak').map((k) => INTAKE[0].fields.find((f) => f.key === k)?.label ?? k);
    const warn = client.intake?.completedAt && newYes.length ? ` UWAGA — nowe „tak” w pytaniach o zdrowie: ${newYes.join(' · ')}` : '';
    const added = files.filter((f) => !(client.intake?.files ?? []).some((x) => x.id === f.id)).length;
    const filesMsg = added ? ` Dołączone pliki: ${added}.` : '';
    if (!asTrainer) void sendClientNote(client.id, client.intake?.completedAt ? `Zaktualizowałem(-am) ankietę (zdrowie / styl życia / cele).${warn}${filesMsg}` : `Wypełniłem(-am) ankietę startową — zdrowie, styl życia, odżywianie, sport i cele.${filesMsg}`);
    else toast('Ankieta zapisana.');
    onClose();
  };

  // najpierw zgoda na dane o zdrowiu (krótka forma + „Więcej” = pełna klauzula)
  if (!consent && !asTrainer)
    return (
      <div className="ath-home fade intake">
        <header className="ath-hello">
          <span className="eyebrow">{first ? 'Witaj! Zacznijmy od krótkiej ankiety' : 'Moja ankieta'}</span>
          <h1>Twoja zgoda</h1>
          <p className="muted small">Ankieta pyta o zdrowie — urazy, choroby, ból. To dane szczególnie chronione, więc potrzebujemy Twojej wyraźnej zgody.</p>
        </header>
        <section className="acard">
          <Consents
            client={client}
            variant="prompt"
            only={['health']}
            saveLabel="Dalej ›"
            onLater={onClose}
            onDone={(c) => {
              if (!c.health) {
                toast(CONSENT_TEXT.health.needed);
                onClose();
              }
            }}
          />
        </section>
      </div>
    );

  return (
    <div className="ath-home fade intake">
      <header className="ath-hello">
        <span className="eyebrow">
          {first ? 'Witaj! Zacznijmy od krótkiej ankiety' : 'Moja ankieta'} · krok {step + 1} z {steps}
        </span>
        <h1>{sec ? sec.title : filesStep ? 'Zdjęcia i dokumenty' : 'Zgoda i zapis'}</h1>
        <div className="progress" aria-label={`Odpowiedzi: ${prog.done} z ${prog.total}`}>
          <span style={{ width: `${Math.round(((step + 1) / steps) * 100)}%` }} />
        </div>
        {sec?.intro && <p className="muted small">{sec.intro}</p>}
      </header>

      {sec ? (
        <section className="acard intake-fields">
          {sec.fields
            .filter((f) => !f.ifYes || answers[f.ifYes] === 'tak')
            .map((f) => (
              <IntakeInput key={f.key} f={f} value={answers[f.key] ?? ''} onChange={(v) => set(f.key, v)} exclude={f.key === 'goals_side' ? answers.goal : undefined} />
            ))}
        </section>
      ) : filesStep ? (
        <section className="acard">
          <p className="muted small">
            Opcjonalnie: wyniki badań, wypis ze szpitala, opis rezonansu / RTG, zalecenia lekarza albo zdjęcia sylwetki (przód, bok, tył). Zdjęcie zrobisz od razu aparatem albo dodasz z galerii; PDF z telefonu lub komputera. Widzi je tylko Twój trener.
          </p>
          <ClientFiles clientId={client.id} files={files} onChange={setFiles} />
        </section>
      ) : (
        <section className="acard">
          <p>
            Odpowiedziano na <b>{prog.done}</b> z {prog.total} pytań{files.length ? `, dołączone pliki: ${files.length}` : ''}. Puste pola możesz uzupełnić później w „Moja ankieta”.
          </p>
          {!asTrainer && consent && (
            <p className="muted small intake-consent">Zgoda na przetwarzanie danych o zdrowiu: udzielona. Wycofasz ją w każdej chwili w Ustawieniach → Moje dane.</p>
          )}
          {asTrainer && !consent && <p className="small warn-text">Podopieczny nie udzielił w aplikacji zgody na przetwarzanie danych o zdrowiu.</p>}
          {answers.parq_heart === 'tak' || answers.parq_chest === 'tak' || answers.parq_dizzy === 'tak' || answers.parq_supervised === 'tak' ? (
            <p className="small warn-text">Zaznaczyłeś(-aś) „tak” przy pytaniu o serce, ból w klatce, omdlenia albo nadzór lekarza — przed intensywnym treningiem skonsultuj się z lekarzem. Trener o tym wie.</p>
          ) : null}
        </section>
      )}

      <div className="intake-nav">
        {step > 0 ? (
          <button className="btn btn-ghost" onClick={() => setStep(step - 1)}>
            ‹ Wstecz
          </button>
        ) : (
          <button className="btn btn-ghost" onClick={onClose}>
            {first ? 'Uzupełnię później' : 'Zamknij'}
          </button>
        )}
        {step < steps - 1 ? (
          <button className="btn btn-primary btn-lg" onClick={() => setStep(step + 1)}>
            Dalej ›
          </button>
        ) : (
          <button className="btn btn-primary btn-lg" disabled={busy} onClick={() => void finish()}>
            {busy ? 'Zapisuję…' : client.intake?.completedAt ? 'Zapisz zmiany' : 'Zapisz ankietę'}
          </button>
        )}
      </div>
    </div>
  );
}

function IntakeInput({ f, value, onChange, exclude }: { f: IntakeField; value: string; onChange: (v: string) => void; exclude?: string }) {
  if (f.type === 'multi') {
    // kilka odpowiedzi — zapis jako „a, b, c”
    const sel = value ? value.split(', ').filter(Boolean) : [];
    const opts = f.options!.filter((o) => o !== exclude);
    return (
      <div className="intake-q">
        <span className="intake-label">{f.label}</span>
        <div className="intake-opts" role="group" aria-label={f.label}>
          {opts.map((o) => {
            const on = sel.includes(o);
            return (
              <button key={o} type="button" aria-pressed={on} className={on ? 'active' : ''} onClick={() => onChange((on ? sel.filter((x) => x !== o) : [...sel, o]).join(', '))}>
                {on ? '✓ ' : ''}
                {o}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  if (f.type === 'yesno' || f.type === 'scale' || (f.type === 'select' && (f.options?.length ?? 0) <= 4)) {
    const opts = f.type === 'yesno' ? ['nie', 'tak'] : f.type === 'scale' ? ['1', '2', '3', '4', '5'] : f.options!;
    return (
      <div className="intake-q">
        <span className="intake-label">{f.label}</span>
        {f.hint && <span className="muted small">{f.hint}</span>}
        <div className={`intake-opts ${f.type === 'scale' ? 'scale5' : ''}`} role="radiogroup" aria-label={f.label}>
          {opts.map((o) => (
            <button key={o} type="button" role="radio" aria-checked={value === o} className={value === o ? 'active' : ''} onClick={() => onChange(value === o ? '' : o)}>
              {o}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <label className="intake-q">
      <span className="intake-label">{f.label}</span>
      {f.hint && <span className="muted small">{f.hint}</span>}
      {f.type === 'select' ? (
        <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">— wybierz —</option>
          {f.options!.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : f.type === 'textarea' ? (
        <textarea className="input" rows={2} maxLength={2000} value={value} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className="input" inputMode={f.type === 'number' ? 'decimal' : undefined} maxLength={300} value={value} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}
