import { useEffect, useMemo, useState } from 'react';
import type { Client } from '../domain';
import { put } from '../data/db';
import { accountKnown, refreshAccounts, useAccounts } from '../data/accounts';
import { clientById, plansOf, sessionsOf } from '../data/ops';
import { useStore } from '../data/store';
import { fmtDay } from '../format';
import { encodeQr, qrSvgPath } from '../lib/qr';
import {
  INVITE_LABEL,
  inviteLink,
  inviteState,
  inviteText,
  isEmail,
  mailHref,
  normalizePhone,
  onboardingComplete,
  onboardingSteps,
  smsHref,
  waHref,
  type InviteState,
  type Step,
  type StepId,
} from '../lib/onboarding';
import { useNav } from '../nav';
import { trainerNotesOf } from '../views/client/Health';
import { Icon, Modal, Tag } from './ui';

/* Po dodaniu podopiecznego: Przegląd otwiera od razu okno zaproszenia. */
let pendingInvite: string | null = null;
export const requestInvite = (clientId: string) => {
  pendingInvite = clientId;
};

/** Stan zaproszenia i konta podopiecznego (karta, lista, checklista). */
export function useInviteState(client: Client): InviteState {
  const { cloud } = useStore();
  const accounts = useAccounts(cloud);
  return inviteState(client, accountKnown(client, accounts));
}

const TONE: Record<InviteState, 'ok' | 'warn' | 'neutral' | 'muted'> = { connected: 'ok', unconfirmed: 'warn', invited: 'neutral', 'not-invited': 'muted' };

/** Znacznik: połączył konto / e-mail niepotwierdzony / zaproszony (data) / nie zaproszony. */
export function InviteStatusTag({ client, state }: { client: Client; state: InviteState }) {
  const label = state === 'invited' && client.invitedAt ? `zaproszony ${fmtDay(client.invitedAt.slice(0, 10))}` : INVITE_LABEL[state];
  return (
    <span className={`invite-tag invite-${state}`}>
      <Tag tone={TONE[state]}>
        {state === 'connected' && <Icon name="check" size={12} />} {label}
      </Tag>
    </span>
  );
}

/** Przycisk „Zaproś do aplikacji” z oknem zaproszenia. */
export function InviteButton({ client, className = 'btn btn-secondary btn-sm' }: { client: Client; className?: string }) {
  const [open, setOpen] = useState(false);
  const state = useInviteState(client);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <Icon name="link" size={16} /> {state === 'not-invited' ? 'Zaproś do aplikacji' : 'Zaproś ponownie'}
      </button>
      {open && <InviteModal clientId={client.id} onClose={() => setOpen(false)} />}
    </>
  );
}

function QrSvg({ text }: { text: string }) {
  const qr = useMemo(() => {
    try {
      return encodeQr(text, { ecc: 'M' });
    } catch {
      return null;
    }
  }, [text]);
  if (!qr) return null;
  const n = qr.size + 8;
  return (
    <svg className="qr-svg" viewBox={`0 0 ${n} ${n}`} role="img" aria-label="Kod QR z linkiem zaproszenia" shapeRendering="crispEdges">
      <rect className="qr-bg" width={n} height={n} />
      <path className="qr-fg" d={qrSvgPath(qr)} />
    </svg>
  );
}

/** Okno zaproszenia: link (z e-mailem do wpisania na ekranie logowania), kod QR, kopiuj, SMS, WhatsApp, e-mail. */
export function InviteModal({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const { db, apply, toast } = useStore();
  const client = clientById(db, clientId);
  const [email, setEmail] = useState(client?.email ?? '');
  const [showQr, setShowQr] = useState(false);
  if (!client) return null;
  const hasEmail = isEmail(client.email);
  const link = inviteLink(hasEmail ? client.email : undefined);
  const text = inviteText(client);
  const phone = normalizePhone(client.phone);

  const markSent = async (how: string) => {
    await apply([put('clients', { ...client, invitedAt: new Date().toISOString() })], `Zaproszenie ${how} — zapisano datę wysłania.`);
  };
  const saveEmail = async () => {
    const e = email.trim().toLowerCase();
    if (!isEmail(e)) return toast('Sprawdź adres e-mail (np. anna@gmail.com).');
    if (db.clients.some((c) => c.id !== client.id && c.email?.trim().toLowerCase() === e)) return toast('Ten e-mail ma już inny podopieczny — jedno konto łączy się z jednym profilem.');
    await apply([put('clients', { ...client, email: e })], 'Zapisano e-mail.');
  };
  const copy = async (what: 'link' | 'text') => {
    try {
      await navigator.clipboard.writeText(what === 'link' ? link : text);
      await markSent(what === 'link' ? 'skopiowane' : 'skopiowane');
    } catch {
      toast('Nie udało się skopiować — zaznacz link i skopiuj ręcznie.');
    }
  };

  return (
    <Modal title="Zaproś do aplikacji" onClose={onClose}>
      <div className="invite">
        <p className="muted small invite-who">
          {client.name}
          {client.invitedAt && ` · ostatnio wysłane ${fmtDay(client.invitedAt.slice(0, 10))}`}
        </p>
        {!hasEmail && (
          <div className="invite-warn" role="alert">
            <p>
              <Icon name="alert" size={16} /> <strong>Brak e-maila w profilu.</strong> Bez niego podopieczny nie połączy konta — aplikacja łączy konto z profilem po adresie e-mail.
            </p>
            <div className="invite-email-row">
              <input
                className="input"
                type="email"
                inputMode="email"
                autoComplete="off"
                aria-label="E-mail podopiecznego"
                placeholder="np. anna@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void saveEmail();
                  }
                }}
              />
              <button type="button" className="btn btn-primary" onClick={() => void saveEmail()}>
                Zapisz e-mail
              </button>
            </div>
          </div>
        )}
        <div className="invite-link">
          <span className="eyebrow">Link</span>
          <code className="invite-url">{link}</code>
          <p className="muted small">
            {hasEmail ? `Po otwarciu linku ekran „Nowe konto” ma już wpisany adres ${client.email!.trim().toLowerCase()}.` : 'Po wpisaniu e-maila link sam go uzupełni na ekranie logowania.'}
          </p>
        </div>
        <div className="invite-actions">
          <button type="button" className="btn btn-secondary" onClick={() => void copy('link')}>
            <Icon name="copy" size={16} /> Kopiuj link
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void copy('text')}>
            <Icon name="clipboard" size={16} /> Kopiuj treść
          </button>
          <a className="btn btn-secondary" href={smsHref(text, phone)} onClick={() => void markSent('wysłane SMS-em')}>
            <Icon name="chat" size={16} /> Wyślij SMS
          </a>
          <a className="btn btn-secondary" href={waHref(text, phone)} target="_blank" rel="noreferrer" onClick={() => void markSent('wysłane przez WhatsApp')}>
            <Icon name="chat" size={16} /> Wyślij WhatsApp
          </a>
          <a className="btn btn-secondary" href={mailHref(text, hasEmail ? client.email : undefined)} onClick={() => void markSent('wysłane e-mailem')}>
            <Icon name="mail" size={16} /> Wyślij e-mail
          </a>
          <button type="button" className="btn btn-ghost" aria-expanded={showQr} onClick={() => setShowQr((v) => !v)}>
            {showQr ? 'Ukryj kod QR' : 'Pokaż kod QR'}
          </button>
        </div>
        {showQr && (
          <div className="invite-qr">
            <QrSvg text={link} />
            <p className="muted small">Podopieczny skanuje aparatem telefonu — otworzy się ekran zakładania konta.</p>
          </div>
        )}
        <details className="invite-preview">
          <summary>Treść zaproszenia</summary>
          <pre>{text}</pre>
        </details>
        {!client.invitedAt && (
          <button type="button" className="link small" onClick={() => void markSent('oznaczone jako wysłane')}>
            Wysłałem inaczej — oznacz jako wysłane
          </button>
        )}
      </div>
    </Modal>
  );
}

const ACTION: Record<StepId, string> = {
  contact: 'Uzupełnij',
  invite: 'Zaproś',
  account: 'Wyślij ponownie',
  intake: 'Wywiad',
  plan: 'Przypisz plan',
  billing: 'Dodaj pakiet',
  visit: 'Umów wizytę',
};

/** Checklista „Pierwsze kroki” na górze Przeglądu — dopóki nie jest ukończona albo trener jej nie ukryje. */
export function OnboardingChecklist({ client }: { client: Client }) {
  const { db, cloud, apply } = useStore();
  const { setClientTab, openModal } = useNav();
  const accounts = useAccounts(cloud);
  const [invite, setInvite] = useState(false);
  useEffect(() => {
    if (pendingInvite === client.id) {
      pendingInvite = null;
      setInvite(true);
    }
  }, [client.id]);

  const h = trainerNotesOf(db.trainer_notes, client.id).health;
  const steps = onboardingSteps({
    client,
    account: accountKnown(client, accounts),
    plans: plansOf(db, client.id).length,
    healthDone: !!(h?.updated || (h?.parq && Object.keys(h.parq).length)),
    appointments: db.appointments.filter((a) => a.clientId === client.id && a.status !== 'cancel').length,
    sessions: sessionsOf(db, client.id).length,
  });
  const modal = invite && <InviteModal clientId={client.id} onClose={() => setInvite(false)} />;
  if (client.onboardingHidden || onboardingComplete(steps)) return modal || null;
  const doneN = steps.filter((s) => s.done).length;
  const nextId = steps.find((s) => !s.done)?.id;

  const run = (s: Step) => {
    switch (s.id) {
      case 'contact':
        return setClientTab('Profil');
      case 'invite':
        return setInvite(true);
      case 'account':
        if (cloud) void refreshAccounts();
        return setInvite(true);
      case 'intake':
        return setClientTab('Profil');
      case 'plan':
        return setClientTab('Plan');
      case 'billing':
        return openModal({ kind: 'payment', clientId: client.id, type: client.billing === 'abonament' ? 'abonament' : client.billing === 'pojedyncza' ? 'pojedyncza' : 'pakiet' });
      case 'visit':
        return openModal({ kind: 'appt', clientId: client.id });
    }
  };

  return (
    <section className="card onb" aria-label="Pierwsze kroki">
      <div className="onb-head">
        <div>
          <h4>Pierwsze kroki</h4>
          <p className="muted small">
            {doneN} z {steps.length} zrobione · stan liczy się sam z danych
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void apply([put('clients', { ...client, onboardingHidden: true })], 'Ukryto „Pierwsze kroki”.')}>
          Ukryj
        </button>
      </div>
      <div className="onb-bar" aria-hidden="true">
        <i style={{ width: `${(doneN / steps.length) * 100}%` }} />
      </div>
      <ol className="onb-steps">
        {steps.map((s, i) => (
          <li key={s.id} className={`onb-step ${s.done ? 'is-done' : ''} ${s.id === nextId ? 'is-next' : ''}`}>
            <span className="onb-mark" aria-hidden="true">
              {s.done ? <Icon name="check" size={16} /> : i + 1}
            </span>
            <div className="onb-text">
              <strong>{s.label}</strong>
              <span className="muted small">{s.note}</span>
            </div>
            {s.done ? (
              <span className="onb-sr">zrobione</span>
            ) : (
              <button type="button" className={`btn btn-sm ${s.id === nextId ? 'btn-primary' : 'btn-secondary'}`} onClick={() => run(s)}>
                {ACTION[s.id]}
              </button>
            )}
          </li>
        ))}
      </ol>
      {modal}
    </section>
  );
}
