import { create } from 'zustand';

export interface Toast {
  id: string;
  title: string;
  body?: string;
  /** Reminder toasts stay until dismissed; others fade. */
  sticky?: boolean;
  action?: { label: string; run: () => void };
}

interface ToastState {
  toasts: Toast[];
  push: (t: Toast) => void;
  dismiss: (id: string) => void;
}

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => set((s) => ({ toasts: [...s.toasts.filter((x) => x.id !== t.id), t].slice(-4) })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export function toast(t: Omit<Toast, 'id'> & { id?: string }): void {
  const id = t.id ?? Math.random().toString(36).slice(2);
  useToasts.getState().push({ ...t, id });
  if (!t.sticky) setTimeout(() => useToasts.getState().dismiss(id), 6000);
}
