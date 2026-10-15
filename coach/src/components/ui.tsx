import { useEffect, type ReactNode } from 'react';
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

export function Kpi({ label, value, sub, tone, hint }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; /** Wyjaśnienie pojęcia (np. ACWR) — dymek i znak „?”. */ hint?: string }) {
  return (
    <div className={`card kpi ${tone ? `kpi-${tone}` : ''}`}>
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
    </div>
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
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
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {onSubmit ? 'Anuluj' : 'Zamknij'}
          </button>
          {onSubmit && (
            <button type="submit" className="btn btn-primary">
              {submitLabel}
            </button>
          )}
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
  eye: <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />,
  check: <path d="M5 12l5 5L20 7" />,
  alert: <path d="M12 3l10 18H2zM12 10v5M12 18v.5" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
  user: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6" />,
  settings: <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-2-4-2 1-2-1V5h-4v2l-2 1-2-1-2 4 2 1v0l-2 1 2 4 2-1 2 1v2h4v-2l2-1 2 1 2-4z" />,
};

export function Icon({ name, size = 18 }: { name: keyof typeof ICONS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
