import { hasConsent } from '../lib/rodo';
import { useState } from 'react';
import type { Client, WeeklyReport } from '../domain';
import { put } from '../data/db';
import { useStore } from '../data/store';
import { fnum, uid } from '../format';
import { addDays, todayISO } from '../lib/dates';
import { numIn } from '../lib/parse';
import { reportDue, reportsDesc, reportWeek, reportWeights, weekLabel } from '../lib/comms';
import { LineChart } from './charts';
import { PhotoImg, PosePicker, uploadPoses, type PoseFiles } from './ProgressPhotos';
import { Sheet } from './Sheet';
import { Icon, Tag } from './ui';

const SCALES: [keyof Pick<WeeklyReport, 'sleep' | 'stress' | 'energy' | 'adherence'>, string, string][] = [
  ['sleep', 'Sen w tygodniu', '1 źle · 5 świetnie'],
  ['stress', 'Stres w tygodniu', '1 duży · 5 spokój'],
  ['energy', 'Energia w tygodniu', '1 brak sił · 5 pełno'],
  ['adherence', 'Trzymanie planu i diety', '1 wcale · 5 w 100%'],
];

function ReportForm({ client, onClose }: { client: Client; onClose: () => void }) {
  const { saveClientEntry, toast } = useStore();
  const week = reportWeek(todayISO());
  const prev = reportsDesc(client).find((r) => r.week !== week);
  const [r, setR] = useState<Partial<WeeklyReport>>({});
  const [weight, setWeight] = useState('');
  const [steps, setSteps] = useState('');
  const [files, setFiles] = useState<PoseFiles>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const w = weight.trim() ? numIn(weight, 25, 300) : undefined;
    if (w === null) return toast('Waga: wpisz liczbę od 25 do 300 kg.');
    const st = steps.trim() ? numIn(steps.replace(/\s/g, ''), 0, 100000) : undefined;
    if (st === null) return toast('Kroki: wpisz liczbę od 0 do 100 000.');
    setBusy(true);
    const photoIds = Object.keys(files).length ? await uploadPoses(client, files, todayISO(), saveClientEntry, toast) : [];
    if (photoIds === null) return setBusy(false);
    const rep: WeeklyReport = {
      id: uid(),
      week,
      at: new Date().toISOString(),
      ...(w != null ? { weight: w } : {}),
      ...(st != null ? { steps: Math.round(st) } : {}),
      ...Object.fromEntries(SCALES.filter(([k]) => r[k] != null).map(([k]) => [k, r[k]])),
      ...(r.comment?.trim() ? { comment: r.comment.trim().slice(0, 2000) } : {}),
      ...(photoIds.length ? { photoIds } : {}),
    };
    const ok = await saveClientEntry(client.id, 'weeklyReports', rep, 'Raport wysłany — dzięki! Trener odpisze w aplikacji.');
    setBusy(false);
    if (ok) onClose();
  };
  const filled = SCALES.filter(([k]) => r[k] != null).length;
  return (
    <Sheet label="Raport tygodnia" onClose={onClose}>
      <div className="between">
        <h3>Raport tygodnia · {weekLabel(week)}</h3>
        <button className="icon-btn" aria-label="Zamknij" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <div className="wr-form">
        <div className="wr-two">
          <label className="field">
            <span>Waga (kg)</span>
            <input className="input" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder={prev?.weight != null ? `ostatnio ${fnum(prev.weight)}` : 'np. 72,4'} aria-label="Waga (kg)" />
          </label>
          <label className="field">
            <span>Kroki dziennie (średnio)</span>
            <input className="input" inputMode="numeric" value={steps} onChange={(e) => setSteps(e.target.value)} placeholder="np. 8000" aria-label="Średnio kroków dziennie" />
          </label>
        </div>
        {SCALES.map(([k, label, ends]) => (
          <div key={k} className="checkin-row wr-scale">
            <span>
              {label}
              <span className="muted small checkin-ends">{ends}</span>
            </span>
            <div className="scale scale-5" role="radiogroup" aria-label={label}>
              {[1, 2, 3, 4, 5].map((v) => (
                <button key={v} type="button" role="radio" aria-checked={r[k] === v} className={r[k] === v ? 'active' : ''} onClick={() => setR({ ...r, [k]: v })} aria-label={`${label} ${v}`}>
                  {v}
                </button>
              ))}
            </div>
          </div>
        ))}
        <label className="field">
          <span>Jak minął tydzień?</span>
          <textarea className="input" rows={3} maxLength={2000} value={r.comment ?? ''} onChange={(e) => setR({ ...r, comment: e.target.value })} placeholder="Co poszło dobrze, co było trudne, pytania…" />
        </label>
        <div className="field">
          <span>Zdjęcia sylwetki (opcjonalnie)</span>
          <PosePicker files={files} onChange={setFiles} />
        </div>
      </div>
      <button className="btn btn-primary btn-block" disabled={busy || (!filled && !weight.trim() && !r.comment?.trim())} onClick={() => void save()}>
        {busy ? 'Wysyłam…' : 'Wyślij raport'}
      </button>
    </Sheet>
  );
}

const SEEN_NOTE = (id: string) => `fitowa-report-note:${id}`;

/** Podopieczny: pt–pn karta „Raport tygodnia” (gdy niewysłany) albo świeża odpowiedź trenera na raport. */
export function WeeklyReportCard({ client }: { client: Client }) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SEEN_NOTE(client.id));
    } catch {
      return null;
    }
  });
  const today = todayISO();
  const due = reportDue(client, today);
  // odpowiedź trenera na raport z ostatnich ~3 tygodni (starsze nie wracają na ekran)
  const answered = reportsDesc(client).find((r) => r.coachNote && r.week >= addDays(reportWeek(today), -14));
  const showNote = !!answered && hidden !== answered.id + (answered.coachNote ?? '').length;
  if (!due && !showNote) return null;
  return (
    <>
      {due && (
        <section className="acard wr-card">
          <span className="eyebrow">Raport tygodnia · {weekLabel(reportWeek(today))}</span>
          <h3>Jak minął tydzień?</h3>
          <p className="muted small">Waga, sen, stres, energia, kroki — 2 minuty. Trener na tej podstawie ustawi kolejny tydzień.</p>
          <button className="btn btn-primary btn-block" onClick={() => setOpen(true)}>
            Wypełnij raport
          </button>
        </section>
      )}
      {showNote && (
        <section className="acard wr-reply">
          <span className="eyebrow">Trener o raporcie · {weekLabel(answered!.week)}</span>
          <p className="pre">{answered!.coachNote}</p>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              const v = answered!.id + (answered!.coachNote ?? '').length;
              try {
                localStorage.setItem(SEEN_NOTE(client.id), v);
              } catch {
                // bez localStorage — tylko do odświeżenia
              }
              setHidden(v);
            }}
          >
            OK, przeczytane
          </button>
        </section>
      )}
      {open && <ReportForm client={client} onClose={() => setOpen(false)} />}
    </>
  );
}

/* ---------- panel trenera ---------- */

function ReportRow({ client, r, prev }: { client: Client; r: WeeklyReport; prev?: WeeklyReport }) {
  const { apply } = useStore();
  const [note, setNote] = useState(r.coachNote ?? '');
  const [edit, setEdit] = useState(!r.coachNote);
  const photos = (client.progressPhotos ?? []).filter((p) => r.photoIds?.includes(p.id));
  const saveR = (patch: Partial<WeeklyReport>, msg?: string) =>
    apply([put('clients', { ...client, weeklyReports: (client.weeklyReports ?? []).map((x) => (x.id === r.id ? { ...x, ...patch } : x)) })], msg);
  const dw = r.weight != null && prev?.weight != null ? r.weight - prev.weight : null;
  return (
    <li className={`wr-row ${r.seenAt ? '' : 'is-new'}`}>
      <div className="between">
        <strong>{weekLabel(r.week)}</strong>
        {r.seenAt ? <span className="muted small">przeczytany</span> : <Tag tone="warn">nowy</Tag>}
      </div>
      <div className="wr-vals">
        {r.weight != null && (
          <span>
            <b>{fnum(r.weight)} kg</b>
            {dw != null && <span className={`small ${dw < 0 ? 'ok-text' : 'muted'}`}> {dw > 0 ? '+' : ''}{fnum(dw)}</span>}
          </span>
        )}
        {SCALES.map(([k, label]) =>
          r[k] != null ? (
            <span key={k} className={(r[k] as number) <= 2 ? 'warn-text' : ''}>
              {label.split(' ')[0]} <b>{r[k]}</b>/5
            </span>
          ) : null,
        )}
        {r.steps != null && (
          <span>
            Kroki <b>{r.steps.toLocaleString('pl-PL')}</b>
          </span>
        )}
      </div>
      {r.comment && <p className="pre small wr-comment">„{r.comment}”</p>}
      {photos.length > 0 && hasConsent(client, 'media') && (
        <div className="wr-photos">
          {photos.map((p) => (
            <PhotoImg key={p.id} photo={p} alt={`${p.pose}, ${r.week}`} />
          ))}
        </div>
      )}
      {edit ? (
        <div className="wr-note">
          <input className="input input-sm" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Krótka odpowiedź (zobaczy ją w aplikacji)" aria-label={`Odpowiedź na raport ${weekLabel(r.week)}`} />
          <button
            className="btn btn-primary btn-sm"
            disabled={!note.trim() && !!r.seenAt}
            onClick={async () => {
              if (await saveR({ seenAt: r.seenAt ?? new Date().toISOString(), coachNote: note.trim() || undefined }, note.trim() ? 'Odpowiedź zapisana — podopieczny zobaczy ją w aplikacji.' : 'Oznaczono jako przeczytany.')) setEdit(!note.trim());
            }}
          >
            {note.trim() ? 'Odpowiedz' : 'Przeczytany'}
          </button>
        </div>
      ) : (
        <p className="small wr-coach">
          <span className="muted">Twoja odpowiedź:</span> {r.coachNote}{' '}
          <button className="link small" onClick={() => setEdit(true)}>
            zmień
          </button>
        </p>
      )}
    </li>
  );
}

export function CoachReports({ client }: { client: Client }) {
  const { apply } = useStore();
  const [all, setAll] = useState(false);
  const reps = reportsDesc(client);
  const weights = reportWeights(client.weeklyReports);
  const on = !!client.weeklyReport;
  return (
    <>
      <label className="wr-switch">
        <input type="checkbox" role="switch" checked={on} onChange={() => void apply([put('clients', { ...client, weeklyReport: !on })], on ? 'Raport tygodniowy wyłączony.' : 'Raport tygodniowy włączony — podopieczny zobaczy kartę od piątku do poniedziałku.')} />
        <span>Raport tygodniowy: {on ? 'wymagany' : 'niewymagany'}</span>
      </label>
      {reps.length === 0 ? (
        <p className="empty">{on ? 'Brak raportów. Podopieczny zobaczy kartę „Raport tygodnia” od piątku do poniedziałku.' : 'Włącz, by podopieczny co tydzień wysyłał wagę, sen, stres, energię, kroki i zdjęcia.'}</p>
      ) : (
        <>
          {weights.length >= 2 && <LineChart label="Waga z raportów" series={[{ label: 'Waga (kg)', pts: weights }]} height={140} />}
          <ul className="wr-list">
            {(all ? reps : reps.slice(0, 4)).map((r, i) => (
              <ReportRow key={r.id} client={client} r={r} prev={reps[i + 1]} />
            ))}
          </ul>
          {reps.length > 4 && (
            <button className="btn btn-ghost btn-sm" onClick={() => setAll(!all)}>
              {all ? 'Mniej' : `Starsze (${reps.length - 4})`}
            </button>
          )}
        </>
      )}
    </>
  );
}
