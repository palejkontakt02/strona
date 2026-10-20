import type { RunProfile, SetGroup, SetType } from '../domain';
import { fmtDur, fmtKm, parseDur, parseKm, planRunTotals, RUN_TEMPLATES, targetText, ZONES } from '../lib/running';
import { IconBtn } from './ui';

/** Rodzaje odcinków biegu (typ wiersza planu) z nazwami dla biegacza. */
export const SEGMENTS: { type: SetType; label: string; short: string }[] = [
  { type: 'Rozgrzewka', label: 'Rozgrzewka', short: 'R' },
  { type: 'Robocze', label: 'Bieg / odcinki', short: '' },
  { type: 'Przerwa', label: 'Trucht / marsz (przerwa)', short: 'P' },
  { type: 'Schłodzenie', label: 'Schłodzenie', short: 'S' },
];

const blank = (type: SetType, patch: Partial<SetGroup> = {}): SetGroup => ({ type, sets: '1', reps: '', load: '', rpe: '', ...patch });

/** Podpowiedzi celu: strefy, zakresy polskiej szkoły, tempa startowe. */
export function RunTargetList() {
  return (
    <datalist id="run-zones">
      {ZONES.map((z) => (
        <option key={z.z} value={z.z}>
          {z.name}
        </option>
      ))}
      {['OWB1', 'OWB2', 'BC1', 'BC2', 'BC3', '5K', '10K', 'HM', 'M', '5:30', '5:20–5:40', '140–150', '<145'].map((v) => (
        <option key={v} value={v} />
      ))}
    </datalist>
  );
}

/**
 * Kreator biegu: odcinki ułożone po kolei, każdy z własnym typem, liczbą powtórzeń, czasem
 * lub dystansem, celem (strefa, tempo, tętno, tempo startowe), przerwą po każdym powtórzeniu i RPE.
 */
export function RunBuilder({ groups, onChange, profile, dob }: { groups: SetGroup[]; onChange: (g: SetGroup[]) => void; profile?: RunProfile; dob?: string }) {
  const set = (i: number, patch: Partial<SetGroup>) => onChange(groups.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const tot = planRunTotals(groups, profile);
  return (
    <div className="rb">
      {groups.length === 0 && <p className="muted small">Dodaj pierwszy odcinek poniżej.</p>}
      {groups.map((g, i) => {
        const n = Math.max(1, parseInt(g.sets || '1', 10) || 1);
        const tgt = targetText(g.pace, profile, dob);
        return (
          <div key={i} className={`rb-seg rb-${SEGMENTS.find((x) => x.type === g.type)?.short || 'B'}`}>
            <div className="rb-top">
              <span className="rb-no">{i + 1}</span>
              <select className="input input-sm" value={SEGMENTS.some((x) => x.type === g.type) ? g.type : 'Robocze'} onChange={(e) => set(i, { type: e.target.value as SetType })} aria-label={`Rodzaj odcinka ${i + 1}`}>
                {SEGMENTS.map((x) => (
                  <option key={x.type} value={x.type}>
                    {x.label}
                  </option>
                ))}
              </select>
              <label className="rb-reps">
                <input className="input input-sm" inputMode="numeric" value={g.sets ?? '1'} onChange={(e) => set(i, { sets: e.target.value.replace(/[^\d]/g, '').slice(0, 2) })} onBlur={() => !(parseInt(g.sets || '', 10) > 0) && set(i, { sets: '1' })} aria-label={`Powtórzenia odcinka ${i + 1}`} />
                <span>×</span>
              </label>
              <span className="grow" />
              <IconBtn icon="up" label={`Odcinek ${i + 1} w górę`} onClick={() => i > 0 && onChange(groups.map((x, j) => (j === i - 1 ? groups[i] : j === i ? groups[i - 1] : x)))} />
              <IconBtn icon="copy" label={`Powiel odcinek ${i + 1}`} onClick={() => onChange([...groups.slice(0, i + 1), { ...g }, ...groups.slice(i + 1)])} />
              <IconBtn icon="trash" label={`Usuń odcinek ${i + 1}`} danger onClick={() => onChange(groups.filter((_, j) => j !== i))} />
            </div>
            <div className="rb-grid">
              <label className="field">
                <span>Czas</span>
                <input className="input" value={g.reps} placeholder="min lub m:ss" onChange={(e) => set(i, { reps: e.target.value })} />
              </label>
              <label className="field">
                <span>Dystans</span>
                <input className="input" value={g.load} placeholder="km lub 400 m" onChange={(e) => set(i, { load: e.target.value })} />
              </label>
              <label className="field">
                <span>Cel</span>
                <input className="input" list="run-zones" value={g.pace ?? ''} placeholder="Z2, 5:30, 140–150, 10K" onChange={(e) => set(i, { pace: e.target.value || undefined })} />
              </label>
              <label className="field">
                <span>RPE</span>
                <input className="input" inputMode="decimal" value={g.rpe} placeholder="1–10" onChange={(e) => set(i, { rpe: e.target.value })} />
              </label>
              {(n > 1 || g.rest) && (
                <label className="field rb-rest">
                  <span>Przerwa po każdym</span>
                  <input className="input" value={g.rest ?? ''} placeholder="np. 2:00 trucht, 200 m trucht, 1:00 marsz" onChange={(e) => set(i, { rest: e.target.value || undefined })} />
                </label>
              )}
            </div>
            {g.reps.trim() && parseDur(g.reps) == null && <p className="small warn-text rb-tgt">Czas „{g.reps}” — wpisz minuty (40), m:ss (3:05) albo godziny (1:20:00).</p>}
            {g.load.trim() && parseKm(g.load) == null && <p className="small warn-text rb-tgt">Dystans „{g.load}” — wpisz km (5, 21,1) albo metry (400 m).</p>}
            {(() => {
              // „1:20” to minuty:sekundy — przy długim odcinku łatwo pomylić z godzinami
              const d = parseDur(g.reps);
              const km = parseKm(g.load);
              if (d == null || !/^\d{1,2}:\d{2}$/.test(g.reps.trim())) return null;
              if (km && km >= 0.8 && d / km < 2.4) return <p className="small warn-text rb-tgt">„{g.reps.trim()}” to {fmtDur(d)} — za szybko na {fmtKm(km)}. Godziny wpisz jako 1:20:00 albo 80.</p>;
              if (!km && n === 1 && d < 6 && g.type !== 'Przerwa') return <p className="muted small rb-tgt">„{g.reps.trim()}” = {fmtDur(d)}. Jeśli godziny — wpisz 1:20:00 albo 80.</p>;
              return null;
            })()}
            {tgt && <p className="muted small rb-tgt">{tgt}</p>}
          </div>
        );
      })}
      <div className="rb-add">
        <span className="muted small">Dodaj:</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...groups, blank('Rozgrzewka', { reps: '15', pace: 'Z2' })])}>
          + rozgrzewka
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...groups, blank('Robocze')])}>
          + bieg ciągły
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...groups, blank('Robocze', { sets: '6', rest: '2:00 trucht' })])}>
          + odcinki (×)
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...groups, blank('Przerwa', { reps: '3:00', pace: 'Z1' })])}>
          + trucht / marsz
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...groups, blank('Schłodzenie', { reps: '10', pace: 'Z1' })])}>
          + schłodzenie
        </button>
        <select
          className="input input-sm"
          value=""
          aria-label="Wstaw szablon (do zmiany)"
          onChange={(e) => {
            const t = RUN_TEMPLATES.find((x) => x.id === e.target.value);
            if (t) onChange([...groups.filter((x) => x.reps || x.load || x.pace), ...t.make().groups]);
          }}
        >
          <option value="">szablon…</option>
          {RUN_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      {(tot.km > 0 || tot.min > 0) && (
        <p className="small rb-total">
          Razem {tot.approx ? 'ok. ' : ''}
          {tot.km > 0 && <b>{fmtKm(tot.km)}</b>}
          {tot.km > 0 && tot.min > 0 && ' · '}
          {tot.min > 0 && <b>{fmtDur(tot.min)}</b>}
          {tot.approx && <span className="muted"> (brakujące z tempa celu)</span>}
        </p>
      )}
    </div>
  );
}
