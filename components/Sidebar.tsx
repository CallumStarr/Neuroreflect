'use client';

import { Activity, CalendarDays, Feather, LifeBuoy, Lock, Network, SlidersHorizontal } from 'lucide-react';
import { lockNow } from '@/lib/lock';
import { useUI, type Tab } from '@/lib/store';
import { useLockState } from './useLockState';

const ITEMS: { id: Tab; label: string; icon: typeof Feather; key: string }[] = [
  { id: 'studio', label: 'Journal', icon: Feather, key: '1' },
  { id: 'planner', label: 'Planner', icon: CalendarDays, key: '2' },
  { id: 'dashboard', label: 'Patterns', icon: Activity, key: '3' },
  { id: 'graph', label: 'Memory', icon: Network, key: '4' },
  { id: 'settings', label: 'Vault', icon: SlidersHorizontal, key: '5' },
];

export default function Sidebar() {
  const { tab, setTab, setHelpOpen } = useUI();
  const lock = useLockState();
  return (
    <nav aria-label="Main" className="order-2 flex h-[72px] shrink-0 items-center border-t border-ink-800 bg-ink-950 px-2 md:order-1 md:h-auto md:w-[76px] md:flex-col md:border-r md:border-t-0 md:px-0 md:py-5">
      <div className="mr-3 hidden h-9 w-9 items-center justify-center md:mb-8 md:mr-0 md:flex" aria-hidden>
        <svg viewBox="0 0 36 36" className="h-9 w-9">
          <circle cx="18" cy="18" r="15" fill="none" stroke="#3b332b" strokeWidth="1.5" />
          <path d="M6 20 C 10 20, 11 12, 14 12 S 18 26, 21 26 S 25 15, 30 16" fill="none" stroke="#e0aa4a" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      <ul className="flex min-w-0 flex-1 items-center justify-around gap-1.5 md:flex-col md:justify-start">
        {ITEMS.map(({ id, label, icon: Icon, key }) => {
          const active = tab === id;
          return (
            <li key={id} className="min-w-0 flex-1 md:flex-none">
              <button
                type="button"
                onClick={() => setTab(id)}
                aria-current={active ? 'page' : undefined}
                title={`${label} (Alt+${key})`}
                className={`group mx-auto flex w-full max-w-[72px] flex-col items-center gap-1 rounded-lg px-0.5 py-2 text-[10px] transition-colors md:w-[60px] md:px-1 md:py-2.5 md:text-[11px] ${
                  active ? 'bg-ink-850 text-paper-50' : 'text-paper-500 hover:bg-ink-900 hover:text-paper-100'
                }`}
              >
                <Icon size={19} strokeWidth={1.6} className={active ? 'text-ember-400' : ''} />
                <span>{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={() => setHelpOpen(true)}
        aria-label="Help now"
        title="Help now (F1)"
        className="ml-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-rose-300 hover:bg-ink-900 hover:text-rose-200 md:hidden"
      >
        <LifeBuoy size={17} strokeWidth={1.6} />
      </button>
      {lock === 'unlocked' && (
        <button
          type="button"
          onClick={() => void lockNow()}
          aria-label="Lock now"
          className="mr-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-paper-500 hover:bg-ink-900 hover:text-paper-100 md:hidden"
        >
          <Lock size={16} strokeWidth={1.6} />
        </button>
      )}
      <button
        type="button"
        onClick={() => setHelpOpen(true)}
        title="Help now (F1)"
        className="ml-1 hidden w-[60px] flex-col items-center gap-1 rounded-lg px-1 py-2.5 text-[11px] text-rose-300 transition-colors hover:bg-ink-900 hover:text-rose-200 md:mb-1 md:ml-0 md:flex"
      >
        <LifeBuoy size={17} strokeWidth={1.6} />
        <span>Help</span>
      </button>
      {lock === 'unlocked' && (
        <button
          type="button"
          onClick={() => void lockNow()}
          title="Lock now (Alt+L)"
          className="ml-1 hidden w-[60px] flex-col items-center gap-1 rounded-lg px-1 py-2.5 text-[11px] text-paper-500 transition-colors hover:bg-ink-900 hover:text-paper-100 md:mb-3 md:ml-0 md:flex"
        >
          <Lock size={17} strokeWidth={1.6} />
          <span>Lock</span>
        </button>
      )}
      {/* On phones the bar has no room for this note; it is repeated in the Vault. */}
      <p
        className="hidden shrink-0 px-2 text-center text-[10px] leading-tight text-paper-500 md:block"
        title={
          lock === 'off'
            ? 'Entries never leave this device unless you send them to an AI provider you configured.'
            : 'Entries are encrypted with your passphrase and never leave this device unless you send them to an AI provider you configured.'
        }
      >
        {lock === 'off' ? 'Stored on this device' : 'Encrypted on this device'}
      </p>
    </nav>
  );
}
