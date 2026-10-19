import { useEffect, useRef, useState } from 'react';
import { useStore } from '../data/store';
import { deleteClientFile, fileProblem, fileUrl, fmtSize, isImage, saveClientFile } from '../data/files';
import { fmtDay, uid } from '../format';
import { FILE_KINDS, type FileKind, type IntakeFile } from '../lib/intake';
import { IconBtn } from './ui';

/** Adresy plików (podpisane linki w chmurze, ważne godzinę) — ładowane raz na listę. */
function useFileUrls(files: IntakeFile[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = files.map((f) => f.ref).join('|');
  useEffect(() => {
    let off = false;
    const made: string[] = [];
    void Promise.all(
      files.map(async (f) => {
        try {
          const u = await fileUrl(f.ref);
          if (u.startsWith('blob:')) made.push(u);
          return [f.ref, u] as const;
        } catch {
          return [f.ref, ''] as const;
        }
      }),
    ).then((pairs) => !off && setUrls(Object.fromEntries(pairs)));
    return () => {
      off = true;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return urls;
}

/**
 * Zdjęcia i dokumenty w ankiecie: dodawanie (aparat albo plik / galeria, kilka naraz), rodzaj,
 * podgląd, usuwanie. `onChange` dostaje nową listę; pliki są wysyłane od razu.
 */
export function ClientFiles({ clientId, files, onChange, editable = true }: { clientId: string; files: IntakeFile[]; onChange?: (f: IntakeFile[]) => void; editable?: boolean }) {
  const { toast, ask } = useStore();
  const [busy, setBusy] = useState(0);
  const pick = useRef<HTMLInputElement>(null);
  const cam = useRef<HTMLInputElement>(null);
  const urls = useFileUrls(files);
  const latest = useRef(files);
  latest.current = files;

  const add = async (list: FileList | null) => {
    if (!list?.length || !onChange) return;
    const all = [...list];
    if (latest.current.length + all.length > 30) return toast('Najwyżej 30 plików w ankiecie.');
    const bad = all.map(fileProblem).filter(Boolean);
    if (bad.length) toast(bad.join(' '));
    const ok = all.filter((f) => !fileProblem(f));
    setBusy((b) => b + ok.length);
    for (const f of ok) {
      try {
        const saved = await saveClientFile(f, clientId);
        const kind: FileKind = isImage(saved.type, f.name) ? 'Zdjęcie sylwetki / postawy' : 'Wyniki badań';
        onChange((latest.current = [...latest.current, { id: uid(), ref: saved.ref, name: f.name.slice(0, 120) || 'plik', type: saved.type, size: saved.size, at: new Date().toISOString(), kind }]));
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        toast(msg === 'BUCKET' ? 'Pliki w chmurze wymagają aktualizacji bazy po stronie trenera (Supabase, sekcja 18 w hardening.sql).' : `Nie udało się wysłać „${f.name}”. Sprawdź połączenie i spróbuj ponownie.`);
      } finally {
        setBusy((b) => b - 1);
      }
    }
  };
  const remove = async (f: IntakeFile) => {
    if (!onChange || !(await ask(`Usunąć „${f.name}”?`, { confirm: 'Usuń' }))) return;
    onChange((latest.current = latest.current.filter((x) => x.id !== f.id)));
    void deleteClientFile(f.ref);
  };
  const setKind = (f: IntakeFile, kind: FileKind) => onChange?.((latest.current = latest.current.map((x) => (x.id === f.id ? { ...x, kind } : x))));

  return (
    <div className="cfiles">
      {files.length > 0 && (
        <ul className="cfiles-list">
          {files.map((f) => {
            const u = urls[f.ref];
            const img = isImage(f.type, f.name);
            return (
              <li key={f.id} className="cfile">
                <a className="cfile-thumb" href={u || undefined} target="_blank" rel="noreferrer" aria-label={`Otwórz ${f.name}`} onClick={(e) => !u && e.preventDefault()}>
                  {img && u ? <img src={u} alt={f.name} loading="lazy" /> : <span className="cfile-icon">{img ? '🖼' : 'PDF'}</span>}
                </a>
                <div className="cfile-info">
                  <a className="cfile-name" href={u || undefined} target="_blank" rel="noreferrer" onClick={(e) => !u && e.preventDefault()}>
                    {f.name}
                  </a>
                  <span className="muted small">
                    {fmtSize(f.size)} · {fmtDay(f.at.slice(0, 10))}
                  </span>
                  {editable ? (
                    <select className="input input-sm" value={f.kind ?? 'Inne'} onChange={(e) => setKind(f, e.target.value as FileKind)} aria-label={`Rodzaj: ${f.name}`}>
                      {FILE_KINDS.map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </select>
                  ) : (
                    f.kind && <span className="tag tag-neutral">{f.kind}</span>
                  )}
                </div>
                {editable && <IconBtn icon="trash" label={`Usuń ${f.name}`} danger onClick={() => void remove(f)} />}
              </li>
            );
          })}
        </ul>
      )}
      {editable && (
        <div className="cfiles-add">
          <input ref={pick} type="file" accept="image/*,application/pdf,.pdf,.heic,.heif" multiple hidden onChange={(e) => (void add(e.target.files), (e.target.value = ''))} />
          <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (void add(e.target.files), (e.target.value = ''))} />
          <button type="button" className="btn btn-secondary" onClick={() => cam.current?.click()} disabled={busy > 0}>
            📷 Zrób zdjęcie
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => pick.current?.click()} disabled={busy > 0}>
            📎 Dodaj plik / zdjęcie
          </button>
          {busy > 0 && <span className="muted small">Wysyłanie… ({busy})</span>}
        </div>
      )}
    </div>
  );
}
