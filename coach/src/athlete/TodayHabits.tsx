import { Ring } from '../components/ring';
import { Icon } from '../components/ui';
import type { Client } from '../domain';
import { useStore } from '../data/store';
import { plural } from '../format';
import { todayISO } from '../lib/dates';
import { doneOn, dueOn, habitItemStreak, habitStreak, rangeProgress, toggleDone } from '../lib/habits';

const nf = new Intl.NumberFormat('pl-PL');
const days = (n: number) => `${nf.format(n)} ${plural(n, 'dzień', 'dni', 'dni')}`;

/** Zadania na dziś od trenera: koło dnia i lista do odhaczenia (duże pola, seria każdego zadania). */
export function TodayHabits({ client }: { client: Client }) {
  const { saveHabitDay } = useStore();
  const today = todayISO();
  if (!(client.habits ?? []).some((h) => !h.archived)) return null;
  const due = dueOn(client.habits, today);
  const done = doneOn(client.habitLog, today);
  const n = due.filter((h) => done.includes(h.id)).length;
  const week = rangeProgress(client.habits, client.habitLog, today, 7);
  const streak = habitStreak(client.habits, client.habitLog, today);
  const all = due.length > 0 && n === due.length;
  return (
    <section className="acard th-card" aria-label="Zadania na dziś">
      <div className="th-head">
        <Ring value={due.length ? n / due.length : 1} size={64} stroke={8} label={`Zrobione ${n} z ${due.length}`}>
          <b className="th-ring-n">{due.length ? `${n}/${due.length}` : <Icon name="check" size={20} />}</b>
        </Ring>
        <div className="th-head-txt">
          <span className="eyebrow">Na dziś od trenera</span>
          <h3>{!due.length ? 'Dziś wolne od zadań' : all ? 'Wszystko zrobione' : `Zostało ${due.length - n} z ${due.length}`}</h3>
          <p className="muted small">
            Ostatnie 7 dni: wszystko w {week.closed} z {week.active} {plural(week.active, 'dnia', 'dni', 'dni')}
            {streak > 1 && ` · seria ${days(streak)}`}
          </p>
        </div>
      </div>
      {due.length > 0 && (
        <ul className="th-list">
          {due.map((h) => {
            const on = done.includes(h.id);
            const s = habitItemStreak(h, client.habitLog, today);
            return (
              <li key={h.id}>
                <button
                  type="button"
                  className={`th-item ${on ? 'on' : ''}`}
                  aria-pressed={on}
                  onClick={() => void saveHabitDay(client.id, today, toggleDone(client.habitLog, today, h.id))}
                >
                  <span className="th-check" aria-hidden="true">
                    {on && <Icon name="check" size={20} />}
                  </span>
                  <span className="th-title">{h.title}</span>
                  {s > 0 && (
                    <span className="th-streak" title={`Seria: ${days(s)} z rzędu`}>
                      <Icon name="flame" size={14} />
                      <b>{nf.format(s)}</b>
                      <span className="th-sr"> {plural(s, 'dzień', 'dni', 'dni')} z rzędu</span>
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
