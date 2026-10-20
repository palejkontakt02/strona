import { LOAD_PER_TEXT } from '../lib/run';

/** Hantle: ciężar wpisywany za 1 hantel albo suma obu — wybór przy ćwiczeniu (plan, zapis, odtwarzacz). */
export function LoadPerToggle({ value, onChange }: { value: 'one' | 'sum' | undefined; onChange: (v: 'one' | 'sum') => void }) {
  return (
    <div className="load-per">
      <span className="muted small">Ciężar:</span>
      <div className="seg seg-sm" role="radiogroup" aria-label="Ciężar: 1 hantel czy suma">
        {(['one', 'sum'] as const).map((v) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'active' : ''} onClick={() => onChange(v)}>
            {LOAD_PER_TEXT[v]}
          </button>
        ))}
      </div>
    </div>
  );
}
