import { useState } from 'react';
import { getPalette, PALETTES, setPalette, type PaletteId } from '../theme';

/** Wybór motywu kolorystycznego (zapisywany na tym urządzeniu) — u trenera w ustawieniach, u podopiecznego w „Wygląd”. */
export function PalettePicker() {
  const [palette, setPal] = useState<PaletteId>(getPalette());
  return (
    <div className="palettes" role="radiogroup" aria-label="Motyw kolorystyczny">
      {PALETTES.map((p) => (
        <button
          key={p.id}
          type="button"
          role="radio"
          aria-checked={palette === p.id}
          className={`palette ${palette === p.id ? 'active' : ''}`}
          onClick={() => {
            setPalette(p.id);
            setPal(p.id);
          }}
        >
          <span className="swatch" style={{ background: p.bg }}>
            <i style={{ background: p.accent }} />
          </span>
          {p.name}
        </button>
      ))}
    </div>
  );
}
