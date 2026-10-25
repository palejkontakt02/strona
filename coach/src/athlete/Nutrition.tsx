import { useEffect, useState } from 'react';
import { Sheet } from '../components/Sheet';
import { Icon } from '../components/ui';
import { useFileUrl } from '../components/ProgressPhotos';
import type { Client, DayLog } from '../domain';
import { deleteClientFile, fileProblem, isImage, saveClientFile } from '../data/files';
import { useStore } from '../data/store';
import { addDays, todayISO } from '../lib/dates';
import { kcalFromMacros, MACROS, macroStatus, type MacroKey } from '../lib/nutrition';
import { numIn } from '../lib/parse';

const nf = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 });
const fmt = (v?: number) => (v == null ? '' : nf.format(v).replace(/ /g, ' '));
const toText = (l?: DayLog) => Object.fromEntries(MACROS.map(([k]) => [k, l?.[k] == null ? '' : String(l[k]).replace('.', ',')])) as Record<MacroKey, string>;

/** Miniatura zrzutu (plik z magazynu albo z pamięci telefonu); stuknięcie otwiera całość. */
export function ShotThumb({ refId, alt, onOpen, className = '' }: { refId: string; alt: string; onOpen?: () => void; className?: string }) {
  const { url, error } = useFileUrl(refId);
  const img = error ? <span className="nu-shot-err">{error}</span> : url ? <img src={url} alt={alt} loading="lazy" /> : <span className="nu-shot-wait" aria-busy="true" />;
  return onOpen ? (
    <button type="button" className={`nu-thumb ${className}`} onClick={onOpen} aria-label={`Otwórz: ${alt}`}>
      {img}
    </button>
  ) : (
    <span className={`nu-thumb ${className}`}>{img}</span>
  );
}

/** Zrzut ekranu na całą wysokość arkusza. */
export function ShotSheet({ refId, title, onClose }: { refId: string; title: string; onClose: () => void }) {
  const { url, error } = useFileUrl(refId);
  return (
    <Sheet label={title} onClose={onClose}>
      <div className="between">
        <h3>{title}</h3>
        <button className="icon-btn" aria-label="Zamknij" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      {error ? <p className="muted">{error}</p> : url ? <img className="nu-full" src={url} alt={title} /> : <div className="nu-full nu-shot-wait" aria-busy="true" />}
    </Sheet>
  );
}

/** Podopieczny: kcal, białko, tłuszcze i węglowodany za dziś (przepisane z Fitatu) + opcjonalny zrzut ekranu. */
export function NutritionCard({ client }: { client: Client }) {
  const { saveClientEntry, toast } = useStore();
  const today = todayISO();
  const [day, setDay] = useState(today);
  const saved = (client.dayLog ?? []).find((l) => l.date === day);
  const [text, setText] = useState<Record<MacroKey, string>>(() => toText(saved));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'save' | 'shot' | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [open, setOpen] = useState(false);
  const t = client.targets;

  // zmiana dnia albo wpis z innego urządzenia — pokaż zapisane wartości, jeśli niczego nie zmieniasz
  const savedKey = MACROS.map(([k]) => saved?.[k] ?? '').join('|');
  useEffect(() => {
    if (!dirty) setText(toText(saved));
  }, [day, savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const parse = (): Partial<Record<MacroKey, number | undefined>> | string => {
    const out: Partial<Record<MacroKey, number | undefined>> = {};
    for (const [k, label, , unit, max] of MACROS) {
      const s = text[k].trim();
      if (!s) {
        out[k] = undefined;
        continue;
      }
      const n = numIn(s, 0, max);
      if (n == null) return `${label}: wpisz liczbę od 0 do ${nf.format(max)} ${unit}.`;
      out[k] = Math.round(n * 10) / 10;
    }
    return out;
  };

  /** Zapis całego dnia: zachowuje kroki i wodę z karty „ruch”, nadpisuje makro i zrzut. */
  const write = async (extra: Partial<DayLog> = {}) => {
    const v = parse();
    if (typeof v === 'string') {
      toast(v);
      return false;
    }
    const base = (client.dayLog ?? []).find((l) => l.date === day);
    const entry: DayLog = { ...base, ...v, ...extra, date: day };
    for (const k of Object.keys(entry) as (keyof DayLog)[]) if (entry[k] === undefined || entry[k] === '') delete entry[k];
    const ok = await saveClientEntry(client.id, 'dayLog', entry);
    if (ok) {
      setDirty(false);
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 2500);
    }
    return ok;
  };

  const onSave = async () => {
    setBusy('save');
    await write();
    setBusy(null);
  };

  const onShot = async (f: File) => {
    const err = fileProblem(f) ?? (isImage(f.type, f.name) ? null : 'Dodaj zdjęcie (zrzut ekranu: JPG, PNG).');
    if (err) return toast(err);
    setBusy('shot');
    try {
      const old = saved?.shot;
      const { ref } = await saveClientFile(f, client.id);
      if (await write({ shot: ref })) {
        if (old && old !== ref) void deleteClientFile(old);
      } else void deleteClientFile(ref);
    } catch (e) {
      toast(e instanceof Error && e.message === 'BUCKET' ? 'Magazyn plików nie jest jeszcze włączony — trener musi go dodać w Supabase.' : 'Nie udało się wysłać zrzutu — sprawdź połączenie.');
    }
    setBusy(null);
  };

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) void onShot(f);
  };

  const removeShot = async () => {
    const old = saved?.shot;
    if (!old) return;
    setBusy('shot');
    if (await write({ shot: undefined })) void deleteClientFile(old);
    setBusy(null);
  };

  const parsed = parse();
  const vals = typeof parsed === 'string' ? {} : parsed;
  const hint = vals.kcal == null ? kcalFromMacros(vals) : null;
  const hasT = !!t && MACROS.some(([k]) => (t[k] ?? 0) > 0);
  const dayLabel = day === today ? 'dziś' : 'wczoraj';

  return (
    <section className="acard nu-card" aria-label="Jedzenie">
      <div className="nu-head">
        <div>
          <span className="eyebrow">Z aplikacji Fitatu</span>
          <h3>Jedzenie {dayLabel}</h3>
        </div>
        <span className="seg seg-sm nu-day" role="radiogroup" aria-label="Dzień">
          {[today, addDays(today, -1)].map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={day === d}
              className={day === d ? 'active' : ''}
              onClick={() => {
                if (dirty && d !== day) void write();
                setDirty(false);
                setDay(d);
              }}
            >
              {d === today ? 'Dziś' : 'Wczoraj'}
            </button>
          ))}
        </span>
      </div>
      <p className="muted small">Przepisz podsumowanie dnia — wystarczą sumy. Możesz dodać zrzut ekranu.</p>

      <div className="nu-grid">
        {MACROS.map(([k, label, , unit]) => {
          const target = t?.[k];
          const v = vals[k];
          const st = macroStatus(k, v, target);
          const p = target && v != null ? Math.min(1, v / target) : 0;
          return (
            <label key={k} className={`nu-field nu-${st}`}>
              <span className="nu-label">
                {label} <span className="muted">({unit})</span>
              </span>
              <input
                className="input nu-input"
                inputMode="decimal"
                enterKeyHint="done"
                autoComplete="off"
                value={text[k]}
                placeholder={k === 'kcal' && hint ? fmt(hint) : '—'}
                aria-label={`${label} (${unit})`}
                onChange={(e) => {
                  setText({ ...text, [k]: e.target.value });
                  setDirty(true);
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
              {target ? (
                <>
                  <span className="nu-bar" role="progressbar" aria-label={`${label}: ${fmt(v) || 0} z ${fmt(target)} ${unit}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)}>
                    <i style={{ width: `${p * 100}%` }} />
                  </span>
                  <span className="nu-goal">
                    cel {fmt(target)}
                    {st === 'low' && ' · za mało'}
                    {st === 'high' && ' · za dużo'}
                  </span>
                </>
              ) : null}
            </label>
          );
        })}
      </div>
      {!hasT && <p className="muted small">Trener nie ustawił jeszcze celów — wpisy i tak zobaczy.</p>}

      <div className="nu-shot-row">
        {saved?.shot ? (
          <>
            <ShotThumb refId={saved.shot} alt={`Zrzut z Fitatu (${dayLabel})`} onOpen={() => setOpen(true)} />
            <div className="nu-shot-actions">
              <label className="btn btn-secondary btn-sm nu-file">
                <Icon name="cam" size={16} /> Zmień zrzut
                <input type="file" accept="image/*" disabled={!!busy} onChange={pick} />
              </label>
              <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => void removeShot()}>
                Usuń zrzut
              </button>
            </div>
          </>
        ) : (
          <label className={`btn btn-secondary nu-file nu-add ${busy === 'shot' ? 'is-busy' : ''}`}>
            <Icon name="image" size={18} /> {busy === 'shot' ? 'Wysyłam…' : 'Dodaj zrzut z Fitatu'}
            <input type="file" accept="image/*" aria-label="Dodaj zrzut z Fitatu" disabled={!!busy} onChange={pick} />
          </label>
        )}
      </div>

      <button type="button" className={`btn btn-block ${justSaved && !dirty ? 'btn-secondary nu-saved' : 'btn-primary'}`} disabled={(!dirty && !justSaved) || !!busy} onClick={() => void onSave()}>
        {busy === 'save' ? (
          'Zapisuję…'
        ) : justSaved && !dirty ? (
          <>
            <Icon name="check" size={18} /> Zapisano
          </>
        ) : saved && !dirty ? (
          'Zapisane'
        ) : (
          'Zapisz jedzenie'
        )}
      </button>
      {open && saved?.shot && <ShotSheet refId={saved.shot} title={`Zrzut z Fitatu (${dayLabel})`} onClose={() => setOpen(false)} />}
    </section>
  );
}
