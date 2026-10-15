import { useState } from 'react';
import { Ring } from '../components/ring';
import type { Client } from '../domain';
import { useStore } from '../data/store';
import { plural } from '../format';
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
            Zamknięte dni (ostatnie 7): {week.closed} z {week.active}
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
export function NoteToTrainer({ client }: { client: Client }) {
  const { sendClientNote } = useStore();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <section className="acard" id="do-trenera">
      <h3>Napisz do trenera</h3>
      <p className="muted small">Jak się czujesz, co bolało, pytanie o ćwiczenie — trener dostanie to na e-mail.</p>
      <textarea className="input" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Twoja wiadomość…" aria-label="Wiadomość do trenera" />
      <button
        className="btn btn-primary btn-block"
        disabled={!text.trim() || busy}
        onClick={async () => {
          setBusy(true);
          if (await sendClientNote(client.id, text)) setText('');
          setBusy(false);
        }}
      >
        {busy ? 'Wysyłam…' : 'Wyślij'}
      </button>
    </section>
  );
}
