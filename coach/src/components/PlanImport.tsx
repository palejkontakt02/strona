import { useMemo, useState } from 'react';
import type { Plan } from '../domain';
import { fmtDate, plural } from '../format';
import { todayISO } from '../lib/dates';
import { nextMonday } from '../lib/analytics';
import { detectColumns, FIELD_LABEL, parseTable, SHEET_FIELDS, sheetToPlan, type SheetField } from '../lib/sheetImport';
import { readXlsx } from '../lib/xlsxRead';
import { Field, Modal } from './ui';

const SAMPLE = 'Tydzień\tDzień\tTrening\tĆwiczenie\tSerie\tPowt.\tCiężar\tRPE\n1\tpon\tA\tPrzysiad\t4\t6\t100\t8';

/**
 * Import planu z arkusza: wklejony zakres (Excel / Google Sheets) albo plik .csv / .xlsx →
 * przypisanie kolumn z podglądem → nowy plan w edytorze (do poprawy przed zapisem).
 */
export function PlanImport({ clientId, active, onClose, onDone }: { clientId: string; active: boolean; onClose: () => void; onDone: (plan: Plan) => void }) {
  const [text, setText] = useState('');
  const [fileRows, setFileRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState('');
  const [err, setErr] = useState('');
  const [map, setMap] = useState<SheetField[] | null>(null);
  const [header, setHeader] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [start, setStart] = useState(nextMonday(todayISO()));
  // domyślnie aktywny, gdy klient nie ma aktywnego planu albo aktywny już się zakończył
  const [makeActive, setMakeActive] = useState(active);

  const rows = useMemo(() => fileRows ?? (text.trim() ? parseTable(text) : null), [fileRows, text]);
  const guess = useMemo(() => (rows ? detectColumns(rows) : null), [rows]);
  const cols = map ?? guess?.map ?? [];
  const headerRow = header ?? guess?.headerRow ?? -1;
  const result = useMemo(() => (rows && cols.includes('exercise') ? sheetToPlan(rows, cols, headerRow, { clientId, name: name || undefined, startDate: start, today: todayISO() }) : null), [rows, cols, headerRow, clientId, name, start]);
  const reset = () => {
    setMap(null);
    setHeader(null);
    setErr('');
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    reset();
    setFileName(f.name.replace(/\.[^.]+$/, ''));
    setName(f.name.replace(/\.[^.]+$/, ''));
    try {
      if (/\.xlsx$/i.test(f.name)) setFileRows(await readXlsx(await f.arrayBuffer()));
      else if (/\.xls$/i.test(f.name)) throw new Error('Stary format .xls — zapisz arkusz jako .xlsx albo CSV.');
      else setFileRows(parseTable(await f.text()));
    } catch (e) {
      setFileRows(null);
      setErr(e instanceof Error ? e.message : 'Nie udało się odczytać pliku.');
    }
  };

  const preview = rows ? rows.slice(Math.max(0, headerRow), Math.max(0, headerRow) + 6) : [];
  const firstWeek = result?.plan.weeks[0];

  return (
    <Modal
      wide
      title="Import planu z arkusza"
      onClose={onClose}
      submitLabel="Otwórz w edytorze"
      onSubmit={() => {
        if (!result || !result.stats.exercises) return setErr('Nie rozpoznano żadnego ćwiczenia — sprawdź przypisanie kolumny „Ćwiczenie”.');
        onDone({ ...result.plan, active: makeActive });
      }}
    >
      <p className="muted small">
        Skopiuj zakres w Excelu albo Arkuszach Google (z nagłówkami) i wklej poniżej, albo wybierz plik CSV / XLSX. Kolumny: Tydzień, Dzień, Trening, Ćwiczenie, Serie, Powt., Ciężar, RPE, Przerwa, Uwagi — w dowolnej kolejności. Wystarczy też jedna kolumna z zapisem „Przysiad 4x6 @RPE8 100kg”.
      </p>
      <div className="pi-src">
        <Field label="Wklej zakres z arkusza" wide>
          <textarea
            className="input pi-paste"
            rows={4}
            value={text}
            placeholder={SAMPLE}
            onChange={(e) => {
              reset();
              setFileRows(null);
              setFileName('');
              setText(e.target.value);
            }}
          />
        </Field>
        <label className="btn btn-secondary btn-sm pi-file">
          Wybierz plik…
          <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        {fileName && <span className="muted small">Plik: {fileName}</span>}
      </div>
      {err && <p className="pi-error small" role="alert">{err}</p>}

      {rows && rows.length > 0 && (
        <>
          <div className="pi-head-row">
            <strong>Przypisanie kolumn</strong>
            <label className="pi-header-pick small">
              Nagłówki w wierszu{' '}
              <select className="input input-sm" value={headerRow} onChange={(e) => setHeader(Number(e.target.value))}>
                <option value={-1}>brak</option>
                {rows.slice(0, 10).map((_, i) => (
                  <option key={i} value={i}>
                    {i + 1}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="pi-scroll">
            <table className="pi-table">
              <thead>
                <tr>
                  {cols.map((f, j) => (
                    <th key={j}>
                      <select
                        className={`input input-sm ${f === 'skip' ? 'is-skip' : ''}`}
                        aria-label={`Kolumna ${j + 1}`}
                        value={f}
                        onChange={(e) => {
                          const v = e.target.value as SheetField;
                          // jedno pole = jedna kolumna: poprzednia kolumna z tym polem → pomiń
                          setMap(cols.map((x, i) => (i === j ? v : x === v && v !== 'skip' ? 'skip' : x)));
                        }}
                      >
                        {SHEET_FIELDS.map((x) => (
                          <option key={x} value={x}>
                            {FIELD_LABEL[x]}
                          </option>
                        ))}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i} className={i === 0 && headerRow >= 0 ? 'pi-hdr' : ''}>
                    {cols.map((f, j) => (
                      <td key={j} className={f === 'skip' ? 'is-skip' : ''}>
                        {r[j]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!cols.includes('exercise') && <p className="warn-box small">Wskaż kolumnę „Ćwiczenie”.</p>}
        </>
      )}

      {result && (
        <>
          <div className="form-grid form-grid-2 pi-meta">
            <Field label="Nazwa planu">
              <input className="input" value={name} placeholder="Plan z arkusza" onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Start" hint={result.plan.startDate !== start ? `Z dat w arkuszu: ${fmtDate(result.plan.startDate)}` : undefined}>
              <input className="input" type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} />
            </Field>
          </div>
          <label className="check pi-active">
            <input type="checkbox" checked={makeActive} onChange={(e) => setMakeActive(e.target.checked)} /> Ustaw jako aktywny
            <span className="muted small">{makeActive ? ' — podopieczny zobaczy go jako swój plan po zapisaniu' : ' — zapisze się obok obecnego planu'}</span>
          </label>
          <p className="pi-stats">
            <span className="pt-num">{result.stats.weeks}</span> {plural(result.stats.weeks, 'tydzień', 'tygodnie', 'tygodni')} · <span className="pt-num">{result.stats.workouts}</span> {plural(result.stats.workouts, 'jednostka', 'jednostki', 'jednostek')} · <span className="pt-num">{result.stats.exercises}</span> {plural(result.stats.exercises, 'ćwiczenie', 'ćwiczenia', 'ćwiczeń')}
          </p>
          {result.warnings.map((w) => (
            <p key={w} className="warn-box small pi-warn">
              {w}
            </p>
          ))}
          {firstWeek && (
            <div className="pi-preview">
              <span className="eyebrow">{firstWeek.name} — podgląd</span>
              {firstWeek.workouts.slice(0, 4).map((k) => (
                <div key={k.id} className="pi-wo">
                  <strong>{k.name}</strong>
                  <ul>
                    {k.exercises.slice(0, 6).map((e) => {
                      const work = e.groups.filter((g) => g.type !== 'Rozgrzewka');
                      const g = work[0] ?? e.groups[0];
                      return (
                        <li key={e.id}>
                          {e.linked ? '+ ' : ''}
                          {e.name} <span className="muted">· {work.length} × {g?.reps || '?'}{g?.load ? ` · ${/%/.test(g.load) ? g.load : `${g.load.replace('.', ',')} kg`}` : ''}{g?.rpe ? ` · RPE ${g.rpe.replace('.', ',')}` : ''}</span>
                        </li>
                      );
                    })}
                    {k.exercises.length > 6 && <li className="muted">i {k.exercises.length - 6} więcej</li>}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <p className="muted small">Plan otworzy się w edytorze — popraw go i zapisz. Nic nie zapisze się, dopóki nie klikniesz „Zapisz”.</p>
        </>
      )}
    </Modal>
  );
}
