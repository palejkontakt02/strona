import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Sheet } from './Sheet';
import { Icon } from './ui';

/** Zgodność z zapytaniem CSS (telefon / komputer). */
export function useMedia(query: string): boolean {
  const get = () => typeof matchMedia === 'function' && matchMedia(query).matches;
  const [on, setOn] = useState(get);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(query);
    const fn = () => setOn(m.matches);
    m.addEventListener?.('change', fn);
    return () => m.removeEventListener?.('change', fn);
  }, [query]);
  return on;
}

export interface MenuItem {
  icon?: string;
  text: string;
  run: () => void;
  danger?: boolean;
  /** Krótki opis pod pozycją (np. co zawiera plik). */
  hint?: string;
}

/**
 * Przycisk z menu rzadszych akcji. Komputer: lista pod przyciskiem (Escape, klik obok i wybór zamykają);
 * telefon: ten sam arkusz od dołu co „⋯” karty planu.
 */
export function MenuButton({
  label,
  title,
  items,
  children,
  className = 'btn btn-ghost btn-sm',
  align = 'end',
}: {
  /** Nazwa menu (aria-label i tytuł arkusza na telefonie). */
  label: string;
  /** Nagłówek arkusza na telefonie (domyślnie `label`). */
  title?: string;
  items: MenuItem[];
  /** Treść przycisku; bez niej ikona „⋯”. */
  children?: ReactNode;
  className?: string;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  // pozycja listy (fixed — tabela z przewijaniem w bok nie ucina menu)
  const [pos, setPos] = useState<React.CSSProperties>({});
  const phone = useMedia('(max-width: 640px)');
  const wrap = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || phone) return;
    const down = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', down);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    list.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('mousedown', down);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open, phone]);
  const toggle = () => {
    if (!open && btn.current) {
      const r = btn.current.getBoundingClientRect();
      const up = r.bottom + 360 > window.innerHeight && r.top > window.innerHeight / 2;
      setPos({
        ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
        ...(align === 'end' ? { right: Math.max(8, window.innerWidth - r.right) } : { left: Math.max(8, r.left) }),
      });
    }
    setOpen(!open);
  };

  const pick = (it: MenuItem) => {
    setOpen(false);
    it.run();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      btn.current?.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const all = [...(list.current?.querySelectorAll<HTMLElement>('button') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLElement);
    all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus();
  };

  return (
    <span ref={wrap} className="menu-wrap">
      <button
        ref={btn}
        type="button"
        className={`${className}${children ? '' : ' menu-dots'}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={children ? undefined : label}
        title={children ? undefined : label}
        onClick={toggle}
      >
        {children ?? <Icon name="more" size={18} />}
      </button>
      {open && !phone && (
        <div ref={list} className="menu-pop" style={pos} role="menu" aria-label={label} onKeyDown={onKey}>
          {items.map((it) => (
            <button key={it.text} type="button" role="menuitem" className={`menu-item${it.danger ? ' is-danger' : ''}`} onClick={() => pick(it)}>
              {it.icon && <Icon name={it.icon} size={16} />}
              <span className="menu-item-text">
                {it.text}
                {it.hint && <span className="menu-item-hint">{it.hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
      {open && phone && (
        <Sheet label={label} onClose={() => setOpen(false)}>
          <strong className="pl-sheet-title">{title ?? label}</strong>
          <div className="pl-sheet-list">
            {items.map((it) => (
              <button key={it.text} type="button" className={`btn btn-ghost pl-sheet-btn ${it.danger ? 'is-danger' : ''}`} onClick={() => pick(it)}>
                {it.icon && <Icon name={it.icon} size={18} />} {it.text}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </span>
  );
}
