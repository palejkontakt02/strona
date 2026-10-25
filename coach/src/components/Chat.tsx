import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Client, CoachReply, MsgMedia, MsgRef, TrainingSession } from '../domain';
import { put } from '../data/db';
import { chatMediaUrl, deleteChatMedia, saveChatMedia } from '../data/chatMedia';
import { useStore } from '../data/store';
import { fmtDay, uid } from '../format';
import { todayISO } from '../lib/dates';
import { athleteUnread, byDay, chatThread, dayLabel, trainerUnread, type ChatMsg } from '../lib/comms';
import { fmtClock, mediaLabel, refText, splitStamps, videoOf } from '../lib/chat';
import { SessionSheet } from '../athlete/History';
import { Sheet } from './Sheet';
import { fitVideoFile, ShrinkSheet } from './SetVideo';
import { canRecordInApp, VideoRecorder } from './VideoRecorder';
import { canRecordVoice, useVoiceRecorder, VoicePlayer, type VoiceClip } from './VoiceNote';
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

/* ---------- załączniki ---------- */

/** Adres pliku z magazynu (link podpisany albo blob z IndexedDB). */
export function useMediaUrl(m: MsgMedia | undefined): { src: string | null; err: string } {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const ref = m?.ref;
  useEffect(() => {
    if (!m || !ref) return;
    let url = '';
    let live = true;
    setSrc(null);
    setErr('');
    chatMediaUrl(m)
      .then((u) => {
        url = u;
        if (live) setSrc(u);
      })
      .catch((e: Error) => live && setErr(e.message));
    return () => {
      live = false;
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);
  return { src, err };
}

/** Załącznik w dymku: zdjęcie (dotknij — pełny ekran), wideo z odtwarzaczem, wiadomość głosowa. */
export function MediaItem({ m, videoRef }: { m: MsgMedia; videoRef?: (el: HTMLVideoElement | null) => void }) {
  const { src, err } = useMediaUrl(m);
  const [big, setBig] = useState(false);
  if (err) return <p className="chat-media-err small">{mediaLabel(m.kind)} — nie da się wczytać ({err})</p>;
  if (m.kind === 'audio') return <VoicePlayer src={src} dur={m.dur} />;
  if (!src) return <div className={`chat-media chat-media-${m.kind} loading`} aria-label={`Wczytywanie: ${mediaLabel(m.kind).toLowerCase()}`} />;
  if (m.kind === 'video')
    return (
      <div className="chat-media chat-media-video">
        <video ref={videoRef} src={src} controls playsInline preload="metadata" />
      </div>
    );
  return (
    <>
      <button type="button" className="chat-media chat-media-image" aria-label="Powiększ zdjęcie" onClick={() => setBig(true)}>
        <img src={src} alt="Zdjęcie w rozmowie" loading="lazy" />
      </button>
      {big && (
        <Sheet label="Zdjęcie" onClose={() => setBig(false)}>
          <div className="between">
            <h3>Zdjęcie</h3>
            <button className="icon-btn" aria-label="Zamknij" onClick={() => setBig(false)}>
              <Icon name="x" />
            </button>
          </div>
          <img className="chat-photo-big" src={src} alt="Zdjęcie w rozmowie" />
        </Sheet>
      )}
    </>
  );
}

/** Tekst wiadomości; w odpowiedzi na nagranie znaczniki „0:07” są przyciskami przewijającymi wideo. */
export function MsgText({ text, onSeek }: { text: string; onSeek?: (t: number) => void }) {
  if (!onSeek) return <p className="pre">{text}</p>;
  return (
    <p className="pre">
      {splitStamps(text).map((p, i) =>
        't' in p ? (
          <button key={i} type="button" className="chat-stamp" onClick={() => onSeek(p.t)} aria-label={`Przewiń nagranie do ${p.text}`}>
            {p.text}
          </button>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </p>
  );
}

/** „Do: Trening 1 · Przysiad, 25 paź” — kontekst wiadomości. */
export function RefTag({ r, onOpen }: { r: MsgRef; onOpen?: () => void }) {
  const body = (
    <>
      <Icon name="dumbbell" size={14} /> <span>Do: {refText(r)}</span>
    </>
  );
  return onOpen ? (
    <button type="button" className="chat-ref" onClick={onOpen} title="Otwórz trening">
      {body}
    </button>
  ) : (
    <span className="chat-ref">{body}</span>
  );
}

/* ---------- załącznik w przygotowaniu (przed wysłaniem) ---------- */

export interface Draft {
  kind: MsgMedia['kind'];
  blob: Blob;
  url: string;
  dur?: number;
}

/** Wybór zdjęcia / filmu / nagrania wideo do wiadomości (+ przekodowanie za dużego filmu). */
export function useAttach(onPick: (d: Draft) => void) {
  const { ask } = useStore();
  const photo = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState(false);
  const [recording, setRecording] = useState(false);
  const [shrink, setShrink] = useState<number | null>(null);
  const pickVideo = async (f: File | undefined) => {
    if (video.current) video.current.value = '';
    if (!f) return;
    try {
      const file = await fitVideoFile(f, setShrink);
      const url = URL.createObjectURL(file);
      // długość do opisu (bez czekania, gdy przeglądarka nie poda)
      const dur = await new Promise<number | undefined>((res) => {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () => res(Number.isFinite(v.duration) ? v.duration : undefined);
        v.onerror = () => res(undefined);
        setTimeout(() => res(undefined), 3000);
        v.src = url;
      });
      onPick({ kind: 'video', blob: file, url, dur });
    } catch (e) {
      await ask((e as Error).message, { confirm: 'Rozumiem', danger: false });
    }
  };
  const ui = (
    <>
      <input ref={photo} type="file" accept="image/*" hidden onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) onPick({ kind: 'image', blob: f, url: URL.createObjectURL(f) });
        e.target.value = '';
      }} />
      <input ref={video} type="file" accept="video/*,video/quicktime,video/mp4,.mov,.mp4,.m4v" hidden onChange={(e) => void pickVideo(e.target.files?.[0])} />
      {menu && (
        <Sheet label="Dodaj załącznik" onClose={() => setMenu(false)}>
          <div className="between">
            <h3>Dodaj do wiadomości</h3>
            <button className="icon-btn" aria-label="Zamknij" onClick={() => setMenu(false)}>
              <Icon name="x" />
            </button>
          </div>
          <div className="attach-menu">
            <button className="btn btn-secondary btn-block" onClick={() => (setMenu(false), photo.current?.click())}>
              <Icon name="image" /> Zdjęcie
            </button>
            {canRecordInApp() && (
              <button className="btn btn-secondary btn-block" onClick={() => (setMenu(false), setRecording(true))}>
                <Icon name="cam" /> Nagraj wideo
              </button>
            )}
            <button className="btn btn-secondary btn-block" onClick={() => (setMenu(false), video.current?.click())}>
              <Icon name="play" /> Film z galerii
            </button>
          </div>
        </Sheet>
      )}
      {recording && (
        <VideoRecorder
          title="Nagranie do rozmowy"
          onClose={() => setRecording(false)}
          onDone={(f) => {
            setRecording(false);
            void pickVideo(f);
          }}
        />
      )}
      {shrink != null && <ShrinkSheet progress={shrink} />}
    </>
  );
  return { open: () => setMenu(true), recordVideo: () => (canRecordInApp() ? setRecording(true) : video.current?.click()), pickVideo: () => video.current?.click(), ui };
}

/** Podgląd załącznika przed wysłaniem. */
export function DraftPreview({ d, onRemove }: { d: Draft; onRemove: () => void }) {
  return (
    <div className="chat-draft">
      {d.kind === 'image' ? <img src={d.url} alt="Zdjęcie do wysłania" /> : d.kind === 'video' ? <video src={d.url} playsInline muted preload="metadata" /> : <VoicePlayer src={d.url} dur={d.dur} />}
      <span className="small muted grow">{d.kind === 'audio' ? '' : `${mediaLabel(d.kind)}${d.dur ? ` · ${fmtClock(d.dur)}` : ''}`}</span>
      <button type="button" className="icon-btn" aria-label="Usuń załącznik" onClick={onRemove}>
        <Icon name="trash" size={16} />
      </button>
    </div>
  );
}

/* ---------- wysyłka (wspólna: rozmowa i komentarz do treningu) ---------- */

/** Wysyła wiadomość: jako trener (odpowiedź w `replies`) albo jako podopieczny (funkcja w bazie + e-mail). */
export function useSendMessage(client: Client, asCoach: boolean) {
  const { apply, toast, sendClientMessage } = useStore();
  const first = client.name.split(' ')[0];
  return async (text: string, opts: { draft?: Draft | null; ref?: MsgRef; replyTo?: string; okMessage?: string } = {}): Promise<boolean> => {
    let body = text.trim().slice(0, 2000);
    let media: MsgMedia[] | undefined;
    if (opts.draft) {
      try {
        media = [await saveChatMedia(opts.draft.blob, opts.draft.kind, client.id, opts.draft.dur)];
      } catch (e) {
        toast(`Nie udało się wysłać załącznika (${(e as Error).message}).`);
        return false;
      }
    }
    if (!body && !media) return false;
    const textAuto = !body;
    if (!body) body = mediaLabel(media![0].kind);
    const ref = opts.ref && Object.keys(opts.ref).length ? opts.ref : undefined;
    if (asCoach) {
      const r: CoachReply = { id: uid(), at: new Date().toISOString(), text: body, ...(ref ? { ref } : {}), ...(media ? { media } : {}), ...(textAuto ? { textAuto } : {}), ...(opts.replyTo ? { replyTo: opts.replyTo } : {}) };
      const inbox = (client.inbox ?? []).map((n) => ({ ...n, read: true }));
      return apply([put('clients', { ...client, inbox, replies: [...(client.replies ?? []), r].slice(-200) })], opts.okMessage ?? `Wysłano — ${first} zobaczy wiadomość w aplikacji.`);
    }
    return sendClientMessage(client.id, body, { ...(ref ? { ref, sessionId: ref.sessionId } : {}), ...(media ? { media } : {}), ...(textAuto ? { textAuto } : {}) });
  };
}

/* ---------- rozmowa ---------- */

/**
 * Rozmowa podopieczny ↔ trener (dymki, dni, nowe wiadomości, pole na dole, zdjęcia / wideo / głos).
 * - `side="client"` — aplikacja podopiecznego (wiadomość idzie przez `sendClientMessage`, z e-mailem do trenera);
 *   `asTrainer` — podgląd trybu zawodnika: widok podopiecznego, ale piszesz jako trener.
 * - `side="coach"` — panel trenera: odpowiedź zapisuje się w `replies`, wiadomości podopiecznego oznacza jako przeczytane.
 * - `full` — rozmowa na całą wysokość (zakładka „Trener”): przewija się strona, pole wpisywania przyklejone na dole.
 */
export function Chat({ client, side, asTrainer, onOpenSession, full }: { client: Client; side: 'client' | 'coach'; asTrainer?: boolean; onOpenSession?: (sessionId: string) => void; full?: boolean }) {
  const { db, apply, ask, toast } = useStore();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [reply, setReply] = useState<ChatMsg | null>(null);
  const [shown, setShown] = useState<TrainingSession | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const videos = useRef(new Map<string, HTMLVideoElement>());
  const today = todayISO();
  const first = client.name.split(' ')[0];
  const coachView = side === 'coach';
  const writeAsCoach = coachView || !!asTrainer;
  const thread = chatThread(client);
  const unreadCoach = trainerUnread(client);
  const send = useSendMessage(client, writeAsCoach);
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
  // „Przeczytane” pod ostatnią wiadomością podopiecznego (trener ją otworzył)
  const lastClientMsg = [...thread].reverse().find((m) => m.from === 'client');
  const lastIsClient = thread[thread.length - 1]?.from === 'client';

  const setDraftSafe = (d: Draft | null) =>
    setDraft((cur) => {
      if (cur && cur.url !== d?.url) URL.revokeObjectURL(cur.url);
      return d;
    });
  useEffect(() => () => draft && URL.revokeObjectURL(draft.url), []); // eslint-disable-line react-hooks/exhaustive-deps
  const attach = useAttach((d) => setDraftSafe(d));
  const voice = useVoiceRecorder(
    (c: VoiceClip) => setDraftSafe({ kind: 'audio', blob: c.blob, url: c.url, dur: c.dur }),
    (m) => toast(m),
  );

  // przewiń do najnowszej: w oknie rozmowy, a na całej wysokości — stronę
  const last = thread[thread.length - 1]?.id;
  useLayoutEffect(() => {
    if (full) endRef.current?.scrollIntoView?.({ block: 'end' });
    else {
      const el = logRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [last, full]);

  // podopieczny: rozmowa na ekranie = odpowiedzi przeczytane
  const lastAt = thread[thread.length - 1]?.at ?? '';
  useEffect(() => {
    if (coachView || asTrainer || !lastAt) return;
    const el = endRef.current ?? logRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return markSeen(client.id, lastAt);
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && markSeen(client.id, lastAt), { threshold: 0.1 });
    io.observe(el);
    return () => io.disconnect();
  }, [client.id, lastAt, coachView, asTrainer]);

  // pole rośnie z tekstem (do ok. 6 linii)
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el || !full) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(160, el.scrollHeight + 2)}px`;
  }, [text, full]);

  const readAll = () => (client.inbox ?? []).map((n) => ({ ...n, read: true }));
  const submit = async () => {
    if (busy || (!text.trim() && !draft)) return;
    setBusy(true);
    const replyVideo = reply && videoOf(reply) ? reply.id : undefined;
    const ok = await send(text, {
      draft,
      ref: reply?.ref,
      replyTo: writeAsCoach && reply ? (replyVideo ?? reply.id) : undefined,
      okMessage: coachView ? 'Odpowiedź wysłana — podopieczny zobaczy ją w aplikacji.' : undefined,
    });
    if (ok) {
      setText('');
      setDraftSafe(null);
      setReply(null);
    }
    setBusy(false);
  };
  const remove = async (m: ChatMsg) => {
    if (!(await ask('Usunąć tę wiadomość z rozmowy?', { confirm: 'Usuń' }))) return;
    const fromCoach = m.from === 'coach';
    // wiadomość podopiecznego tylko ukrywamy (baza nie pozwala trenerowi nadpisać jego wiadomości)
    const ok = await apply(
      [put('clients', fromCoach ? { ...client, replies: (client.replies ?? []).filter((r) => r.id !== m.id) } : { ...client, inbox: (client.inbox ?? []).map((n) => (n.id === m.id ? { ...n, hidden: true, read: true } : n)) })],
      'Wiadomość usunięta.',
    );
    if (ok && fromCoach) m.media?.forEach((x) => void deleteChatMedia(x));
  };
  const openSession = (id: string) => {
    if (onOpenSession) return onOpenSession(id);
    const s = db.sessions.find((x) => x.id === id);
    if (s) setShown(s);
  };
  const seek = (msgId: string, t: number) => {
    const v = videos.current.get(msgId);
    if (!v) return;
    v.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    v.currentTime = t;
    void v.play().catch(() => undefined);
  };
  const insertTime = () => {
    const v = reply && videos.current.get(reply.id);
    if (!v) return;
    const stamp = `${fmtClock(v.currentTime)} — `;
    setText((t) => (t && !t.endsWith('\n') ? `${t}\n${stamp}` : `${t}${stamp}`));
    areaRef.current?.focus();
  };
  const mine = (from: 'client' | 'coach') => (coachView ? from === 'coach' : from === 'client');
  const who = (from: 'client' | 'coach') => (from === 'coach' ? (coachView || asTrainer ? 'Ty (trener)' : 'Trener') : coachView || asTrainer ? first : 'Ty');
  const byId = new Map(thread.map((m) => [m.id, m]));

  const recording = voice.state !== 'idle';
  const placeholder = coachView ? `Odpowiedz ${first}…` : asTrainer ? 'Twoja wiadomość (jako trener)…' : 'Twoja wiadomość…';

  return (
    <div className={`chat ${coachView ? 'chat-coach' : 'chat-athlete'}${full ? ' chat-full' : ''}`}>
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
            {coachView ? `Brak wiadomości. Napisz do ${first} — zobaczy wiadomość w swojej aplikacji.` : asTrainer ? `To podgląd — piszesz jako trener. ${first} zobaczy wiadomość w swojej aplikacji.` : 'Jak się czujesz, co bolało, pytanie o ćwiczenie — trener dostanie wiadomość także na e-mail. Możesz dołączyć zdjęcie, film albo nagrać wiadomość głosową.'}
          </p>
        ) : (
          byDay(thread).map((g) => (
            <div key={g.day} className="chat-group" role="list">
              <div className="chat-day" role="separator">
                <span>{dayLabel(g.day, today)}</span>
              </div>
              {g.msgs.map((m) => {
                const s = m.sessionId ? db.sessions.find((x) => x.id === m.sessionId) : undefined;
                const refSession = m.ref?.sessionId ? db.sessions.find((x) => x.id === m.ref!.sessionId) : undefined;
                const target = m.replyTo ? byId.get(m.replyTo) : undefined;
                const seekable = target && videoOf(target) ? (t: number) => seek(target.id, t) : undefined;
                const canReply = !mine(m.from) && (!!m.ref || !!videoOf(m));
                return (
                  <div key={m.id} role="listitem" className="chat-row-wrap">
                    {m.id === firstNew && (
                      <div className="chat-new" role="separator">
                        <span>Nowe</span>
                      </div>
                    )}
                    <div className={`chat-row ${mine(m.from) ? 'me' : 'them'} ${m.from === 'client' && !m.read && coachView ? 'unread' : ''}`}>
                      <div className={`chat-bubble${m.media?.length ? ' has-media' : ''}`}>
                        <span className="sr-only">{who(m.from)}: </span>
                        {m.ref && <RefTag r={m.ref} onOpen={refSession ? () => openSession(refSession.id) : undefined} />}
                        {target && !m.ref && <span className="chat-ref">Odpowiedź na: {target.textAuto ? mediaLabel(target.media?.[0]?.kind ?? 'image').toLowerCase() : `„${target.text.slice(0, 40)}${target.text.length > 40 ? '…' : ''}”`}</span>}
                        {m.media?.map((x, i) => (
                          <MediaItem key={i} m={x} videoRef={x.kind === 'video' ? (el) => (el ? videos.current.set(m.id, el) : videos.current.delete(m.id)) : undefined} />
                        ))}
                        {!m.textAuto && <MsgText text={m.text} onSeek={seekable} />}
                        {m.sessionId && !m.ref && (
                          <button type="button" className="chat-chip" disabled={!s} onClick={() => openSession(m.sessionId!)} title={s ? `${s.workoutName || 'Trening'} — otwórz` : 'Trening został usunięty'}>
                            <Icon name="play" size={12} /> {s ? `Trening ${fmtDay(s.date)}` : 'Trening (usunięty)'}
                          </button>
                        )}
                        <time className="chat-time" dateTime={m.at}>
                          {time(m.at)}
                        </time>
                      </div>
                      {canReply && (
                        <button type="button" className="chat-act" aria-label="Odpowiedz na tę wiadomość" title={videoOf(m) && writeAsCoach ? 'Odpowiedz — możesz wstawić czas z nagrania' : 'Odpowiedz'} onClick={() => (setReply(m), areaRef.current?.focus())}>
                          <Icon name="chat" size={14} />
                        </button>
                      )}
                      {coachView && (
                        <button type="button" className="chat-del" aria-label="Usuń wiadomość" title="Usuń wiadomość" onClick={() => void remove(m)}>
                          <Icon name="trash" size={14} />
                        </button>
                      )}
                    </div>
                    {!coachView && !asTrainer && lastIsClient && m.id === lastClientMsg?.id && m.read && <p className="chat-read">Przeczytane</p>}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
      <form
        className={`chat-compose chat-compose2${full ? ' sticky' : ''}`}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {reply && (
          <div className="chat-replying">
            <span className="grow small">
              {reply.ref ? <>Odpowiedź do: {refText(reply.ref)}</> : <>Odpowiedź na: {reply.textAuto ? mediaLabel(reply.media?.[0]?.kind ?? 'image').toLowerCase() : `„${reply.text.slice(0, 40)}”`}</>}
            </span>
            {writeAsCoach && videoOf(reply) && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={insertTime} title="Wstaw aktualny czas nagrania">
                <Icon name="timer" size={14} /> Wstaw czas
              </button>
            )}
            <button type="button" className="icon-btn" aria-label="Anuluj odpowiedź" onClick={() => setReply(null)}>
              <Icon name="x" size={16} />
            </button>
          </div>
        )}
        {draft && <DraftPreview d={draft} onRemove={() => setDraftSafe(null)} />}
        {recording ? (
          <div className="chat-recbar" role="status" aria-live="polite">
            <span className="rec-dot" aria-hidden="true" />
            <span className="grow">{voice.state === 'starting' ? 'Włączam mikrofon…' : `Nagrywanie ${fmtClock(voice.secs)}`}</span>
            <button type="button" className="btn btn-ghost" onClick={voice.cancel}>
              Anuluj
            </button>
            <button type="button" className="btn btn-primary" onClick={voice.stop} aria-label="Zakończ nagrywanie">
              <Icon name="stop" size={16} /> Stop
            </button>
          </div>
        ) : (
          <div className="chat-compose-row">
            <button type="button" className="chat-tool" aria-label="Dodaj zdjęcie lub film" title="Zdjęcie lub film" onClick={attach.open} disabled={busy}>
              <Icon name="clip" size={20} />
            </button>
            <textarea
              ref={areaRef}
              className="input"
              rows={full ? 1 : 2}
              maxLength={2000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder={draft ? 'Dodaj opis (opcjonalnie)…' : placeholder}
              aria-label={coachView ? 'Odpowiedź dla podopiecznego' : asTrainer ? 'Wiadomość od trenera' : 'Wiadomość do trenera'}
            />
            {!text.trim() && !draft && canRecordVoice() && (
              <button type="button" className="chat-tool chat-mic" aria-label="Nagraj wiadomość głosową" title="Naciśnij, aby nagrać (albo przytrzymaj)" {...voice.pressProps}>
                <Icon name="mic" size={20} />
              </button>
            )}
            <button type="submit" className="btn btn-primary" disabled={(!text.trim() && !draft) || busy}>
              {busy ? 'Wysyłam…' : coachView ? 'Wyślij odpowiedź' : 'Wyślij'}
            </button>
          </div>
        )}
      </form>
      {full && <div ref={endRef} className="chat-end" aria-hidden="true" />}
      {attach.ui}
      {shown && <SessionSheet plain s={shown} onClose={() => setShown(null)} />}
    </div>
  );
}

/** Pomocnicze: dymek w krótkim wątku (np. komentarze treningu). */
export function MiniThread({ client, msgs, coachView, children }: { client: Client; msgs: ChatMsg[]; coachView: boolean; children?: ReactNode }) {
  const videos = useRef(new Map<string, HTMLVideoElement>());
  const byId = new Map(msgs.map((m) => [m.id, m]));
  const first = client.name.split(' ')[0];
  const mine = (from: 'client' | 'coach') => (coachView ? from === 'coach' : from === 'client');
  return (
    <div className="chat chat-mini">
      <div className="chat-log" role="log" aria-label="Komentarze do treningu">
        {msgs.map((m) => {
          const target = m.replyTo ? byId.get(m.replyTo) : undefined;
          const seek = target && videoOf(target) ? (t: number) => {
            const v = videos.current.get(target.id);
            if (!v) return;
            v.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
            v.currentTime = t;
            void v.play().catch(() => undefined);
          } : undefined;
          return (
            <div key={m.id} className={`chat-row ${mine(m.from) ? 'me' : 'them'}`}>
              <div className="chat-bubble">
                <span className="chat-who small">{m.from === 'coach' ? (coachView ? 'Ty' : 'Trener') : coachView ? first : 'Ty'}{m.ref?.exName ? ` · ${m.ref.exName}` : ''}</span>
                {m.media?.map((x, i) => (
                  <MediaItem key={i} m={x} videoRef={x.kind === 'video' ? (el) => (el ? videos.current.set(m.id, el) : videos.current.delete(m.id)) : undefined} />
                ))}
                {!m.textAuto && <MsgText text={m.text} onSeek={seek} />}
                <time className="chat-time" dateTime={m.at}>
                  {m.at ? new Date(m.at).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                </time>
              </div>
            </div>
          );
        })}
      </div>
      {children}
    </div>
  );
}
