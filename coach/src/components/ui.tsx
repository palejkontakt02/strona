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

const ICONS: Record<string, ReactNode> = {
  dash: <path d="M3 13h8V3H3zM13 21h8V11h-8zM13 3v6h8V3zM3 21h8v-6H3z" />,
  cal: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  users: <path d="M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-4 3-6 7-6s7 2 7 6M17 11a3 3 0 1 0 0-6M22 21c0-3-2-5-4-5.5" />,
  money: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 10v4M18 10v4" />
    </>
  ),
  lib: <path d="M2 12h3M19 12h3M5 8v8M19 8v8M8 6v12M16 6v12M8 12h8" />,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  up: <path d="M12 19V5M5 12l7-7 7 7" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
    </>
  ),
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />,
  chevL: <path d="M15 6l-6 6 6 6" />,
  chevR: <path d="M9 6l6 6-6 6" />,
  chevD: <path d="M6 9l6 6 6-6" />,
  play: <path d="M7 5l12 7-12 7z" />,
  cam: <path d="M3 7h12v10H3zM15 10.5l6-3.5v10l-6-3.5" />,
  eye: <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />,
  check: <path d="M5 12l5 5L20 7" />,
  alert: <path d="M12 3l10 18H2zM12 10v5M12 18v.5" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
  user: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6" />,
  settings: <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-2-4-2 1-2-1V5h-4v2l-2 1-2-1-2 4 2 1v0l-2 1 2 4 2-1 2 1v2h4v-2l2-1 2 1 2-4z" />,
  // monochromatyczne piktogramy zamiast emoji (dziedziczą kolor tekstu)
  run: (
    <>
      <circle cx="15" cy="4.5" r="2" />
      <path d="M14 8l-3 5 3 3-1 5M11 13l-2 4-4 1M14 8l3 3h3M14 8l-4 1-2 2.5" />
    </>
  ),
  heart: <path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z" />,
  clipboard: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 2.5h6v3H9zM9 11h6M9 15h4" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.5 7l8.5 6 8.5-6" />
    </>
  ),
  timer: (
    <>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 10v3.5l2.5 2M9.5 2.5h5M12 2.5V6M19 6l1.5-1.5" />
    </>
  ),
  flame: <path d="M12 21.5a7 7 0 0 0 7-7c0-4.5-3.5-7-5-11.5-1.5 3-2 4.5-3.5 6-1-1-1.5-2-1.8-3.2C6.5 8 5 10.8 5 14.5a7 7 0 0 0 7 7z" />,
  trophy: <path d="M8 4h8v6a4 4 0 0 1-8 0zM8 6H4.5v1A3.5 3.5 0 0 0 8 10.5M16 6h3.5v1a3.5 3.5 0 0 1-3.5 3.5M12 14v4M8 21h8M10 18h4" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M21 15l-5-5-10 10" />
    </>
  ),
  photo: (
    <>
      <path d="M4 7.5h3l2-3h6l2 3h3a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </>
  ),
  clip: <path d="M20 11.5l-8.5 8.5a5 5 0 0 1-7-7L13 4.5a3.5 3.5 0 0 1 5 5L9.5 18a2 2 0 0 1-3-3L14 7.5" />,
  watch: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="3" />
      <path d="M9 6l1-4h4l1 4M9 18l1 4h4l1-4M12 9.5V12l1.5 1.5" />
    </>
  ),
  print: <path d="M7 9V3h10v6M7 18H4.5a1.5 1.5 0 0 1-1.5-1.5v-6A1.5 1.5 0 0 1 4.5 9h15a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H17M7 14h10v7H7z" />,
  chat: <path d="M4 5h16v11H9l-5 4z" />,
  star: <path d="M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4l-5.5 2.9 1-6.2L3 9.7l6.2-.9z" />,
  dumbbell: <path d="M6.5 7v10M3.5 9.5v5M17.5 7v10M20.5 9.5v5M6.5 12h11" />,
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
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
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
