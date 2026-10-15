import { useRef, type ReactNode } from 'react';
import { useDialog } from './useDialog';

/** Arkusz od dołu ekranu (tryb zawodnika, podglądy): Escape i dotknięcie tła zamykają, fokus zostaje w środku. */
export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, onClose);
  return (
    <div className="sheet-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="sheet" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}
