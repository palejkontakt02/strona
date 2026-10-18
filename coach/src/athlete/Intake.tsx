import { useEffect, useState } from 'react';
import type { Client } from '../domain';
import { useStore } from '../data/store';
import { INTAKE, intakeProgress, type Intake, type IntakeField } from '../lib/intake';

const DRAFT = (id: string) => `fitowa-intake-draft:${id}`;

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
  const [step, setStep] = useState(0);
  const [consent, setConsent] = useState(!!client.intake?.consentAt);
  const [busy, setBusy] = useState(false);
  const steps = INTAKE.length + 1;
  const sec = INTAKE[step];

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT(client.id), JSON.stringify(answers));
    } catch {
      // brak miejsca — szkic tylko w pamięci
    }
  }, [answers, client.id]);
  useEffect(() => window.scrollTo(0, 0), [step]);

  const set = (k: string, v: string) => setAnswers((a) => ({ ...a, [k]: v }));
  const prog = intakeProgress({ answers });

  const finish = async () => {
    if (!consent && !asTrainer) return toast('Zaznacz zgodę na przetwarzanie danych o zdrowiu, żeby zapisać ankietę.');
    setBusy(true);
    const now = new Date().toISOString();
    const clean = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v.trim().slice(0, 2000)]).filter(([, v]) => v));
    const intake: Intake = { answers: clean, consentAt: client.intake?.consentAt ?? (consent ? now : undefined), completedAt: client.intake?.completedAt ?? now, updatedAt: now };
    const ok = await saveIntake(client.id, intake);
    setBusy(false);
    if (!ok) return;
    try {
      localStorage.removeItem(DRAFT(client.id));
    } catch {
      // nic
    }
    if (!asTrainer) void sendClientNote(client.id, client.intake?.completedAt ? 'Zaktualizowałem(-am) ankietę (zdrowie / styl życia / cele).' : 'Wypełniłem(-am) ankietę startową — zdrowie, styl życia, odżywianie, sport i cele.');
    else toast('Ankieta zapisana.');
    onClose();
  };

  return (
    <div className="ath-home fade intake">
      <header className="ath-hello">
        <span className="eyebrow">
          {first ? 'Witaj! Zacznijmy od krótkiej ankiety' : 'Moja ankieta'} · krok {step + 1} z {steps}
        </span>
        <h1>{sec ? sec.title : 'Zgoda i zapis'}</h1>
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
              <IntakeInput key={f.key} f={f} value={answers[f.key] ?? ''} onChange={(v) => set(f.key, v)} />
            ))}
        </section>
      ) : (
        <section className="acard">
          <p>
            Odpowiedziano na <b>{prog.done}</b> z {prog.total} pytań. Puste pola możesz uzupełnić później w „Moja ankieta”.
          </p>
          {!asTrainer && (
            <label className="check intake-consent">
              <input type="checkbox" checked={consent} disabled={!!client.intake?.consentAt} onChange={(e) => setConsent(e.target.checked)} />
              <span>
                Zgadzam się na przetwarzanie podanych danych o moim zdrowiu przez mojego trenera wyłącznie w celu prowadzenia treningów (art. 9 ust. 2 lit. a RODO). Zgodę mogę wycofać w każdej chwili, pisząc do trenera.
              </span>
            </label>
          )}
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

function IntakeInput({ f, value, onChange }: { f: IntakeField; value: string; onChange: (v: string) => void }) {
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
