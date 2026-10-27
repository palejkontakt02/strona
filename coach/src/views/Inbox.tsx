import { useMemo, useState } from 'react';
import type { Client, CoachReply, WeeklyReport } from '../domain';
import { Chat } from '../components/Chat';
import { BarChart, LineChart } from '../components/charts';
import { Avatar, Empty, Icon, Tag, type Tone } from '../components/ui';
import { put } from '../data/db';
import { useStore } from '../data/store';
import { fmtDay, plural, uid } from '../format';
import { mediaLabel, refFor } from '../lib/chat';
import { chatThread, dayLabel, msgDay, trainerUnread, weekLabel, type ChatMsg } from '../lib/comms';
import { todayISO } from '../lib/dates';
import { REVIEW_LABEL, reviewContext, reviewQueue, withReviewed, type ReviewItem, type ReviewKind } from '../lib/reviewQueue';
import { useNav } from '../nav';

/* Skrzynka trenera: rozmowy pogrupowane po podopiecznym + kolejka „Do przejrzenia”. */

const TABS = ['Rozmowy', 'Do przejrzenia'] as const;
type InboxTab = (typeof TABS)[number];

/** Przekazanie z Pulpitu: otwórz od razu rozmowę / zakładkę (sessionStorage, jednorazowo). */
const OPEN_KEY = 'inbox-open';
const TAB_KEY = 'inbox-tab';
export function openInbox(go: (s: 'Wiadomości') => void, opts: { clientId?: string; tab?: InboxTab } = {}) {
  try {
    if (opts.clientId) sessionStorage.setItem(OPEN_KEY, opts.clientId);
    if (opts.tab) sessionStorage.setItem(TAB_KEY, opts.tab);
  } catch {
    /* bez sessionStorage — zwykłe przejście */
  }
  go('Wiadomości');
}
function take(key: string): string | null {
  try {
    const v = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    return v;
  } catch {
    return null;
  }
}

const clock = (at: string, today: string) => {
  if (!at) return '';
  const d = msgDay(at);
  return d === today ? new Date(at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : dayLabel(d, today);
};

export interface Convo {
  c: Client;
  last: ChatMsg;
  unread: number;
  /** Ostatnia wiadomość podopiecznego dotyczy treningu / ma nagranie. */
  workout: boolean;
  media?: 'video' | 'audio' | 'image';
}

export function conversations(clients: Client[]): Convo[] {
  return clients
    .map((c) => {
      const t = chatThread(c);
      if (!t.length) return null;
      const last = t[t.length - 1];
      const lastClient = [...t].reverse().find((m) => m.from === 'client');
      return {
        c,
        last,
        unread: trainerUnread(c),
        workout: !!(lastClient && (lastClient.ref?.sessionId || lastClient.sessionId)),
        media: lastClient?.media?.[0]?.kind,
      } as Convo;
    })
    .filter((x): x is Convo => !!x)
    .sort((a, b) => Number(b.unread > 0) - Number(a.unread > 0) || (b.last.at || '').localeCompare(a.last.at || ''));
}

export function Inbox() {
  const { db, apply, ask } = useStore();
  const { openClient, openModal } = useNav();
  const today = todayISO();
  const [tab, setTab] = useState<InboxTab>(() => (take(TAB_KEY) === 'Do przejrzenia' ? 'Do przejrzenia' : 'Rozmowy'));
  const [openId, setOpenId] = useState<string | null>(() => take(OPEN_KEY));
  const convos = useMemo(() => conversations(db.clients), [db.clients]);
  const queue = useMemo(() => reviewQueue(db.clients, db.sessions, today), [db.clients, db.sessions, today]);
  const unread = convos.reduce((a, x) => a + x.unread, 0);
  const open = db.clients.find((c) => c.id === openId);
  const without = db.clients.filter((c) => c.status === 'aktywny' && !convos.some((x) => x.c.id === c.id)).sort((a, b) => a.name.localeCompare(b.name, 'pl'));

  const readAll = async () => {
    const who = db.clients.filter((c) => trainerUnread(c) > 0);
    if (!who.length) return;
    const ok = await ask(`Oznaczyć ${unread} ${plural(unread, 'wiadomość', 'wiadomości', 'wiadomości')} od ${who.length} ${plural(who.length, 'podopiecznego', 'podopiecznych', 'podopiecznych')} jako przeczytane?`, { confirm: 'Oznacz' });
    if (!ok) return;
    await apply(
      who.map((c) => put('clients', { ...c, inbox: (c.inbox ?? []).map((n) => ({ ...n, read: true })) })),
      'Wszystkie wiadomości oznaczone jako przeczytane.',
    );
  };

  return (
    <div className="page fade inbox-page">
      <div className="page-head inbox-head">
        <div>
          <h2>Wiadomości</h2>
          <p className="muted small">
            {unread ? `${unread} ${plural(unread, 'nieprzeczytana', 'nieprzeczytane', 'nieprzeczytanych')}` : 'Wszystko przeczytane'}
            {' · '}
            {queue.length} do przejrzenia
          </p>
        </div>
        {tab === 'Rozmowy' && unread > 0 && (
          <button className="btn btn-secondary btn-sm" onClick={() => void readAll()}>
            <Icon name="check" size={14} /> Oznacz wszystkie jako przeczytane
          </button>
        )}
      </div>

      <div className="inbox-tabs" role="tablist" aria-label="Skrzynka">
        {TABS.map((t) => {
          const n = t === 'Rozmowy' ? unread : queue.length;
          return (
            <button key={t} role="tab" aria-selected={tab === t} className={`inbox-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
              {t}
              {n > 0 && <span className="nav-badge">{n}</span>}
            </button>
          );
        })}
      </div>

      {tab === 'Rozmowy' ? (
        <div className={`inbox-md${open ? ' show-detail' : ''}`}>
          <div className="inbox-list-wrap">
            {convos.length === 0 ? (
              <Empty>Jeszcze nikt nie napisał. Wiadomości od podopiecznych pojawią się tutaj.</Empty>
            ) : (
              <ul className="inbox-list">
                {convos.map((x) => (
                  <li key={x.c.id}>
                    <button className={`inbox-row${x.c.id === openId ? ' selected' : ''}${x.unread ? ' is-unread' : ''}`} onClick={() => setOpenId(x.c.id)}>
                      <Avatar name={x.c.name} size={40} />
                      <span className="inbox-row-body">
                        <span className="inbox-row-top">
                          <b className="ellipsis">{x.c.name}</b>
                          <span className="muted small nowrap">{clock(x.last.at, today)}</span>
                        </span>
                        <span className="inbox-row-bottom">
                          {x.workout && (
                            <span className="inbox-ico" title="Komentarz do treningu" aria-label="komentarz do treningu">
                              <Icon name="dumbbell" size={14} />
                            </span>
                          )}
                          {x.media && (
                            <span className="inbox-ico" title={mediaLabel(x.media)} aria-label={mediaLabel(x.media)}>
                              <Icon name={x.media === 'video' ? 'cam' : x.media === 'audio' ? 'mic' : 'image'} size={14} />
                            </span>
                          )}
                          <span className="muted small ellipsis grow">
                            {x.last.from === 'coach' ? 'Ty: ' : ''}
                            {x.last.text}
                          </span>
                          {x.unread > 0 && (
                            <span className="nav-badge" aria-label={`${x.unread} nieprzeczytanych`}>
                              {x.unread}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {without.length > 0 && (
              <label className="inbox-new">
                <span className="muted small">Napisz do podopiecznego</span>
                <select className="input" value="" onChange={(e) => e.target.value && setOpenId(e.target.value)}>
                  <option value="">Wybierz…</option>
                  {without.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <section className="inbox-detail">
            {open ? (
              <>
                <div className="inbox-detail-head">
                  <button className="btn btn-ghost btn-sm inbox-back" onClick={() => setOpenId(null)}>
                    ‹ Wszystkie rozmowy
                  </button>
                  <Avatar name={open.name} size={36} />
                  <b className="grow ellipsis">{open.name}</b>
                  <button className="btn btn-ghost btn-sm" onClick={() => openClient(open.id, 'Przegląd')}>
                    Karta <span className="hide-xs">podopiecznego</span> ›
                  </button>
                </div>
                <Chat key={open.id} client={open} side="coach" onOpenSession={(sessionId) => openModal({ kind: 'review', sessionId })} />
              </>
            ) : (
              <p className="empty">Wybierz rozmowę z listy.</p>
            )}
          </section>
        </div>
      ) : (
        <ReviewQueue items={queue} />
      )}
    </div>
  );
}

/* ---------- kolejka „Do przejrzenia” ---------- */

const KIND_TONE: Record<ReviewKind, Tone> = { pain: 'danger', wellness: 'warn', comment: 'neutral', video: 'neutral', report: 'neutral', food: 'warn', record: 'ok' };
const KIND_ICON: Record<ReviewKind, string> = { pain: 'alert', wellness: 'heart', comment: 'chat', video: 'cam', report: 'clipboard', food: 'flame', record: 'trophy' };

function ReviewQueue({ items }: { items: ReviewItem[] }) {
  const { db, apply } = useStore();
  const { openClient, openModal } = useNav();
  const today = todayISO();
  const [pos, setPos] = useState(0);
  const [replyOpen, setReplyOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const i = items.length ? Math.min(pos, items.length - 1) : 0;
  const item = items[i];
  const goTo = (n: number) => {
    setPos(n);
    setReplyOpen(false);
    setText('');
  };
  const c = item ? db.clients.find((x) => x.id === item.clientId) : undefined;
  const ctx = useMemo(() => (c ? reviewContext(c, db.sessions, today) : null), [c, db.sessions, today]);

  if (!item || !c || !ctx) {
    return (
      <div className="card review-card review-empty">
        <Icon name="check" size={28} />
        <h3>Wszystko przejrzane</h3>
        <p className="muted">Nowe raporty, komentarze, nagrania i sygnały z ostatnich 7 dni pojawią się tutaj.</p>
      </div>
    );
  }

  const session = item.sessionId ? db.sessions.find((s) => s.id === item.sessionId) : undefined;
  const report: WeeklyReport | undefined = item.reportId ? (c.weeklyReports ?? []).find((r) => r.id === item.reportId) : undefined;
  const note = item.noteId ? (c.inbox ?? []).find((n) => n.id === item.noteId) : undefined;
  const first = c.name.split(' ')[0];

  /** Zmiany „przejrzane” dla tego elementu (klient + ewentualnie trening). */
  const reviewedClient = (base: Client): Client => {
    const now = new Date().toISOString();
    return {
      ...base,
      reviewed: withReviewed(base.reviewed, item.key),
      ...(item.kind === 'report' && report ? { weeklyReports: (base.weeklyReports ?? []).map((r) => (r.id === report.id ? { ...r, seenAt: r.seenAt ?? now } : r)) } : {}),
      ...(item.kind === 'comment' && note ? { inbox: (base.inbox ?? []).map((n) => (n.id === note.id ? { ...n, read: true } : n)) } : {}),
    };
  };
  const sessionChange = () => (item.kind === 'video' && session && !session.reviewedAt ? [put('sessions', { ...session, reviewedAt: new Date().toISOString() })] : []);

  const markReviewed = async () => {
    setBusy(true);
    const ok = await apply([put('clients', reviewedClient(c)), ...sessionChange()], 'Przejrzane.');
    setBusy(false);
    if (ok) {
      setReplyOpen(false);
      setText('');
    }
  };

  const sendReply = async () => {
    const body = text.trim().slice(0, 2000);
    if (!body || busy) return;
    setBusy(true);
    let next = reviewedClient(c);
    let msg: string;
    if (item.kind === 'report' && report) {
      // odpowiedź na raport = komentarz trenera pod raportem
      next = { ...next, weeklyReports: (next.weeklyReports ?? []).map((r) => (r.id === report.id ? { ...r, coachNote: body } : r)) };
      msg = `Komentarz do raportu zapisany — ${first} zobaczy go w aplikacji.`;
    } else {
      const ref = note?.ref ?? (session ? refFor(session) : undefined);
      const r: CoachReply = { id: uid(), at: new Date().toISOString(), text: body, ...(ref && Object.keys(ref).length ? { ref } : {}), ...(note ? { replyTo: note.id } : {}) };
      next = { ...next, inbox: (next.inbox ?? []).map((n) => ({ ...n, read: true })), replies: [...(next.replies ?? []), r].slice(-200) };
      msg = `Wysłano — ${first} zobaczy wiadomość w aplikacji.`;
    }
    const ok = await apply([put('clients', next), ...sessionChange()], msg);
    setBusy(false);
    if (ok) {
      setReplyOpen(false);
      setText('');
    }
  };

  return (
    <div className="review">
      <div className="review-bar">
        <span className="review-count" aria-live="polite">
          <b>{i + 1}</b> z {items.length}
        </span>
        <span className="grow" />
        <button className="btn btn-ghost btn-sm review-nav" disabled={i === 0} onClick={() => goTo(i - 1)} aria-label="Poprzedni element">
          <Icon name="chevL" size={16} />
        </button>
        <button className="btn btn-ghost btn-sm review-nav" disabled={i >= items.length - 1} onClick={() => goTo(i + 1)} aria-label="Następny element">
          <Icon name="chevR" size={16} />
        </button>
      </div>

      <article className="card review-card" key={item.key}>
        <header className="review-head">
          <Tag tone={KIND_TONE[item.kind]}>
            <Icon name={KIND_ICON[item.kind]} size={13} /> {REVIEW_LABEL[item.kind]}
          </Tag>
          <span className="muted small">{dayLabel(item.date, today)}</span>
        </header>
        <div className="review-who">
          <Avatar name={c.name} size={40} />
          <div className="grow">
            <button className="link review-name" onClick={() => openClient(c.id, item.kind === 'pain' || item.kind === 'wellness' ? 'Monitoring' : 'Przegląd')}>
              {c.name}
            </button>
            <div className="review-title">{item.title}</div>
          </div>
        </div>

        {report ? (
          <div className="review-report">
            <p className="muted small">Tydzień {weekLabel(report.week)}</p>
            <dl className="review-stats">
              {report.weight != null && <Stat label="Waga" value={`${String(report.weight).replace('.', ',')} kg`} />}
              {report.sleep != null && <Stat label="Sen" value={`${report.sleep}/5`} warn={report.sleep <= 2} />}
              {report.energy != null && <Stat label="Energia" value={`${report.energy}/5`} warn={report.energy <= 2} />}
              {report.stress != null && <Stat label="Spokój" value={`${report.stress}/5`} warn={report.stress <= 2} />}
              {report.adherence != null && <Stat label="Plan" value={`${report.adherence}/5`} warn={report.adherence <= 2} />}
              {report.steps != null && <Stat label="Kroki" value={report.steps.toLocaleString('pl-PL')} />}
            </dl>
            {report.comment && <blockquote className="review-quote">{report.comment}</blockquote>}
          </div>
        ) : (
          item.detail && <blockquote className="review-quote">{item.detail}</blockquote>
        )}

        {session && (
          <p className="small">
            <button className="link" onClick={() => openModal({ kind: 'review', sessionId: session.id, ...(note?.ref?.exIndex != null ? { exIndex: note.ref.exIndex } : {}) })}>
              {item.kind === 'video' ? 'Obejrzyj nagrania' : 'Zobacz trening'} ›
            </button>
            <span className="muted"> · {session.workoutName || 'Trening'}, {fmtDay(session.date)}</span>
          </p>
        )}

        <div className="review-charts">
          <figure>
            <figcaption className="muted small">Waga — 8 tygodni</figcaption>
            <LineChart series={[{ label: 'Waga', pts: ctx.weight }]} height={120} label={`Waga ${c.name} — 8 tygodni`} />
          </figure>
          <figure>
            <figcaption className="muted small">Sen i energia (1–5)</figcaption>
            <LineChart
              series={[
                { label: 'Sen', pts: ctx.sleep },
                { label: 'Energia', pts: ctx.energy, tone: 'muted' },
              ]}
              height={120}
              minY={1}
              label={`Sen i energia ${c.name} — 8 tygodni`}
            />
          </figure>
          <figure>
            <figcaption className="muted small">Objętość — serie robocze / tydzień</figcaption>
            <BarChart pts={ctx.volume} height={120} label={`Serie robocze ${c.name} — 8 tygodni`} />
          </figure>
        </div>

        {replyOpen && (
          <div className="review-reply">
            <textarea
              className="input"
              rows={3}
              autoFocus
              value={text}
              maxLength={2000}
              placeholder={item.kind === 'report' ? `Komentarz do raportu dla ${first}…` : `Odpowiedź dla ${first}…`}
              onChange={(e) => setText(e.target.value)}
              aria-label="Treść odpowiedzi"
            />
            <div className="review-reply-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setReplyOpen(false)}>
                Anuluj
              </button>
              <button className="btn btn-primary btn-sm" disabled={!text.trim() || busy} onClick={() => void sendReply()}>
                Wyślij i oznacz
              </button>
            </div>
          </div>
        )}

        <div className="review-actions">
          <button className="btn btn-primary" disabled={busy} onClick={() => void markReviewed()}>
            <Icon name="check" size={16} /> Przejrzane
          </button>
          {!replyOpen && (
            <button className="btn btn-secondary" onClick={() => setReplyOpen(true)}>
              <Icon name="chat" size={16} /> Odpowiedz
            </button>
          )}
          <button className="btn btn-ghost" disabled={i >= items.length - 1} onClick={() => goTo(i + 1)}>
            Następny ›
          </button>
        </div>
      </article>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`review-stat${warn ? ' is-warn' : ''}`}>
      <dt className="muted small">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
