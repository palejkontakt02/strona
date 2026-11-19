import { useEffect, useRef, type ReactNode } from 'react';
import { useDialog } from './useDialog';
import { initials } from '../format';

export type Tone = 'accent' | 'ok' | 'warn' | 'danger' | 'muted' | 'neutral';

export function Tag({ children, tone = 'neutral', outline }: { children: ReactNode; tone?: Tone; outline?: boolean }) {
  return <span className={`tag tag-${outline ? 'outline' : tone}`}>{children}</span>;
}

export function Dot({ tone }: { tone: Tone }) {
  return <span className={`dot dot-${tone}`} aria-hidden />;
}

export function Avatar({ name, size = 38 }: { name: string; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function Kpi({
  label,
  value,
  sub,
  tone,
  hint,
  onClick,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  /** Wyjaśnienie pojęcia (np. ACWR) — dymek i znak „?”. */
  hint?: string;
  /** Kafel klikalny — przejście do szczegółów. */
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={`card kpi ${tone ? `kpi-${tone}` : ''} ${onClick ? 'kpi-link' : ''}`} onClick={onClick} type={onClick ? 'button' : undefined}>
      <div className="kpi-label">
        {label}
        {hint && (
          <span className="kpi-hint" title={hint} tabIndex={0} aria-label={hint}>
            ?
          </span>
        )}
      </div>
      {hint && <div className="kpi-hint-text">{hint}</div>}
      <div className="kpi-value">{value}</div>
      {sub != null && <div className="kpi-sub">{sub}</div>}
    </Tag>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Card({ title, action, children, className = '' }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <div className="card-head">
          {title && <h4>{title}</h4>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Seg<T extends string>({ options, value, onChange, label }: { options: readonly T[]; value: T; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o} type="button" role="tab" aria-selected={value === o} className={value === o ? 'active' : ''} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  onSubmit,
  children,
  wide,
  submitLabel = 'Zapisz',
  extraActions,
}: {
  title: string;
  onClose: () => void;
  onSubmit?: () => void;
  children: ReactNode;
  wide?: boolean;
  submitLabel?: string;
  extraActions?: ReactNode;
}) {
  const ref = useRef<HTMLFormElement>(null);
  useDialog(ref, onClose);
  useEffect(() => {
    document.body.classList.add('no-scroll');
    return () => document.body.classList.remove('no-scroll');
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        ref={ref}
        tabIndex={-1}
        className={`card modal ${wide ? 'modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit?.();
        }}
      >
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="icon-btn" aria-label="Zamknij" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-actions">
          {extraActions}
          <span className="grow" />
          <span className="modal-actions-main">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              {onSubmit ? 'Anuluj' : 'Zamknij'}
            </button>
            {onSubmit && (
              <button type="submit" className="btn btn-primary">
                {submitLabel}
              </button>
            )}
          </span>
        </div>
      </form>
    </div>
  );
}

export function Field({ label, children, wide, hint }: { label: string; children: ReactNode; wide?: boolean; hint?: ReactNode }) {
  return (
    <label className={`field ${wide ? 'field-wide' : ''}`}>
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

/**
 * Zestaw ikon Fitowej (DESIGN.md, „Ikony”): siatka 24, kreska 2,25, końce i narożniki kwadratowe (square / miter),
 * kształty z prostych odcinków i kątów 90° / 45°; łuki tylko tam, gdzie przedmiot jest okrągły (zegar, głowa, talerz).
 * Rysunek trzyma się pola 3–21, żeby kwadratowe końce nie wychodziły poza siatkę. Kolor = kolor tekstu.
 */
const ICONS: Record<string, ReactNode> = {
  dash: <path d="M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z" />,
  cal: <path d="M4 6h16v14H4zM4 10.5h16M8.5 3.5v4M15.5 3.5v4M8 14h2M14 14h2M8 17h2" />,
  calendar: <path d="M4 6h16v14H4zM4 10.5h16M8.5 3.5v4M15.5 3.5v4M8 14h2M14 14h2M8 17h2" />,
  users: <path d="M6 4.5h6v6H6zM3.5 20v-4.5h11V20M15 4.5h4.5v5H17M17 14.5h3.5V19" />,
  money: <path d="M3 6.5h18v11H3zM12 9.5v5M6.5 12h.01M17.5 12h.01" />,
  lib: <path d="M3 12h2M19 12h2M5.5 8.5v7M18.5 8.5v7M8.5 6v12M15.5 6v12M8.5 12h7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  x: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  up: <path d="M12 20V5M6 11l6-6 6 6" />,
  trash: <path d="M4 7h16M9.5 7V4h5v3M6.5 7l1 13h9l1-13M10.5 11v5.5M13.5 11v5.5" />,
  copy: <path d="M9 9h11v11H9zM15 9V4H4v11h5" />,
  edit: <path d="M4 20l1-5L15.5 4.5l4 4L9 19zM13 7l4 4" />,
  chevL: <path d="M14.5 6l-6 6 6 6" />,
  chevR: <path d="M9.5 6l6 6-6 6" />,
  chevD: <path d="M6 9.5l6 6 6-6" />,
  chevU: <path d="M6 14.5l6-6 6 6" />,
  play: <path d="M7 4.5v15L19 12z" fill="currentColor" />,
  cam: <path d="M3 7h12v10H3zM15 10.5l6-3v9l-6-3" />,
  eye: <path d="M2.5 12L7 6.5h10l4.5 5.5-4.5 5.5H7zM10.5 10.5h3v3h-3z" />,
  check: <path d="M4.5 12.5l4.5 4.5L19.5 6.5" />,
  alert: <path d="M12 3.5l9 16.5H3zM12 10v4.5M12 17.2v.01" />,
  more: <path d="M5.5 12h.01M12 12h.01M18.5 12h.01" />,
  user: <path d="M9 4h6v6.5H9zM4.5 20.5V16h15v4.5" />,
  settings: <path d="M10 3.5h4l.6 2.6 1.9 1.1 2.6-.8 2 3.4-2 1.9v2.6l2 1.9-2 3.4-2.6-.8-1.9 1.1-.6 2.6h-4l-.6-2.6-1.9-1.1-2.6.8-2-3.4 2-1.9v-2.6l-2-1.9 2-3.4 2.6.8 1.9-1.1zM10 10h4v4h-4z" />,
  repeat: <path d="M4 11V7h13M14 4l3 3-3 3M20 13v4H7M10 20l-3-3 3-3" />,
  // monochromatyczne piktogramy zamiast emoji (dziedziczą kolor tekstu)
  run: (
    <>
      <path d="M13.5 3h3v3h-3z" />
      <path d="M13 8.5l-3 5 3.5 2.5-1.5 5M10 13.5l-2 3.5H4M13 8.5l3 3.5h4M13 8.5H9l-2.5 3" />
    </>
  ),
  heart: <path d="M12 20l-8-8V7.5L7.5 4H10l2 2 2-2h2.5L20 7.5V12z" />,
  clipboard: <path d="M5 4.5h14V21H5zM9 3h6v3.5H9zM8.5 11h7M8.5 15h4.5" />,
  mail: <path d="M3 5.5h18v13H3zM3.5 6.5l8.5 6.5 8.5-6.5" />,
  timer: (
    <>
      <circle cx="12" cy="13.5" r="7" />
      <path d="M12 10v4h3M9.5 3h5M12 3v3.5M18.5 6.5l1.5-1.5" />
    </>
  ),
  flame: <path d="M12 21a7 7 0 0 0 7-7c0-4.5-3.5-7-5-11-1.5 3-2 4.5-3.5 6L9 6.5C6.5 8.5 5 11 5 14a7 7 0 0 0 7 7z" />,
  trophy: <path d="M7.5 4h9v6.5L14 13h-4l-2.5-2.5zM7.5 6.5H4V9l3.5 2.5M16.5 6.5H20V9l-3.5 2.5M12 13v5M8 20.5h8" />,
  link: <path d="M10 14l4-4M8 11.5L5 14.5a3.2 3.2 0 0 0 4.5 4.5l3-3M16 12.5l3-3A3.2 3.2 0 0 0 14.5 5l-3 3" />,
  image: <path d="M3.5 4.5h17v15h-17zM3.5 16l5-5 4.5 4.5 2.5-2.5 5 5M14.5 8h2v2h-2z" />,
  photo: (
    <>
      <path d="M3 7.5h4l2-3h6l2 3h4V20H3z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </>
  ),
  clip: <path d="M19.5 11.5l-8 8a4.6 4.6 0 0 1-6.5-6.5l8.5-8.5a3.2 3.2 0 0 1 4.5 4.5l-8 8a1.8 1.8 0 0 1-2.5-2.5l7.5-7.5" />,
  watch: <path d="M6.5 6.5h11v11h-11zM9 6.5l1-3.5h4l1 3.5M9 17.5l1 3.5h4l1-3.5M12 9.5V12h2" />,
  print: <path d="M7 9V3.5h10V9M7 17.5H3.5V9h17v8.5H17M7 14h10v6.5H7z" />,
  chat: <path d="M3.5 4.5h17v11.5H10l-5 4v-4H3.5z" />,
  star: <path d="M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4l-5.5 2.9 1-6.2L3 9.7l6.2-.9z" />,
  dumbbell: <path d="M5 7v10M2.5 9.5v5M19 7v10M21.5 9.5v5M5 12h14" />,
  // rozmowa: głos, pauza, stop, pobieranie
  mic: <path d="M9 3.5h6V13H9zM5.5 11v2.5L8 17h8l2.5-3.5V11M12 17v3.5M8.5 20.5h7" />,
  pause: <path d="M8 5v14M16 5v14" />,
  stop: <path d="M6 6h12v12H6z" fill="currentColor" />,
  download: <path d="M12 4v10.5M7 9.5l5 5 5-5M4.5 20h15" />,
  lock: <path d="M5 11h14v10H5zM8 11V7l2-3h4l2 3v4M12 14.5v3" />,
};

export function Icon({ name, size = 18 }: { name: keyof typeof ICONS | string; size?: number }) {
  // vertical-align: w zwykłym tekście ikona siada na linii pisma; we flexie (przyciski) nie ma znaczenia
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="square"
      strokeLinejoin="miter"
      strokeMiterlimit={10}
      aria-hidden
      style={{ verticalAlign: '-0.18em', flexShrink: 0 }}
    >
      {ICONS[name]}
    </svg>
  );
}

export function IconBtn({ icon, label, onClick, danger }: { icon: string; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" className={`icon-btn ${danger ? 'icon-btn-danger' : ''}`} aria-label={label} title={label} onClick={onClick}>
      <Icon name={icon} size={16} />
    </button>
  );
}
