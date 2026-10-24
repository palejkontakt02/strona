import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Client, CoachReply, TrainingSession } from '../domain';
import { put } from '../data/db';
import { useStore } from '../data/store';
import { fmtDay, uid } from '../format';
import { todayISO } from '../lib/dates';
import { athleteUnread, byDay, chatThread, dayLabel, trainerUnread } from '../lib/comms';
import { SessionSheet } from '../athlete/History';
import { Icon } from './ui';

/* ---------- „przeczytane” po stronie podopiecznego (na tym urządzeniu) ---------- */

const SEEN_KEY = (id: string) => `fitowa-chat-seen:${id}`;
const SEEN_EVT = 'fitowa-chat-seen';

function readSeen(clientId: string): string {
  try {
    return localStorage.getItem(SEEN_KEY(clientId)) ?? '';
  } catch {
    return '';
  }
}

function markSeen(clientId: string, at: string) {
  try {
    if (at <= readSeen(clientId)) return;
    localStorage.setItem(SEEN_KEY(clientId), at);
  } catch {
    return;
  }
  window.dispatchEvent(new Event(SEEN_EVT));
}

/** Liczba nowych odpowiedzi trenera dla podopiecznego (odświeża się po otwarciu rozmowy). */
export function useAthleteUnread(client: Client): number {
  const [seen, setSeen] = useState(() => readSeen(client.id));
  useEffect(() => {
    const on = () => setSeen(readSeen(client.id));
    window.addEventListener(SEEN_EVT, on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener(SEEN_EVT, on);
      window.removeEventListener('storage', on);
    };
  }, [client.id]);
  return athleteUnread(client, seen);
}

const time = (at: string) => (at ? new Date(at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '');

/**
 * Rozmowa podopieczny ↔ trener (dymki, dni, nowe wiadomości, pole na dole).
 * - `side="client"` — aplikacja podopiecznego (wiadomość idzie przez `sendClientNote`, z e-mailem do trenera);
 *   `asTrainer` — podgląd trybu zawodnika: widok podopiecznego, ale piszesz jako trener.
 * - `side="coach"` — panel trenera: odpowiedź zapisuje się w `replies`, wiadomości podopiecznego oznacza jako przeczytane.
 */
export function Chat({ client, side, asTrainer, onOpenSession }: { client: Client; side: 'client' | 'coach'; asTrainer?: boolean; onOpenSession?: (sessionId: string) => void }) {
  const { db, apply, ask, sendClientNote } = useStore();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<TrainingSession | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const today = todayISO();
  const first = client.name.split(' ')[0];
  const coachView = side === 'coach';
  const writeAsCoach = coachView || !!asTrainer;
  const thread = chatThread(client);
  const unreadCoach = trainerUnread(client);
  // znacznik „Nowe” liczony przy otwarciu (nie znika, gdy rozmowa oznaczy się jako przeczytana)
  const [since] = useState(() => readSeen(client.id));
  const firstNew = coachView
    ? thread.find((m) => m.from === 'client' && !m.read)?.id
    : !asTrainer
      ? (() => {
          const lastMine = thread.filter((m) => m.from === 'client').reduce((a, m) => (m.at > a ? m.at : a), '');
          const s = since > lastMine ? since : lastMine;
          return thread.find((m) => m.from === 'coach' && m.at > s)?.id;
        })()
      : undefined;

  // przewiń do najnowszej (w obrębie okna rozmowy, nie całej strony)
  const last = thread[thread.length - 1]?.id;
  useLayoutEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [last]);

  // podopieczny: rozmowa na ekranie = odpowiedzi przeczytane
  const lastAt = thread[thread.length - 1]?.at ?? '';
  useEffect(() => {
    if (coachView || asTrainer || !lastAt) return;
    const el = logRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return markSeen(client.id, lastAt);
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && markSeen(client.id, lastAt), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, [client.id, lastAt, coachView, asTrainer]);

  const readAll = () => (client.inbox ?? []).map((n) => ({ ...n, read: true }));
  const send = async () => {
    const body = text.trim().slice(0, 2000);
    if (!body) return;
    setBusy(true);
    let ok: boolean;
    if (writeAsCoach) {
      const r: CoachReply = { id: uid(), at: new Date().toISOString(), text: body };
      ok = await apply([put('clients', { ...client, inbox: readAll(), replies: [...(client.replies ?? []), r].slice(-200) })], coachView ? 'Odpowiedź wysłana — podopieczny zobaczy ją w aplikacji.' : `Wysłano — ${first} zobaczy wiadomość w aplikacji.`);
    } else ok = await sendClientNote(client.id, body);
    if (ok) setText('');
    setBusy(false);
  };
  const remove = async (id: string, fromCoach: boolean) => {
    if (!(await ask('Usunąć tę wiadomość z rozmowy?', { confirm: 'Usuń' }))) return;
    // wiadomość podopiecznego tylko ukrywamy (baza nie pozwala trenerowi nadpisać jego wiadomości)
    await apply(
      [put('clients', fromCoach ? { ...client, replies: (client.replies ?? []).filter((r) => r.id !== id) } : { ...client, inbox: (client.inbox ?? []).map((n) => (n.id === id ? { ...n, hidden: true, read: true } : n)) })],
      'Wiadomość usunięta.',
    );
  };
  const openSession = (id: string) => {
    if (onOpenSession) return onOpenSession(id);
    const s = db.sessions.find((x) => x.id === id);
    if (s) setShown(s);
  };
  const mine = (from: 'client' | 'coach') => (coachView ? from === 'coach' : from === 'client');
  const who = (from: 'client' | 'coach') => (from === 'coach' ? (coachView || asTrainer ? 'Ty (trener)' : 'Trener') : coachView || asTrainer ? first : 'Ty');

  return (
    <div className={`chat ${coachView ? 'chat-coach' : 'chat-athlete'}`}>
      {coachView && unreadCoach > 0 && (
        <div className="chat-bar">
          <button className="btn btn-ghost btn-sm" onClick={() => void apply([put('clients', { ...client, inbox: readAll() })])}>
            Oznacz przeczytane
          </button>
        </div>
      )}
      <div className="chat-log" ref={logRef} role="log" aria-label={coachView ? `Rozmowa z ${first}` : 'Rozmowa z trenerem'} tabIndex={0}>
        {thread.length === 0 ? (
          <p className="chat-empty muted small">
            {coachView ? `Brak wiadomości. Napisz do ${first} — zobaczy wiadomość w swojej aplikacji.` : asTrainer ? `To podgląd — piszesz jako trener. ${first} zobaczy wiadomość w swojej aplikacji.` : 'Jak się czujesz, co bolało, pytanie o ćwiczenie — trener dostanie wiadomość także na e-mail.'}
          </p>
        ) : (
          byDay(thread).map((g) => (
            <div key={g.day} className="chat-group" role="list">
              <div className="chat-day" role="separator">
                <span>{dayLabel(g.day, today)}</span>
              </div>
              {g.msgs.map((m) => {
                const s = m.sessionId ? db.sessions.find((x) => x.id === m.sessionId) : undefined;
                return (
                  <div key={m.id} role="listitem" className="chat-row-wrap">
                    {m.id === firstNew && (
                      <div className="chat-new" role="separator">
                        <span>Nowe</span>
                      </div>
                    )}
                    <div className={`chat-row ${mine(m.from) ? 'me' : 'them'} ${m.from === 'client' && !m.read && coachView ? 'unread' : ''}`}>
                      <div className="chat-bubble">
                        <span className="sr-only">{who(m.from)}: </span>
                        <p className="pre">{m.text}</p>
                        {m.sessionId && (
                          <button type="button" className="chat-chip" disabled={!s} onClick={() => openSession(m.sessionId!)} title={s ? `${s.workoutName || 'Trening'} — otwórz` : 'Trening został usunięty'}>
                            <Icon name="play" size={12} /> {s ? `Trening ${fmtDay(s.date)}` : 'Trening (usunięty)'}
                          </button>
                        )}
                        <time className="chat-time" dateTime={m.at}>
                          {time(m.at)}
                        </time>
                      </div>
                      {coachView && (
                        <button type="button" className="chat-del" aria-label="Usuń wiadomość" title="Usuń wiadomość" onClick={() => void remove(m.id, m.from === 'coach')}>
                          <Icon name="trash" size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
      <form
        className="chat-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          className="input"
          rows={2}
          maxLength={2000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={coachView ? `Odpowiedz ${first}…` : asTrainer ? 'Twoja wiadomość (jako trener)…' : 'Twoja wiadomość…'}
          aria-label={coachView ? 'Odpowiedź dla podopiecznego' : asTrainer ? 'Wiadomość od trenera' : 'Wiadomość do trenera'}
        />
        <button type="submit" className="btn btn-primary" disabled={!text.trim() || busy}>
          {busy ? 'Wysyłam…' : coachView ? 'Wyślij odpowiedź' : 'Wyślij'}
        </button>
      </form>
      {shown && <SessionSheet plain s={shown} onClose={() => setShown(null)} />}
    </div>
  );
}
