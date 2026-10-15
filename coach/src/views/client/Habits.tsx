import { useState } from 'react';
import { Ring } from '../../components/ring';
import { Card, Empty, IconBtn, Tag } from '../../components/ui';
import type { Client, Habit, HabitSchedule } from '../../domain';
import { put } from '../../data/db';
import { useStore } from '../../data/store';
import { fmtDay, plural, uid } from '../../format';
import { todayISO } from '../../lib/dates';
import { dayProgress, habitStreak, rangeProgress, scheduleLabel, WEEKDAYS } from '../../lib/habits';

type Kind = HabitSchedule['kind'];

/** Formularz zadania: nazwa i kiedy (codziennie / dni tygodnia / dni miesiąca). */
function HabitForm({ initial, onSave, onCancel }: { initial?: Habit; onSave: (h: Habit) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [kind, setKind] = useState<Kind>(initial?.schedule.kind ?? 'daily');
  const [week, setWeek] = useState<number[]>(initial?.schedule.kind === 'week' ? initial.schedule.days : [1, 2, 3, 4, 5]);
  const [month, setMonth] = useState<number[]>(initial?.schedule.kind === 'month' ? initial.schedule.days : [1]);
  const toggle = (list: number[], d: number) => (list.includes(d) ? list.filter((x) => x !== d) : [...list, d].sort((a, b) => a - b));
  const valid = title.trim() && (kind === 'daily' || (kind === 'week' ? week.length : month.length));
  return (
    <div className="habit-form">
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="np. 10 000 kroków, 2 l wody, mobilność bioder 10 min" aria-label="Zadanie" autoFocus />
      <div className="seg" role="radiogroup" aria-label="Kiedy">
        {(
          [
            ['daily', 'Codziennie'],
            ['week', 'Dni tygodnia'],
            ['month', 'Dni miesiąca'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
            {l}
          </button>
        ))}
      </div>
      {kind === 'week' && (
        <div className="day-chips">
          {WEEKDAYS.map((w, i) => (
            <button key={w} type="button" aria-pressed={week.includes(i + 1)} className={week.includes(i + 1) ? 'active' : ''} onClick={() => setWeek(toggle(week, i + 1))}>
              {w}
            </button>
          ))}
          <button type="button" className="link small" onClick={() => setWeek(week.length === 7 ? [] : [1, 2, 3, 4, 5, 6, 7])}>
            {week.length === 7 ? 'wyczyść' : 'wszystkie'}
          </button>
        </div>
      )}
      {kind === 'month' && (
        <div className="day-chips month">
          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
            <button key={d} type="button" aria-pressed={month.includes(d)} className={month.includes(d) ? 'active' : ''} onClick={() => setMonth(toggle(month, d))}>
              {d}
            </button>
          ))}
          <button type="button" className="link small" onClick={() => setMonth(month.length === 31 ? [] : Array.from({ length: 31 }, (_, i) => i + 1))}>
            {month.length === 31 ? 'wyczyść' : 'wszystkie'}
          </button>
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Anuluj
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!valid}
          onClick={() =>
            onSave({
              id: initial?.id ?? uid(),
              title: title.trim(),
              since: initial?.since ?? todayISO(),
              schedule: kind === 'daily' ? { kind } : kind === 'week' ? { kind, days: week } : { kind, days: month },
            })
          }
        >
          Zapisz zadanie
        </button>
      </div>
    </div>
  );
}

/** Zadania dzienne podopiecznego: lista, ustawianie dni i koła postępu (dziś, 7 dni, 30 dni). */
export function ClientHabits({ client }: { client: Client }) {
  const { apply, ask } = useStore();
  const [editing, setEditing] = useState<Habit | 'new' | null>(null);
  const today = todayISO();
  const habits = (client.habits ?? []).filter((h) => !h.archived);
  const save = (list: Habit[], msg: string) => apply([put('clients', { ...client, habits: list })], msg);
  const day = dayProgress(client.habits, client.habitLog, today);
  const week = rangeProgress(client.habits, client.habitLog, today, 7);
  const month = rangeProgress(client.habits, client.habitLog, today, 30);
  const streak = habitStreak(client.habits, client.habitLog, today);
  const pct = (d: number, t: number) => (t ? d / t : 0);
  return (
    <Card
      title="Zadania dzienne"
      action={
        !editing && (
          <button className="btn btn-secondary btn-sm" onClick={() => setEditing('new')}>
            + Zadanie
          </button>
        )
      }
    >
      {habits.length > 0 && (
        <>
          <div className="habit-rings">
            <div>
              <Ring value={pct(day.done, day.total)} label={`Dziś ${day.done} z ${day.total}`}>
                <b>
                  {day.done}/{day.total}
                </b>
              </Ring>
              <span className="muted small">dziś</span>
            </div>
            <div>
              <Ring value={pct(week.done, week.total)}>
                <b>{Math.round(pct(week.done, week.total) * 100)}%</b>
              </Ring>
              <span className="muted small">7 dni</span>
            </div>
            <div>
              <Ring value={pct(month.done, month.total)}>
                <b>{Math.round(pct(month.done, month.total) * 100)}%</b>
              </Ring>
              <span className="muted small">30 dni</span>
            </div>
          </div>
          <p className="muted small center">
            Zamknięte dni (ostatnie 7): {week.closed} z {week.active} · seria {streak} {plural(streak, 'dzień', 'dni', 'dni')}
          </p>
          <div className="habit-days" aria-label="Ostatnie 14 dni">
            {rangeProgress(client.habits, client.habitLog, today, 14).perDay.map((d) => (
              <div key={d.date} title={`${fmtDay(d.date)}: ${d.done}/${d.total}`} className={d.total ? '' : 'off'}>
                <Ring value={d.total ? d.done / d.total : 0} size={26} stroke={4} />
                <span>{new Date(`${d.date}T12:00:00`).getDate()}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {editing === 'new' && <HabitForm onCancel={() => setEditing(null)} onSave={(h) => void save([...(client.habits ?? []), h], 'Dodano zadanie.').then(() => setEditing(null))} />}
      {habits.length === 0 && !editing && <Empty>Dodaj zadania, które podopieczny ma odhaczać każdego dnia (kroki, woda, sen, mobilność…). Zobaczy je w swojej aplikacji jako koło do zamknięcia.</Empty>}
      <ul className="rows">
        {habits.map((h) =>
          editing !== 'new' && editing?.id === h.id ? (
            <li key={h.id}>
              <HabitForm
                initial={h}
                onCancel={() => setEditing(null)}
                onSave={(n) => void save((client.habits ?? []).map((x) => (x.id === h.id ? n : x)), 'Zapisano zadanie.').then(() => setEditing(null))}
              />
            </li>
          ) : (
            <li key={h.id} className="row">
              <div className="grow">
                <strong>{h.title}</strong>
                <div className="muted small">{scheduleLabel(h.schedule)}</div>
              </div>
              {(client.habitLog ?? []).some((d) => d.date === today && d.done.includes(h.id)) && <Tag tone="ok">✓ dziś</Tag>}
              <IconBtn icon="edit" label={`Edytuj „${h.title}”`} onClick={() => setEditing(h)} />
              <IconBtn
                icon="trash"
                label={`Usuń „${h.title}”`}
                danger
                onClick={async () => {
                  if (await ask(`Usunąć zadanie „${h.title}”? Historia odhaczeń zostanie w statystykach do dziś.`))
                    await save((client.habits ?? []).map((x) => (x.id === h.id ? { ...x, archived: true, archivedAt: today } : x)), 'Usunięto zadanie.');
                }}
              />
            </li>
          ),
        )}
      </ul>
    </Card>
  );
}

/** Notatki od podopiecznego (trafiają też na e-mail trenera). */
export function ClientInbox({ client }: { client: Client }) {
  const { apply } = useStore();
  const notes = [...(client.inbox ?? [])].reverse();
  const unread = notes.filter((n) => !n.read).length;
  if (!notes.length) return null;
  return (
    <Card
      title={
        <>
          Notatki od podopiecznego {unread > 0 && <Tag tone="warn">{unread} nowe</Tag>}
        </>
      }
      action={
        unread > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => apply([put('clients', { ...client, inbox: (client.inbox ?? []).map((n) => ({ ...n, read: true })) })])}>
            Oznacz przeczytane
          </button>
        )
      }
    >
      <ul className="rows">
        {notes.slice(0, 20).map((n) => (
          <li key={n.id} className={`row row-top note ${n.read ? '' : 'is-new'}`}>
            <div className="grow">
              <div className="muted small">{new Date(n.at).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
              <p className="pre">{n.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
