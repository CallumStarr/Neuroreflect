'use client';

import { Bell, X } from 'lucide-react';
import { useToasts } from '@/lib/toasts';

export default function Toasts() {
  const { toasts, dismiss } = useToasts();
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-24 right-4 z-[65] flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2 md:bottom-6" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} role="status" className="nr-rise pointer-events-auto rounded-xl border border-ink-700 bg-ink-850 p-3.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.7)]">
          <div className="flex items-start gap-2.5">
            <Bell size={15} className="mt-0.5 shrink-0 text-ember-400" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium text-paper-50">{t.title}</p>
              {t.body && <p className="mt-0.5 text-[12.5px] leading-5 text-paper-300">{t.body}</p>}
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    t.action?.run();
                    dismiss(t.id);
                  }}
                  className="mt-2 rounded-lg border border-ink-700 px-2.5 py-1 text-[12.5px] text-paper-100 hover:bg-ink-800"
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="rounded p-0.5 text-paper-500 hover:text-paper-100">
              <X size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
