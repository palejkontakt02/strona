import { useState } from 'react';
import { Ring } from '../components/ring';
import type { Client } from '../domain';
import { useStore } from '../data/store';
import { plural, uid } from '../format';
import { put } from '../data/db';
import { todayISO } from '../lib/dates';
import { doneOn, dueOn, habitStreak, rangeProgress, toggleDone } from '../lib/habits';

/** Zadania na dziś od trenera: koło do zamknięcia i lista do odhaczenia. */
export function TodayHabits({ client }: { client: Client }) {
  const { saveHabitDay } = useStore();
  const today = todayISO();
  const due = dueOn(client.habits, today);
  if (!(client.habits ?? []).some((h) => !h.archived)) return null;
  const done = doneOn(client.habitLog, today);
  const n = due.filter((h) => done.includes(h.id)).length;
  const week = rangeProgress(client.habits, client.habitLog, today, 7);
  const streak = habitStreak(client.habits, client.habitLog, today);
  return (
    <section className="acard today">
      <div className="today-head">
        <Ring value={due.length ? n / due.length : 1} size={88} stroke={10} label={`Zrobione ${n} z ${due.length}`}>
          <b>{due.length ? `${n}/${due.length}` : '✓'}</b>
        </Ring>
        <div>
          <span className="eyebrow">Na dziś</span>
          <h3>{!due.length ? 'Dziś wolne od zadań' : n === due.length ? 'Koło zamknięte! 🎉' : `Zostało ${due.length - n}`}</h3>
          <p className="muted small">
            W ostatnich 7 dniach wszystko odhaczone w {week.closed} z {week.active} {plural(week.active, 'dnia', 'dni', 'dni')}
            {streak > 1 && ` · seria ${streak} ${plural(streak, 'dzień', 'dni', 'dni')}`}
          </p>
        </div>
      </div>
      {due.length > 0 && (
        <ul className="today-list">
          {due.map((h) => {
            const on = done.includes(h.id);
            return (
              <li key={h.id}>
                <button className={`today-item ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => void saveHabitDay(client.id, today, toggleDone(client.habitLog, today, h.id))}>
                  <span className="today-check" aria-hidden="true">
                    {on ? '✓' : ''}
                  </span>
                  <span>{h.title}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Wiadomość do trenera — zapisuje się w aplikacji i trafia na jego e-mail. */
/**
 * Rozmowa z trenerem. W podglądzie trenera (`asTrainer`) piszesz jako trener — odpowiedź trafia
 * do podopiecznego, bez e-maila do siebie.
 */
export function NoteToTrainer({ client, asTrainer }: { client: Client; asTrainer?: boolean }) {
  const { sendClientNote, apply } = useStore();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const first = client.name.split(' ')[0];
  const send = async () => {
    if (!asTrainer) return sendClientNote(client.id, text);
    const r = { id: uid(), at: new Date().toISOString(), text: text.trim().slice(0, 2000) };
    return apply([put('clients', { ...client, inbox: (client.inbox ?? []).map((n) => ({ ...n, read: true })), replies: [...(client.replies ?? []), r].slice(-200) })], `Wysłano — ${first} zobaczy wiadomość w aplikacji.`);
  };
  return (
    <section className="acard" id="do-trenera">
      <h3>{asTrainer ? `Rozmowa: ${client.name}` : 'Napisz do trenera'}</h3>
      <p className="muted small">
        {asTrainer ? `To podgląd — piszesz jako trener. ${first} zobaczy wiadomość w swojej aplikacji.` : 'Jak się czujesz, co bolało, pytanie o ćwiczenie — trener dostanie to na e-mail.'}
      </p>
      {(() => {
        const thread = [...(client.inbox ?? []).filter((n) => !n.hidden).map((n) => ({ ...n, mine: true })), ...(client.replies ?? []).map((r) => ({ ...r, mine: false }))]
          .sort((a, b) => (b.at || '').localeCompare(a.at || ''))
          .slice(0, 6);
        if (!thread.length) return null;
        return (
          <ul className="ath-thread" aria-label="Rozmowa z trenerem">
            {thread.map((n) => (
              <li key={n.id} className={n.mine ? 'mine' : 'coach'}>
                <span className="muted small">
                  {asTrainer ? (n.mine ? first : 'Ty (trener)') : n.mine ? 'Ty' : 'Trener'} · {new Date(n.at).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
                <p>{n.text}</p>
              </li>
            ))}
          </ul>
        );
      })()}
      <textarea className="input" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder={asTrainer ? 'Twoja wiadomość (jako trener)…' : 'Twoja wiadomość…'} aria-label={asTrainer ? 'Wiadomość od trenera' : 'Wiadomość do trenera'} />
      <button
        className="btn btn-primary btn-block"
        disabled={!text.trim() || busy}
        onClick={async () => {
          setBusy(true);
          if (await send()) setText('');
          setBusy(false);
        }}
      >
        {busy ? 'Wysyłam…' : 'Wyślij'}
      </button>
    </section>
  );
}
