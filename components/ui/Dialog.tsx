'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface Props {
  label: string;
  title?: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Tailwind width class for the panel. */
  width?: string;
  /** Sits above everything, for help. */
  urgent?: boolean;
}

/** A modal panel: Escape and the backdrop close it, focus starts inside and returns afterwards. */
export default function Dialog({ label, title, description, onClose, children, width = 'w-[460px]', urgent }: Props) {
  const panel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>('[autofocus], input, textarea, select, button:not([data-close])');
    (first ?? panel.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className={`fixed inset-0 ${urgent ? 'z-[70]' : 'z-[60]'} flex items-start justify-center overflow-y-auto bg-black/55 px-3 pb-6 pt-[8vh]`} onMouseDown={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`nr-rise relative max-w-full ${width} rounded-2xl border border-ink-700 bg-ink-850 p-5 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] focus:outline-none`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button type="button" data-close aria-label="Close" onClick={onClose} className="absolute right-3 top-3 rounded p-1.5 text-paper-500 hover:bg-ink-800 hover:text-paper-100">
          <X size={16} />
        </button>
        {title && <h2 className="pr-8 font-serif text-[1.2rem] text-paper-50">{title}</h2>}
        {description && <p className="mt-1 pr-6 text-[12.5px] leading-5 text-paper-500">{description}</p>}
        <div className={title || description ? 'mt-4' : ''}>{children}</div>
      </div>
    </div>
  );
}
