import { useEffect, useRef, useState } from 'react';
import { Field, Icon, Modal } from '../components/ui';
import type { Appointment } from '../domain';
import { put } from '../data/db';
import { deleteClientFile, fileUrl, isImage, saveClientFile } from '../data/files';
import { PROFILE_PHOTO_FOLDER, saveTrainerProfile, useTrainerProfile, type TrainerProfile } from '../data/trainerProfile';
import { useStore } from '../data/store';
import { fmtDay, fmtWeekday, initials, plural } from '../format';
import { todayISO } from '../lib/dates';
import { num } from '../lib/parse';
import { cancelByTrainer, fmtAccount, normalizeProfile, onVacation, pricesLine, profileProblems, vacationAppointments, vacationReplyText, WEEKDAYS, workHoursLine } from '../lib/trainerProfile';
import { useNav } from '../nav';

/* Profil trenera (Ustawienia → „Mój profil”): dane widoczne dla podopiecznych, cennik, godziny, urlop. */

/** Zdjęcie trenera (albo inicjały) — do użycia także w aplikacji podopiecznego. */
export function TrainerAvatar({ profile, size = 48 }: { profile: TrainerProfile; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    setSrc(null);
    if (profile.photo)
      fileUrl(profile.photo)
        .then((u) => {
          if (u.startsWith('blob:')) made = u;
          if (alive) setSrc(u);
        })
        .catch(() => undefined);
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [profile.photo]);
  return src ? (
    <img className="tp-avatar" src={src} alt={profile.name ? `Zdjęcie: ${profile.name}` : 'Zdjęcie trenera'} width={size} height={size} style={{ width: size, height: size }} />
  ) : (
    <span className="avatar tp-avatar" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden>
      {profile.name ? initials(profile.name) : <Icon name="user" size={Math.round(size * 0.5)} />}
    </span>
  );
}

/** Skrót profilu w Ustawieniach. */
export function TrainerProfileSummary() {
  const { profile, loaded } = useTrainerProfile();
  const { openModal } = useNav();
  const vac = profile.vacation;
  return (
    <div className="tp-summary">
      <TrainerAvatar profile={profile} size={44} />
      <div className="grow">
        <strong>{profile.name || (loaded ? 'Uzupełnij swój profil' : 'Wczytuję…')}</strong>
        <div className="muted small">{[profile.phone, pricesLine(profile)].filter(Boolean).join(' · ') || 'Imię, zdjęcie, telefon, dane do przelewu i cennik — podopieczni widzą je w aplikacji.'}</div>
        {vac && vac.to >= todayISO() && (
          <div className="small warn-text">
            {onVacation(profile) ? 'Na urlopie' : 'Urlop'} {fmtDay(vac.from)} – {fmtDay(vac.to)}
          </div>
        )}
      </div>
      <button type="button" className="btn btn-secondary" onClick={() => openModal({ kind: 'trainerProfile' })}>
        Mój profil…
      </button>
    </div>
  );
}

type Draft = Record<string, string>;

function toDraft(p: TrainerProfile): Draft {
  const s = (v: number | undefined) => (v != null ? String(v).replace('.', ',') : '');
  return {
    name: p.name ?? '',
    phone: p.phone ?? '',
    email: p.email ?? '',
    replyHours: p.replyHours ?? '',
    bankAccount: p.bankAccount ?? '',
    bankName: p.bankName ?? '',
    blikPhone: p.blikPhone ?? '',
    single: s(p.prices?.single),
    pkgN: s(p.prices?.package?.sessions),
    pkgPrice: s(p.prices?.package?.price),
    sub: s(p.prices?.subscription),
    duration: s(p.defaultDuration),
    whFrom: p.workHours?.from ?? '',
    whTo: p.workHours?.to ?? '',
    whDays: (p.workHours?.days ?? []).join(','),
    weeklyNote: p.weeklyNote ?? '',
    vacFrom: p.vacation?.from ?? '',
    vacTo: p.vacation?.to ?? '',
    vacMsg: p.vacation?.message ?? '',
  };
}

function fromDraft(base: TrainerProfile, d: Draft): TrainerProfile {
  const n = (k: string) => num(d[k] ?? '') ?? undefined;
  const days = d.whDays.split(',').filter(Boolean).map(Number);
  const pkgN = n('pkgN');
  const pkgPrice = n('pkgPrice');
  return normalizeProfile({
    ...base,
    name: d.name,
    phone: d.phone,
    email: d.email,
    replyHours: d.replyHours,
    bankAccount: d.bankAccount,
    bankName: d.bankName,
    blikPhone: d.blikPhone,
    prices: { single: n('single'), subscription: n('sub'), package: pkgN && pkgPrice != null ? { sessions: Math.round(pkgN), price: pkgPrice } : undefined },
    defaultDuration: n('duration') != null ? Math.round(n('duration')!) : undefined,
    workHours: d.whFrom && d.whTo && days.length ? { from: d.whFrom, to: d.whTo, days } : undefined,
    weeklyNote: d.weeklyNote,
    vacation: d.vacFrom && d.vacTo ? { from: d.vacFrom, to: d.vacTo, message: d.vacMsg } : undefined,
  });
}

export function TrainerProfileModal() {
  const { db, apply, toast } = useStore();
  const { closeModal } = useNav();
  const { profile, loaded } = useTrainerProfile();
  const [d, setD] = useState<Draft>(() => toDraft(profile));
  const [photo, setPhoto] = useState<string | undefined>(profile.photo);
  const [busy, setBusy] = useState(false);
  const [toCancel, setToCancel] = useState<Appointment[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const touched = useRef(false);
  // profil z chmury dochodzi po chwili — formularz bierze go, dopóki nic nie zmieniono
  useEffect(() => {
    if (loaded && !touched.current) {
      setD(toDraft(profile));
      setPhoto(profile.photo);
    }
  }, [loaded, profile]);
  const set = (k: string, v: string) => {
    touched.current = true;
    setD((x) => ({ ...x, [k]: v }));
  };
  const inp = (k: string, extra: Record<string, unknown> = {}) => <input className="input" value={d[k]} onChange={(e) => set(k, e.target.value)} {...extra} />;
  const draft = fromDraft({ ...profile, photo }, d);
  const problems = profileProblems(draft);
  if (d.vacFrom && d.vacTo && d.vacTo < d.vacFrom) problems.push('Urlop: data końca przed datą początku.');
  const days = d.whDays.split(',').filter(Boolean).map(Number);
  const nameOf = (id: string) => db.clients.find((c) => c.id === id)?.name ?? '—';

  const pickPhoto = async (f: File) => {
    if (!isImage(f.type, f.name)) return toast('Wybierz zdjęcie (JPG, PNG).');
    setBusy(true);
    try {
      const r = await saveClientFile(f, PROFILE_PHOTO_FOLDER);
      touched.current = true;
      setPhoto(r.ref);
    } catch (e) {
      toast((e as Error).message === 'BUCKET' ? 'Brak koszyka plików — uruchom w Supabase sekcję 18 z hardening.sql.' : 'Nie udało się wgrać zdjęcia — sprawdź połączenie.');
    }
    setBusy(false);
  };

  const submit = async () => {
    if (busy) return;
    if (problems.length) return toast(problems[0]);
    setBusy(true);
    const before = profile;
    const r = await saveTrainerProfile(draft);
    setBusy(false);
    if (!r.ok) return toast(r.error ?? 'Nie udało się zapisać profilu.');
    if (before.photo && before.photo !== draft.photo) void deleteClientFile(before.photo);
    // nowy / zmieniony urlop: pytanie o odwołanie wizyt w tym czasie
    const v = draft.vacation;
    const changed = v && (v.from !== before.vacation?.from || v.to !== before.vacation?.to);
    const list = changed ? vacationAppointments(db.appointments, v) : [];
    if (list.length) {
      setToCancel(list);
      setPicked(new Set(list.map((a) => a.id)));
      toast('Zapisano profil.');
      return;
    }
    toast('Zapisano profil — podopieczni widzą zmiany w aplikacji.');
    closeModal();
  };

  const cancelPicked = async () => {
    const list = (toCancel ?? []).filter((a) => picked.has(a.id));
    if (!list.length) return closeModal();
    setBusy(true);
    const ok = await apply(list.map((a) => put('appointments', cancelByTrainer(a))), `Odwołano ${list.length} ${plural(list.length, 'wizytę', 'wizyty', 'wizyt')}.`);
    setBusy(false);
    if (ok) closeModal();
  };

  if (toCancel) {
    const n = picked.size;
    return (
      <Modal title="Wizyty w czasie urlopu" onClose={closeModal} onSubmit={() => void cancelPicked()} submitLabel={n ? `Odwołaj ${n} ${plural(n, 'wizytę', 'wizyty', 'wizyt')}` : 'Gotowe'}>
        <p>
          Odwołać {toCancel.length} {plural(toCancel.length, 'wizytę', 'wizyty', 'wizyt')} w czasie urlopu ({fmtDay(draft.vacation!.from)} – {fmtDay(draft.vacation!.to)})?
        </p>
        <p className="muted small">Zaznaczone dostaną status „odwołana” (jak odwołanie przez Ciebie w kalendarzu). Podopieczni zobaczą to w aplikacji.</p>
        <ul className="rows tp-cancel">
          {toCancel.map((a) => (
            <li key={a.id} className="row">
              <label className="tp-check grow">
                <input
                  type="checkbox"
                  checked={picked.has(a.id)}
                  onChange={(e) =>
                    setPicked((s) => {
                      const x = new Set(s);
                      if (e.target.checked) x.add(a.id);
                      else x.delete(a.id);
                      return x;
                    })
                  }
                />
                <span className="row-time">
                  {fmtWeekday(a.date)} {fmtDay(a.date)}, {a.time}
                </span>
                <span className="ellipsis">{nameOf(a.clientId)}</span>
              </label>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-ghost btn-sm" onClick={closeModal}>
          Zostaw wszystkie
        </button>
      </Modal>
    );
  }

  return (
    <Modal title="Mój profil" onClose={closeModal} onSubmit={() => void submit()} submitLabel={busy ? 'Zapisuję…' : 'Zapisz profil'}>
      <p className="muted small tp-lead">
        <Icon name="eye" size={14} /> Imię, zdjęcie, telefon, dane do przelewu, godziny odpowiedzi i urlop widzą Twoi podopieczni w aplikacji.
      </p>
      <div className="tp-photo">
        <TrainerAvatar profile={{ ...draft, photo }} size={64} />
        <div className="stack-sm">
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            {photo ? 'Zmień zdjęcie' : 'Dodaj zdjęcie'}
          </button>
          {photo && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => ((touched.current = true), setPhoto(undefined))}>
              Usuń zdjęcie
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && void pickPhoto(e.target.files[0])} />
      </div>
      <div className="form-grid">
        <Field label="Imię i nazwisko" wide>
          {inp('name', { autoComplete: 'name' })}
        </Field>
        <Field label="Telefon">{inp('phone', { type: 'tel', inputMode: 'tel', placeholder: '+48 600 100 200' })}</Field>
        <Field label="E-mail">{inp('email', { type: 'email', inputMode: 'email', autoCapitalize: 'none' })}</Field>
        <Field label="Godziny odpowiedzi" wide hint="Podopieczny widzi to przy rozmowie.">
          {inp('replyHours', { placeholder: 'np. odpisuję do 20:00', maxLength: 120 })}
        </Field>
      </div>

      <h4 className="form-section">Dane do przelewu</h4>
      <div className="form-grid">
        <Field label="Numer konta" wide hint={d.bankAccount && !problems.some((p) => p.startsWith('Numer')) ? fmtAccount(d.bankAccount) : undefined}>
          {inp('bankAccount', { inputMode: 'numeric', placeholder: '12 3456 7890 1234 5678 9012 3456', autoComplete: 'off' })}
        </Field>
        <Field label="Bank / odbiorca">{inp('bankName', { placeholder: 'np. mBank, Jan Kowalski' })}</Field>
        <Field label="BLIK na telefon">{inp('blikPhone', { type: 'tel', inputMode: 'tel', placeholder: '+48 600 100 200' })}</Field>
      </div>

      <h4 className="form-section">Cennik</h4>
      <p className="muted small">Podpowiada stawki przy dodawaniu nowego podopiecznego.</p>
      <div className="form-grid tp-prices">
        <Field label="Sesja (zł)">{inp('single', { inputMode: 'decimal' })}</Field>
        <Field label="Pakiet – sesji">{inp('pkgN', { inputMode: 'numeric', placeholder: 'np. 10' })}</Field>
        <Field label="Pakiet – cena (zł)">{inp('pkgPrice', { inputMode: 'decimal' })}</Field>
        <Field label="Abonament (zł / mies.)">{inp('sub', { inputMode: 'decimal' })}</Field>
      </div>

      <h4 className="form-section">Wizyty i godziny pracy</h4>
      <div className="form-grid">
        <Field label="Domyślna długość wizyty (min)">{inp('duration', { inputMode: 'numeric', placeholder: '60' })}</Field>
        <Field label="Od">{inp('whFrom', { type: 'time' })}</Field>
        <Field label="Do">{inp('whTo', { type: 'time' })}</Field>
      </div>
      <div className="tp-days" role="group" aria-label="Dni pracy">
        {WEEKDAYS.map(([n, l]) => {
          const on = days.includes(n);
          return (
            <button key={n} type="button" className={`chip${on ? ' active' : ''}`} aria-pressed={on} onClick={() => set('whDays', (on ? days.filter((x) => x !== n) : [...days, n]).sort().join(','))}>
              {l}
            </button>
          );
        })}
        {draft.workHours && <span className="muted small">{workHoursLine(draft.workHours)}</span>}
      </div>

      <h4 className="form-section">Zdanie na tydzień</h4>
      <Field label="Dopisuje się do zapowiedzi tygodnia" wide>
        <textarea className="input" rows={2} maxLength={300} value={d.weeklyNote} onChange={(e) => set('weeklyNote', e.target.value)} placeholder="np. W tym tygodniu skupiamy się na technice przysiadu." />
      </Field>

      <h4 className="form-section">Urlop</h4>
      <p className="muted small">W tym czasie podopieczni widzą baner, automatyczne wiadomości są wstrzymane, a na wiadomość podopiecznego idzie automatyczna odpowiedź (raz dziennie).</p>
      <div className="form-grid">
        <Field label="Od">{inp('vacFrom', { type: 'date' })}</Field>
        <Field label="Do">{inp('vacTo', { type: 'date', min: d.vacFrom || undefined })}</Field>
        <Field label="Automatyczna odpowiedź" wide hint={draft.vacation ? `Podopieczny dostanie: „${vacationReplyText(draft)}”` : undefined}>
          <textarea className="input" rows={2} maxLength={500} value={d.vacMsg} onChange={(e) => set('vacMsg', e.target.value)} placeholder="np. Jestem na urlopie do 15.11 — odpiszę po powrocie. W pilnej sprawie: SMS." />
        </Field>
      </div>
      {(d.vacFrom || d.vacTo) && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => ['vacFrom', 'vacTo', 'vacMsg'].forEach((k) => set(k, ''))}>
          Usuń urlop
        </button>
      )}
      {problems.length > 0 && (
        <p className="small danger-text" role="alert">
          {problems[0]}
        </p>
      )}
    </Modal>
  );
}
