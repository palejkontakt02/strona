import { useEffect, useState } from 'react';
import type { Client, ProgressPhoto } from '../domain';
import { put } from '../data/db';
import { fileProblem, fileUrl, isImage, saveClientFile } from '../data/files';
import { useStore } from '../data/store';
import { fmtDay, fmtLong, plural, uid } from '../format';
import { todayISO } from '../lib/dates';
import { photoAt, photoDates, POSES } from '../lib/comms';
import { Sheet } from './Sheet';
import { Icon } from './ui';

/* ---------- adresy plików (pamięć podręczna na czas sesji) ---------- */

const urls = new Map<string, Promise<string>>();
function urlOf(ref: string): Promise<string> {
  let p = urls.get(ref);
  if (!p) {
    p = fileUrl(ref);
    urls.set(ref, p);
    // link z chmury wygasa po godzinie, błąd — spróbuj ponownie następnym razem
    p.then(() => setTimeout(() => urls.delete(ref), 50 * 60 * 1000)).catch(() => urls.delete(ref));
  }
  return p;
}

export function useFileUrl(ref?: string): { url?: string; error?: string } {
  const [s, setS] = useState<{ url?: string; error?: string }>({});
  useEffect(() => {
    let live = true;
    setS({});
    if (ref)
      urlOf(ref).then(
        (url) => live && setS({ url }),
        (e: unknown) => live && setS({ error: e instanceof Error ? e.message : 'Brak pliku.' }),
      );
    return () => {
      live = false;
    };
  }, [ref]);
  return s;
}

export function PhotoImg({ photo, alt, className = '' }: { photo?: ProgressPhoto; alt: string; className?: string }) {
  const { url, error } = useFileUrl(photo?.ref);
  if (!photo) return <div className={`pp-img pp-none ${className}`}>brak zdjęcia</div>;
  if (error) return <div className={`pp-img pp-none ${className}`}>{error}</div>;
  if (!url) return <div className={`pp-img pp-loading ${className}`} aria-busy="true" />;
  return <img className={`pp-img ${className}`} src={url} alt={alt} loading="lazy" />;
}

/* ---------- wybór zdjęć w 3 pozach (raport tygodniowy i „Dodaj zdjęcia”) ---------- */

export type PoseFiles = Partial<Record<ProgressPhoto['pose'], File>>;

export function PosePicker({ files, onChange }: { files: PoseFiles; onChange: (f: PoseFiles) => void }) {
  const { toast } = useStore();
  const [previews, setPreviews] = useState<Partial<Record<string, string>>>({});
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const [k, f] of Object.entries(files)) if (f) next[k] = URL.createObjectURL(f);
    setPreviews(next);
    return () => Object.values(next).forEach((u) => URL.revokeObjectURL(u));
  }, [files]);
  return (
    <div className="pp-poses">
      {POSES.map((pose) => (
        <label key={pose} className={`pp-slot ${files[pose] ? 'has' : ''}`}>
          {previews[pose] ? <img src={previews[pose]} alt={`Zdjęcie: ${pose}`} /> : <Icon name="cam" size={22} />}
          <span className="first-cap">{pose}</span>
          <input
            type="file"
            accept="image/*"
            aria-label={`Zdjęcie: ${pose}`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              const err = fileProblem(f) ?? (isImage(f.type, f.name) ? null : 'Dodaj zdjęcie (JPG, PNG, HEIC).');
              if (err) return toast(err);
              onChange({ ...files, [pose]: f });
            }}
          />
          {files[pose] && (
            <button
              type="button"
              className="pp-x"
              aria-label={`Usuń zdjęcie: ${pose}`}
              onClick={(e) => {
                e.preventDefault();
                const n = { ...files };
                delete n[pose];
                onChange(n);
              }}
            >
              ×
            </button>
          )}
        </label>
      ))}
    </div>
  );
}

/** Wysyła wybrane zdjęcia i zapisuje je w profilu; zwraca id zapisanych (albo null przy błędzie). */
export async function uploadPoses(client: Client, files: PoseFiles, date: string, save: ReturnType<typeof useStore>['saveClientEntry'], toast: (m: string) => void): Promise<string[] | null> {
  const ids: string[] = [];
  for (const pose of POSES) {
    const f = files[pose];
    if (!f) continue;
    try {
      const { ref } = await saveClientFile(f, client.id);
      const ph: ProgressPhoto = { id: uid(), date, ref, pose, at: new Date().toISOString() };
      if (!(await save(client.id, 'progressPhotos', ph))) return null;
      ids.push(ph.id);
    } catch (e) {
      toast(e instanceof Error && e.message === 'BUCKET' ? 'Magazyn plików nie jest jeszcze włączony — trener musi go dodać w Supabase.' : 'Nie udało się wysłać zdjęcia — sprawdź połączenie.');
      return null;
    }
  }
  return ids;
}

function AddPhotos({ client, onClose }: { client: Client; onClose: () => void }) {
  const { saveClientEntry, toast } = useStore();
  const [files, setFiles] = useState<PoseFiles>({});
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const n = Object.keys(files).length;
  return (
    <Sheet label="Dodaj zdjęcia sylwetki" onClose={onClose}>
      <div className="between">
        <h3>Zdjęcia sylwetki</h3>
        <button className="icon-btn" aria-label="Zamknij" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <p className="muted small">Rano, w tym samym miejscu i świetle, ten sam strój. Widzi je tylko trener.</p>
      <label className="field">
        <span>Data</span>
        <input className="input" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
      </label>
      <PosePicker files={files} onChange={setFiles} />
      <button
        className="btn btn-primary btn-block"
        disabled={!n || busy || !date}
        onClick={async () => {
          setBusy(true);
          const ids = await uploadPoses(client, files, date, saveClientEntry, toast);
          setBusy(false);
          if (ids) {
            toast(`Zapisano ${ids.length} ${plural(ids.length, 'zdjęcie', 'zdjęcia', 'zdjęć')}.`);
            onClose();
          }
        }}
      >
        {busy ? 'Wysyłam…' : n ? `Zapisz zdjęcia (${n})` : 'Zapisz zdjęcia'}
      </button>
    </Sheet>
  );
}

/* ---------- porównanie dwóch dat ---------- */

export function PhotoCompare({ client, coach }: { client: Client; coach?: boolean }) {
  const photos = client.progressPhotos ?? [];
  const avail = POSES.filter((p) => photoDates(photos, p, coach).length);
  const [pose, setPose] = useState<ProgressPhoto['pose']>(avail[0] ?? 'przód');
  const dates = photoDates(photos, pose, coach);
  const [a, setA] = useState<string | undefined>();
  const [b, setB] = useState<string | undefined>();
  const [mode, setMode] = useState<'side' | 'slider'>('side');
  const [pos, setPos] = useState(50);
  const before = a && dates.includes(a) ? a : dates[dates.length - 1];
  const after = b && dates.includes(b) ? b : dates[0];
  if (!avail.length) return <p className="muted small">Brak zdjęć do porównania.</p>;
  const pa = before ? photoAt(photos, pose, before, coach) : undefined;
  const pb = after ? photoAt(photos, pose, after, coach) : undefined;
  const sel = (v: string | undefined, set: (d: string) => void, label: string) => (
    <select className="input input-sm" value={v} onChange={(e) => set(e.target.value)} aria-label={label}>
      {dates.map((d) => (
        <option key={d} value={d}>
          {fmtDay(d)} {d.slice(0, 4) !== todayISO().slice(0, 4) ? d.slice(0, 4) : ''}
        </option>
      ))}
    </select>
  );
  return (
    <div className="pp-compare">
      <div className="seg seg-sm" role="radiogroup" aria-label="Poza">
        {POSES.map((p) => (
          <button key={p} type="button" role="radio" aria-checked={pose === p} className={pose === p ? 'active' : ''} disabled={!photoDates(photos, p, coach).length} onClick={() => setPose(p)}>
            <span className="first-cap">{p}</span>
          </button>
        ))}
      </div>
      <div className="pp-pick">
        {sel(before, setA, 'Wcześniejsza data')}
        <span aria-hidden="true">→</span>
        {sel(after, setB, 'Późniejsza data')}
        {pa && pb && pa.id !== pb.id && (
          <button type="button" className="btn btn-ghost btn-sm" aria-pressed={mode === 'slider'} onClick={() => setMode(mode === 'side' ? 'slider' : 'side')}>
            {mode === 'side' ? 'Suwak' : 'Obok siebie'}
          </button>
        )}
      </div>
      {mode === 'slider' && pa && pb && pa.id !== pb.id ? (
        <div className="pp-slider">
          <PhotoImg photo={pa} alt={`${pose}, ${fmtLong(before!)}`} />
          <div className="pp-top" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
            <PhotoImg photo={pb} alt={`${pose}, ${fmtLong(after!)}`} />
          </div>
          <i className="pp-line" style={{ left: `${pos}%` }} aria-hidden="true" />
          <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="Przesuń, by porównać" />
          <span className="pp-tag l">{fmtDay(before)}</span>
          <span className="pp-tag r">{fmtDay(after)}</span>
        </div>
      ) : (
        <div className="pp-side">
          <figure>
            <PhotoImg photo={pa} alt={`${pose}, ${before ? fmtLong(before) : ''}`} />
            <figcaption>{fmtDay(before)}{pa?.hidden ? ' · ukryte' : ''}</figcaption>
          </figure>
          <figure>
            <PhotoImg photo={pb} alt={`${pose}, ${after ? fmtLong(after) : ''}`} />
            <figcaption>{fmtDay(after)}{pb?.hidden ? ' · ukryte' : ''}</figcaption>
          </figure>
        </div>
      )}
    </div>
  );
}

/* ---------- karta podopiecznego ---------- */

export function AthletePhotos({ client }: { client: Client }) {
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(false);
  const visible = (client.progressPhotos ?? []).filter((p) => !p.hidden);
  const last = visible.reduce((a, p) => (p.date > a ? p.date : a), '');
  return (
    <section className="acard pp-card">
      <div className="between">
        <h3>Zdjęcia sylwetki</h3>
        <button className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}>
          + Dodaj zdjęcia
        </button>
      </div>
      <p className="muted small">{last ? `Ostatnie: ${fmtDay(last)} · ${visible.length} ${plural(visible.length, 'zdjęcie', 'zdjęcia', 'zdjęć')}` : 'Raz na 2–4 tygodnie: przód, bok, tył. Zmiany w lustrze widać słabo — na zdjęciach obok siebie dużo lepiej.'}</p>
      {new Set(visible.map((p) => p.date)).size >= 2 && (
        <button className="btn btn-ghost btn-block" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Zwiń porównanie' : 'Porównaj dwie daty'}
        </button>
      )}
      {open && <PhotoCompare client={client} />}
      {adding && <AddPhotos client={client} onClose={() => setAdding(false)} />}
    </section>
  );
}

/* ---------- panel trenera ---------- */

export function CoachPhotos({ client }: { client: Client }) {
  const { apply } = useStore();
  const photos = [...(client.progressPhotos ?? [])].sort((a, b) => b.date.localeCompare(a.date) || POSES.indexOf(a.pose) - POSES.indexOf(b.pose));
  const [all, setAll] = useState(false);
  if (!photos.length) return <p className="empty">Podopieczny nie dodał jeszcze zdjęć sylwetki (dodaje je w aplikacji albo w raporcie tygodniowym).</p>;
  const toggle = (p: ProgressPhoto) =>
    apply([put('clients', { ...client, progressPhotos: (client.progressPhotos ?? []).map((x) => (x.id === p.id ? { ...x, hidden: !x.hidden } : x)) })], p.hidden ? 'Zdjęcie znowu widoczne.' : 'Zdjęcie ukryte — podopieczny go nie zobaczy.');
  return (
    <>
      {new Set(photos.map((p) => p.date)).size >= 2 && <PhotoCompare client={client} coach />}
      <ul className="pp-grid">
        {(all ? photos : photos.slice(0, 9)).map((p) => (
          <li key={p.id} className={p.hidden ? 'is-hidden' : ''}>
            <PhotoImg photo={p} alt={`${p.pose}, ${fmtLong(p.date)}`} />
            <span className="small">
              {fmtDay(p.date)} · {p.pose}
              {p.hidden ? ' · ukryte' : ''}
            </span>
            <button type="button" className="link small" onClick={() => void toggle(p)}>
              {p.hidden ? 'Pokaż' : 'Ukryj'}
            </button>
          </li>
        ))}
      </ul>
      {photos.length > 9 && (
        <button className="btn btn-ghost btn-sm" onClick={() => setAll(!all)}>
          {all ? 'Mniej' : `Wszystkie (${photos.length})`}
        </button>
      )}
    </>
  );
}
