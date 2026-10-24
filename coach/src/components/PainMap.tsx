import { useRef, type KeyboardEvent, type MouseEvent } from 'react';
import type { PainSpot } from '../domain';
import { PAIN_AREAS, painArea, painLabel, removePain, setPainLevel, spotKey, togglePain, type PainView } from '../lib/painMap';

interface Zone {
  area: string;
  side?: 'L' | 'P';
  x: number;
  y: number;
}

/** Punkty po stronie widza: lewa połowa (x < 60). Przód: lewa strona widza = prawa zawodnika. */
const RAW: Record<PainView, [string, number, number][]> = {
  front: [
    ['szyja', 60, 38],
    ['bark', 38, 50],
    ['klatka piersiowa', 60, 64],
    ['łokieć', 28, 92],
    ['brzuch', 60, 100],
    ['nadgarstek', 21, 126],
    ['biodro', 40, 124],
    ['pachwina', 53, 138],
    ['udo – przód', 49, 164],
    ['kolano', 48, 194],
    ['goleń', 47, 222],
    ['kostka', 46, 250],
    ['stopa', 42, 266],
  ],
  back: [
    ['szyja', 60, 38],
    ['bark', 38, 50],
    ['odcinek piersiowy', 60, 70],
    ['łokieć', 28, 92],
    ['odcinek lędźwiowy', 60, 112],
    ['nadgarstek', 21, 126],
    ['pośladek', 49, 136],
    ['udo – tył', 49, 166],
    ['kolano', 48, 194],
    ['łydka', 47, 220],
    ['ścięgno Achillesa', 46, 250],
  ],
};

function zonesOf(view: PainView): Zone[] {
  const out: Zone[] = [];
  for (const [area, x, y] of RAW[view]) {
    if (!painArea(area)?.sided) {
      out.push({ area, x, y });
      continue;
    }
    // przód: lewa połowa = prawa strona zawodnika; tył: lewa połowa = lewa strona
    const leftHalf: 'L' | 'P' = view === 'front' ? 'P' : 'L';
    const rightHalf: 'L' | 'P' = view === 'front' ? 'L' : 'P';
    out.push({ area, side: leftHalf, x, y }, { area, side: rightHalf, x: 120 - x, y });
  }
  return out;
}

const ZONES: Record<PainView, Zone[]> = { front: zonesOf('front'), back: zonesOf('back') };

function Body() {
  return (
    <g className="pm-body" aria-hidden="true">
      <circle cx="60" cy="18" r="13" />
      <rect x="54" y="28" width="12" height="16" rx="4" />
      <path d="M38 44 H82 Q88 46 86 56 L80 100 Q82 116 82 130 H38 Q38 116 40 100 L34 56 Q32 46 38 44 Z" />
      <polyline points="38,50 28,92 21,126" />
      <polyline points="82,50 92,92 99,126" />
      <polyline className="pm-leg" points="49,128 48,194 46,252 40,266" />
      <polyline className="pm-leg" points="71,128 72,194 74,252 80,266" />
    </g>
  );
}

/**
 * Mapa bólu: sylwetka przód/tył z punktami do dotknięcia i lista poziomów 0–10 pod spodem.
 * Strony L/P to strony zawodnika (na widoku z przodu lewa strona zawodnika jest po prawej).
 * `readOnly` — tylko podgląd (np. u trenera).
 */
export function PainMap({ spots, onChange, readOnly }: { spots: PainSpot[]; onChange?: (s: PainSpot[]) => void; readOnly?: boolean }) {
  const ro = readOnly || !onChange;
  const levelOf = new Map(spots.map((s) => [spotKey(s), s.level]));
  const svgs = useRef<Record<PainView, SVGSVGElement | null>>({ front: null, back: null });

  const toggle = (z: Zone) => {
    if (ro) return;
    onChange!(togglePain(spots, z.area, z.side));
  };

  // dotknięcie gdziekolwiek na sylwetce wybiera najbliższy punkt (większy cel niż samo kółko)
  const onSvgClick = (view: PainView) => (e: MouseEvent<SVGSVGElement>) => {
    const svg = svgs.current[view];
    if (ro || !svg) return;
    const m = svg.getScreenCTM();
    if (!m) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    let best: Zone | null = null;
    let bd = 22 * 22;
    for (const z of ZONES[view]) {
      const d = (z.x - p.x) ** 2 + (z.y - p.y) ** 2;
      if (d < bd) {
        bd = d;
        best = z;
      }
    }
    if (best) toggle(best);
  };

  const onKey = (z: Zone) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle(z);
    }
  };

  const figure = (view: PainView) => (
    <figure className="pm-fig">
      <svg
        ref={(el) => {
          svgs.current[view] = el;
        }}
        viewBox="0 0 120 276"
        role="group"
        aria-label={view === 'front' ? 'Sylwetka – przód' : 'Sylwetka – tył'}
        onClick={onSvgClick(view)}
      >
        <Body />
        <text className="pm-side" x="6" y="270">{view === 'front' ? 'P' : 'L'}</text>
        <text className="pm-side" x="114" y="270" textAnchor="end">{view === 'front' ? 'L' : 'P'}</text>
        {ZONES[view].map((z) => {
          const lv = levelOf.get(spotKey(z));
          const on = lv != null;
          return (
            <g
              key={spotKey(z) + view}
              className={'pm-zone' + (on ? ' on' : '')}
              role={ro ? undefined : 'button'}
              tabIndex={ro ? undefined : 0}
              aria-pressed={ro ? undefined : on}
              aria-label={painLabel(z) + (on ? `, ból ${lv}` : '')}
              onKeyDown={ro ? undefined : onKey(z)}
            >
              <circle cx={z.x} cy={z.y} r={on ? 7.5 : 5} style={on ? { fillOpacity: 0.35 + (lv || 0) * 0.065 } : undefined} />
              {on && (
                <text x={z.x} y={z.y + 3} textAnchor="middle" className="pm-lv">
                  {lv}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption>{view === 'front' ? 'Przód' : 'Tył'}</figcaption>
    </figure>
  );

  const sorted = [...spots].sort((a, b) => PAIN_AREAS.findIndex((x) => x.area === a.area) - PAIN_AREAS.findIndex((x) => x.area === b.area));
  const options = PAIN_AREAS.flatMap((a): { area: string; side?: 'L' | 'P' }[] => (a.sided ? (['L', 'P'] as const).map((side) => ({ area: a.area, side })) : [{ area: a.area }])).filter(
    (o) => !levelOf.has(spotKey(o)),
  );

  return (
    <div className={'painmap' + (ro ? ' ro' : '')}>
      <div className="pm-figs">
        {figure('front')}
        {figure('back')}
      </div>
      {!ro && <p className="pm-hint">Dotknij miejsca na sylwetce. L/P to Twoja lewa/prawa strona.</p>}
      {sorted.length === 0 ? (
        ro && <p className="pm-hint">Bez zaznaczonych miejsc.</p>
      ) : (
        <ul className="pm-list">
          {sorted.map((s) => (
            <li key={spotKey(s)}>
              <span className="pm-name">{painLabel(s)}</span>
              {ro ? (
                <span className="pm-num">{s.level}/10</span>
              ) : (
                <span className="pm-ctl">
                  <button type="button" aria-label={`Mniej, ${painLabel(s)}`} disabled={s.level <= 0} onClick={() => onChange!(setPainLevel(spots, s.area, s.side, s.level - 1))}>
                    −
                  </button>
                  <span className="pm-num" aria-live="polite">
                    {s.level}
                  </span>
                  <button type="button" aria-label={`Więcej, ${painLabel(s)}`} disabled={s.level >= 10} onClick={() => onChange!(setPainLevel(spots, s.area, s.side, s.level + 1))}>
                    +
                  </button>
                  <button type="button" className="pm-del" aria-label={`Usuń, ${painLabel(s)}`} onClick={() => onChange!(removePain(spots, s.area, s.side))}>
                    ×
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {!ro && options.length > 0 && (
        <select
          className="input pm-add"
          aria-label="Dodaj miejsce"
          value=""
          onChange={(e) => {
            const [area, side] = e.target.value.split('|');
            if (area) onChange!(setPainLevel(spots, area, (side || undefined) as 'L' | 'P' | undefined, 5));
          }}
        >
          <option value="">Dodaj miejsce z listy…</option>
          {options.map((o) => (
            <option key={spotKey(o)} value={spotKey(o)}>
              {painLabel(o)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
