import { useState } from 'react';
import { Empty, IconBtn } from '../components/ui';
import { EXERCISE_CATEGORIES } from '../domain';
import { useStore } from '../data/store';
import { normalize, uid, nEx } from '../format';
import { put } from '../data/db';
import { missingFromAtlas } from '../data/atlas';
import { useNav } from '../nav';

export function LibraryView() {
  const { db, apply } = useStore();
  const missing = missingFromAtlas(db.library.map((e) => e.name));
  const { openModal } = useNav();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const list = db.library
    .filter((e) => (!cat || e.cat === cat) && normalize(e.name).includes(normalize(q.trim())))
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  const grouped = EXERCISE_CATEGORIES.map((c) => ({ c, items: list.filter((e) => e.cat === c) })).filter((g) => g.items.length);

  return (
    <div className="page fade">
      <div className="page-head">
        <div>
          <h2>Biblioteka ćwiczeń</h2>
          <p className="muted small">{nEx(db.library.length)} · podpowiadane przy tworzeniu planów i zapisie treningu</p>
        </div>
        <div className="actions">
          {missing.length > 0 && (
            <button
              className="btn btn-secondary"
              onClick={() => apply(missing.map(([name, cat]) => put('library', { id: uid(), name, cat })), `Dodano ${nEx(missing.length)} z atlasu.`)}
              title="Ćwiczenia siłowe, dwubojowe, plyometryczne, kondycyjne i rehabilitacyjne — nazwy po angielsku"
            >
              + Atlas ćwiczeń ({missing.length})
            </button>
          )}
          <button className="btn btn-primary" onClick={() => openModal({ kind: 'exercise' })}>
            + Ćwiczenie
          </button>
        </div>
      </div>
      <div className="filters">
        <input className="input input-sm" type="search" placeholder="Szukaj ćwiczenia…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input input-sm" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Kategoria">
          <option value="">Wszystkie kategorie</option>
          {EXERCISE_CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      {grouped.length === 0 && <Empty>Brak ćwiczeń.</Empty>}
      <div className="lib-grid">
        {grouped.map(({ c, items }) => (
          <section key={c} className="card">
            <div className="card-head">
              <h4>{c}</h4>
              <span className="muted small">{items.length}</span>
            </div>
            <ul className="rows">
              {items.map((e) => (
                <li key={e.id} className="row">
                  <span className="grow">{e.name}</span>
                  {e.video && (
                    <a href={e.video} target="_blank" rel="noreferrer" className="small">
                      wideo ↗
                    </a>
                  )}
                  <IconBtn icon="edit" label={`Edytuj ${e.name}`} onClick={() => openModal({ kind: 'exercise', exercise: e })} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
