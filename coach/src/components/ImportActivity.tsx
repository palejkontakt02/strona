import { useRef, useState } from 'react';
import type { SessionExercise, TrainingSession } from '../domain';
import { clientById, saveSession, sessionsOf } from '../data/ops';
import { useStore } from '../data/store';
import { fmtDay, fnum, plural, uid } from '../format';
import type { Activity } from '../lib/activityImport';
import { todayISO } from '../lib/dates';
import { fmtClock, paceText, runTotals } from '../lib/running';

const ACCEPT = '.gpx,.tcx,.fit,application/gpx+xml,application/vnd.garmin.tcx+xml,application/octet-stream';

type Parser = typeof import('../lib/activityImport');
/** Parser ładowany dopiero po wybraniu pliku (osobny chunk) — nie obciąża startu aplikacji. */
let parser: Parser | null = null;
async function readActivity(file: File): Promise<{ act: Activity; lib: Parser }> {
  if (file.size > 40 * 1024 * 1024) throw new Error('Plik jest za duży (ponad 40 MB).');
  const lib = (parser ??= await import('../lib/activityImport'));
  return { act: lib.parseActivity(file.name, await file.arrayBuffer()), lib };
}

/**
 * Formularz treningu (trener): import wypełnia pierwsze ćwiczenie cardio bez wpisanych km / tętna (np. bieg z planu,
 * zachowując nazwę z planu); gdy takiego nie ma — dopisuje nowe. Puste wiersze bez nazwy znikają.
 */
export function fillCardioRows<T extends { name: string; cardio?: boolean; series?: { dist?: string; hr?: string }[] }>(rows: T[], imported: T): T[] {
  const kept = rows.filter((r) => r.name.trim());
  const i = kept.findIndex((r) => r.cardio && !(r.series ?? []).some((x) => (x.dist ?? '').trim() || (x.hr ?? '').trim()));
  return i < 0 ? [...kept, imported] : kept.map((r, j) => (j === i ? { ...r, series: imported.series } : r));
}

const timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '');

/**
 * Import biegu z zegarka / Stravy (GPX, TCX, FIT): wybór pliku → podgląd → zapis.
 * - z `clientId` (aplikacja podopiecznego): zapisuje trening samodzielny (tylko kolekcja sessions),
 * - z `onImport` (okno treningu u trenera): oddaje ćwiczenie cardio do wstawienia w formularz.
 */
export function ImportActivity({ clientId, onImport, small }: { clientId?: string; onImport?: (ex: SessionExercise, a: Activity) => void; small?: boolean }) {
  const { db, apply, toast, ask } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [a, setA] = useState<Activity | null>(null);
  const [file, setFile] = useState('');
  const [useLaps, setUseLaps] = useState(true);
  const [name, setName] = useState('');
  const [rpe, setRpe] = useState('');

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setErr('');
    try {
      const { act } = await readActivity(f);
      if (!act.km && !act.movingMin) throw new Error('W pliku nie ma dystansu ani czasu.');
      setA(act);
      setFile(f.name);
      setUseLaps(act.laps.length > 1);
      setName(act.name && act.name.length <= 60 ? act.name : 'Bieg z zegarka');
      setRpe('');
    } catch (e) {
      setA(null);
      setErr(e instanceof Error ? e.message : 'Nie udało się odczytać pliku.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const close = () => {
    setA(null);
    setErr('');
  };

  const exercise = a && parser ? parser.activityExercise(a, useLaps && a.laps.length > 1) : null;
  const rows = exercise?.setsLog ?? [];

  const save = async () => {
    if (!a || !exercise) return;
    if (onImport) {
      onImport(exercise, a);
      toast(`Wstawiono ${rows.length} ${plural(rows.length, 'odcinek', 'odcinki', 'odcinków')} z pliku.`);
      return close();
    }
    const client = clientById(db, clientId);
    if (!client) return;
    const date = a.date ?? todayISO();
    // ten sam bieg wczytany drugi raz (ta sama data i dystans) — pytamy, zanim zdublujemy kilometraż
    const dup = sessionsOf(db, client.id).find((s) => s.date === date && Math.abs((runTotals(s)?.km ?? -1) - a.km) < 0.1);
    if (dup && !(await ask(`Trening z ${fmtDay(date)} z dystansem ${fnum(a.km, 2)} km już jest zapisany. Zapisać drugi raz?`, { confirm: 'Zapisz' }))) return;
    const r = Number(rpe);
    const session: TrainingSession = {
      id: uid(),
      clientId: client.id,
      date,
      workoutName: name.trim() || 'Bieg z zegarka',
      charge: 'brak',
      duration: Math.max(1, Math.round(a.elapsedMin || a.movingMin)),
      srpe: rpe !== '' && r >= 0 && r <= 10 ? r : undefined,
      notes: `Import z zegarka (${a.source.toUpperCase()}${timeOf(a.start) ? `, start ${timeOf(a.start)}` : ''}).`,
      exercises: [exercise],
      solo: true,
    };
    // konto podopiecznego zapisuje tylko treningi — samodzielny trening nie łączy się z wizytą ani płatnością
    const { changes } = saveSession(db, { session, isNew: true, matchAppointment: false });
    if (!(await apply(changes.filter((c) => c.col === 'sessions'), 'Bieg zaimportowany i zapisany.'))) return;
    close();
  };

  return (
    <div className={`imp ${small ? 'imp-small' : ''}`}>
      <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => void pick(e.target.files?.[0])} aria-label="Plik z zegarka (GPX, TCX, FIT)" />
      {!a && (
        <button type="button" className={small ? 'btn btn-ghost btn-sm' : 'btn btn-ghost btn-block imp-btn'} disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Wczytuję plik…' : small ? '⌚ Importuj z zegarka' : '⌚ Importuj z zegarka (GPX, TCX, FIT)'}
        </button>
      )}
      {err && (
        <p className="small warn-text imp-err" role="alert">
          {err}
        </p>
      )}
      {a && (
        <section className="imp-preview" aria-label="Podgląd importu">
          <div className="imp-head">
            <span className="eyebrow">Z pliku {file}</span>
            <strong>
              {a.date ? fmtDay(a.date) : 'bez daty'}
              {timeOf(a.start) && `, ${timeOf(a.start)}`}
              {a.sport && !/^run/i.test(a.sport) ? ` · ${a.sport}` : ''}
            </strong>
          </div>
          <dl className="imp-kpis">
            <div>
              <dt>Dystans</dt>
              <dd>{fnum(a.km, 2)} km</dd>
            </div>
            <div>
              <dt>Czas w ruchu</dt>
              <dd>{fmtClock(a.movingMin || a.elapsedMin)}</dd>
            </div>
            <div>
              <dt>Tempo</dt>
              <dd>{a.pace || '—'}</dd>
            </div>
            <div>
              <dt>Tętno śr. / maks.</dt>
              <dd>{a.avgHr ? `${a.avgHr} / ${a.maxHr ?? '—'}` : '—'}</dd>
            </div>
          </dl>
          {a.elapsedMin - a.movingMin >= 1 && <p className="muted small">Całkowity czas {fmtClock(a.elapsedMin)} (z postojami).</p>}
          {a.laps.length > 1 && (
            <div className="chips imp-mode" role="group" aria-label="Odcinki">
              <button type="button" className={`chip ${useLaps ? 'active' : ''}`} aria-pressed={useLaps} onClick={() => setUseLaps(true)}>
                Okrążenia z zegarka ({a.laps.length})
              </button>
              <button type="button" className={`chip ${!useLaps ? 'active' : ''}`} aria-pressed={!useLaps} onClick={() => setUseLaps(false)}>
                Co 1 km ({a.splits.length})
              </button>
            </div>
          )}
          <div className="imp-table-wrap">
            <table className="table imp-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>km</th>
                  <th>czas</th>
                  <th>tempo</th>
                  <th>tętno</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td className="num">{fnum(x.dist, 2)}</td>
                    <td className="num">{fmtClock(x.reps ?? 0)}</td>
                    <td className="num">{paceText(x.reps, x.dist) || '—'}</td>
                    <td className="num">{x.hr ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!onImport && (
            <div className="imp-fields">
              <label className="field">
                <span>Nazwa</span>
                <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="field">
                <span>Jak ciężko? (RPE 0–10)</span>
                <select className="input" value={rpe} onChange={(e) => setRpe(e.target.value)}>
                  <option value="">—</option>
                  {Array.from({ length: 11 }, (_, i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <div className="actions imp-actions">
            <button type="button" className="btn btn-ghost" onClick={close}>
              Anuluj
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void save()}>
              {onImport ? 'Wstaw do treningu' : 'Zapisz trening'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
