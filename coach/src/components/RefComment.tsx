import { useEffect, useRef, useState } from 'react';
import type { MsgRef } from '../domain';
import { useStore } from '../data/store';
import { fmtClock, refFor, refText, threadForSession, videoOf } from '../lib/chat';
import { todayISO } from '../lib/dates';
import { DraftPreview, MiniThread, RefTag, useAttach, useSendMessage, type Draft } from './Chat';
import { Sheet } from './Sheet';
import { Icon } from './ui';

/**
 * Komentarz przypięty do treningu albo ćwiczenia: mały przycisk otwierający arkusz z wiadomością do trenera
 * (np. „bolało przy 3. serii”) i opcjonalnym nagraniem techniki do oceny. Wiadomość trafia do zwykłej rozmowy
 * z kontekstem `ref` (trening, ćwiczenie, data) i jest tam pokazana jako „Do: Trening 1 · Przysiad, 25 paź”.
 *
 * `label`: przy ćwiczeniu (`exIndex`) — nazwa ćwiczenia (gdy trening jeszcze nie jest zapisany); bez `exIndex` —
 * napis na przycisku (np. „Komentarz do treningu”).
 */
export function RefComment({ clientId, sessionId, exIndex, label }: { clientId: string; sessionId?: string; exIndex?: number; label?: string }) {
  const { db } = useStore();
  const [open, setOpen] = useState(false);
  const client = db.clients.find((c) => c.id === clientId);
  if (!client) return null;
  const forEx = exIndex != null;
  const session = sessionId ? db.sessions.find((s) => s.id === sessionId) : undefined;
  const exName = forEx ? session?.exercises[exIndex]?.name || label : undefined;
  const n = sessionId ? threadForSession(client, sessionId).filter((m) => !forEx || m.ref?.exIndex === exIndex).length : 0;
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm ref-btn" onClick={() => setOpen(true)} aria-label={forEx ? `Komentarz: ${exName ?? 'ćwiczenie'}` : undefined}>
        <Icon name="chat" size={16} /> {forEx ? 'Komentarz' : label || 'Komentarz'}
        {n > 0 && <span className="ref-count">{n}</span>}
      </button>
      {open && <RefCommentSheet clientId={clientId} sessionId={sessionId} exIndex={exIndex} label={label} onClose={() => setOpen(false)} />}
    </>
  );
}

function RefCommentSheet({ clientId, sessionId, exIndex, label, onClose }: { clientId: string; sessionId?: string; exIndex?: number; label?: string; onClose: () => void }) {
  const { db } = useStore();
  const client = db.clients.find((c) => c.id === clientId)!;
  const session = sessionId ? db.sessions.find((s) => s.id === sessionId) : undefined;
  const forEx = exIndex != null;
  const ref: MsgRef = {
    ...refFor(session, exIndex, { label: forEx ? label : undefined, date: todayISO() }),
    ...(sessionId ? { sessionId } : {}),
  };
  const send = useSendMessage(client, false);
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const attach = useAttach((d) => setDraft((cur) => (cur && URL.revokeObjectURL(cur.url), d)));
  useEffect(() => () => void (draft && URL.revokeObjectURL(draft.url)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const earlier = sessionId ? threadForSession(client, sessionId).filter((m) => !forEx || m.ref?.exIndex === exIndex || m.replyTo) : [];
  const title = forEx ? `Komentarz: ${ref.exName ?? 'ćwiczenie'}` : 'Komentarz do treningu';
  const submit = async () => {
    if (busy || (!text.trim() && !draft)) return;
    setBusy(true);
    const ok = await send(text, { draft, ref });
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Sheet label={title} onClose={onClose}>
      <div className="between">
        <h3>{title}</h3>
        <button className="icon-btn" aria-label="Zamknij" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      {(ref.workout || ref.exName || ref.date) && <RefTag r={ref} />}
      {earlier.length > 0 && <MiniThread client={client} msgs={earlier} coachView={false} />}
      <form
        className="ref-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <textarea
          className="input"
          rows={3}
          maxLength={2000}
          value={text}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          placeholder={forEx ? 'Np. bolało przy 3. serii, nie czuję pośladków…' : 'Jak poszło? Co bolało, co było za ciężkie?'}
          aria-label="Komentarz dla trenera"
        />
        {draft ? (
          <DraftPreview d={draft} onRemove={() => setDraft((cur) => (cur && URL.revokeObjectURL(cur.url), null))} />
        ) : (
          <div className="ref-attach">
            <button type="button" className="btn btn-secondary" onClick={attach.recordVideo}>
              <Icon name="cam" size={16} /> Dołącz nagranie
            </button>
            <button type="button" className="btn btn-ghost" onClick={attach.pickVideo}>
              Z galerii
            </button>
          </div>
        )}
        <p className="muted small">{draft ? 'Trener obejrzy nagranie i odpowie w rozmowie — może wskazać konkretny moment filmu.' : 'Wiadomość trafi do rozmowy z trenerem z informacją, którego treningu dotyczy.'}</p>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || (!text.trim() && !draft)}>
          {busy ? 'Wysyłam…' : draft ? 'Wyślij do oceny' : 'Wyślij komentarz'}
        </button>
      </form>
      {attach.ui}
    </Sheet>
  );
}

/**
 * Komentarze tego treningu (z rozmowy) — w historii podopiecznego i u trenera w widoku sesji.
 * Trener (`side="coach"`, domyślnie) odpowiada od razu tutaj: odpowiedź idzie do rozmowy z tym samym kontekstem,
 * a przy nagraniu może wstawić aktualny czas filmu („0:07 — kolana do środka”).
 */
export function RefThread({ clientId, sessionId, side = 'coach' }: { clientId: string; sessionId: string; side?: 'client' | 'coach' }) {
  const { db } = useStore();
  const client = db.clients.find((c) => c.id === clientId);
  const coach = side === 'coach';
  const send = useSendMessage(client ?? ({ id: clientId, name: '' } as never), true);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  if (!client) return null;
  const msgs = threadForSession(client, sessionId);
  if (!msgs.length) return null;
  const lastClient = [...msgs].reverse().find((m) => m.from === 'client');
  const target = [...msgs].reverse().find((m) => m.from === 'client' && videoOf(m)) ?? lastClient;
  const submit = async () => {
    if (busy || !text.trim()) return;
    setBusy(true);
    const ok = await send(text, { ref: target?.ref ?? { sessionId }, replyTo: target?.id, okMessage: 'Odpowiedź wysłana — podopieczny zobaczy ją w rozmowie.' });
    setBusy(false);
    if (ok) setText('');
  };
  const insertTime = () => {
    const v = wrap.current?.querySelector<HTMLVideoElement>('.chat-media-video video');
    if (!v) return;
    const stamp = `${fmtClock(v.currentTime)} — `;
    setText((t) => (t && !t.endsWith('\n') ? `${t}\n${stamp}` : `${t}${stamp}`));
  };
  return (
    <section className="ref-thread" ref={wrap}>
      <span className="eyebrow">Komentarze do treningu</span>
      <MiniThread client={client} msgs={msgs} coachView={coach}>
        {coach && target && (
          <form
            className="ref-reply"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <textarea className="input" rows={2} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder={videoOf(target) ? 'Np. 0:07 — kolana do środka' : 'Odpowiedz…'} aria-label="Odpowiedź na komentarz" />
            <div className="ref-reply-actions">
              {videoOf(target) && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={insertTime} title="Wstaw aktualny czas nagrania">
                  <Icon name="timer" size={14} /> Wstaw czas
                </button>
              )}
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !text.trim()}>
                {busy ? 'Wysyłam…' : 'Odpowiedz'}
              </button>
            </div>
            {target.ref && (
              <p className="muted small">
                Do: {refText(target.ref)}
              </p>
            )}
          </form>
        )}
      </MiniThread>
    </section>
  );
}
