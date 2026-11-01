import { useEffect, useState } from 'react';
import { fileUrl } from '../data/files';
import { useTrainerProfile, type TrainerProfile } from '../data/trainerProfile';
import { Icon } from '../components/ui';
import { todayISO } from '../lib/dates';

const dm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

/** „SP” z „Sebastian Palej”. */
export function initials(name?: string): string {
  const p = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

/** Zdjęcie trenera albo inicjały (bez ikony osoby). Bez imienia i zdjęcia — nic. */
export function TrainerAvatar({ profile, size = 28 }: { profile: TrainerProfile; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    setUrl(null);
    if (profile.photo) fileUrl(profile.photo).then((u) => !off && setUrl(u)).catch(() => undefined);
    return () => {
      off = true;
    };
  }, [profile.photo]);
  const ini = initials(profile.name);
  if (!url && !ini) return null;
  return (
    <span className="r7-av" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden>
      {url ? <img src={url} alt="" onError={() => setUrl(null)} /> : ini}
    </span>
  );
}

/** Urlop trenera: trwa (dziś w środku) albo zaczyna się w ciągu 7 dni. */
export function vacationState(v: TrainerProfile['vacation'], today = todayISO()): { now: boolean; text: string } | null {
  if (!v?.from || !v.to || v.to < v.from || v.to < today) return null;
  const msg = v.message?.trim();
  if (v.from <= today) return { now: true, text: `Trener na urlopie do ${dm(v.to)}${msg ? ` — ${msg}` : ''}` };
  const in7 = new Date(Date.parse(today) + 7 * 86_400_000).toISOString().slice(0, 10);
  if (v.from <= in7) return { now: false, text: `Trener będzie na urlopie ${dm(v.from)}–${dm(v.to)}${msg ? ` — ${msg}` : ''}` };
  return null;
}

export function VacationBanner({ profile }: { profile: TrainerProfile }) {
  const st = vacationState(profile.vacation);
  if (!st) return null;
  return (
    <div className={`r7-vac ${st.now ? 'now' : ''}`} role="status">
      <Icon name="cal" size={18} />
      <span>{st.text}</span>
    </div>
  );
}

/** Lewa strona górnego paska: zdjęcie / inicjały i imię trenera (bez imienia — „Twój trener”). */
export function TrainerTop() {
  const { profile } = useTrainerProfile();
  return (
    <span className="ath-coach">
      <TrainerAvatar profile={profile} />
      {profile.name?.trim() || 'Twój trener'}
    </span>
  );
}

/** Karta trenera w zakładce Trener: zdjęcie, imię, telefon, godziny odpowiedzi. */
export function TrainerCard() {
  const { profile } = useTrainerProfile();
  if (!profile.name && !profile.phone && !profile.replyHours) return null;
  const tel = profile.phone?.replace(/[^\d+]/g, '');
  return (
    <section className="acard r7-coach-card" aria-label="Twój trener">
      <TrainerAvatar profile={profile} size={48} />
      <div className="grow">
        <b>{profile.name?.trim() || 'Twój trener'}</b>
        {profile.phone && <span className="small">{profile.phone}</span>}
        {profile.replyHours && <span className="muted small">{profile.replyHours}</span>}
      </div>
      {tel && (
        <a className="btn btn-secondary btn-sm" href={`tel:${tel}`} aria-label={`Zadzwoń: ${profile.phone}`}>
          Zadzwoń
        </a>
      )}
    </section>
  );
}
