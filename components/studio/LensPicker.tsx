'use client';

import { useEffect, useMemo, useState } from 'react';
import { LENSES } from '@/lib/prompts';
import type { LensId } from '@/lib/types';

export type PaletteAction = { kind: 'lens'; lens: LensId } | { kind: 'deeper' } | { kind: 'stepback' } | { kind: 'finish' } | { kind: 'forecast' };

interface Item {
  id: string;
  label: string;
  hint: string;
  action: PaletteAction;
  shortcut?: string;
}

export default function LensPicker({ onPick, onClose }: { onPick: (a: PaletteAction) => void; onClose: () => void }) {
  const items: Item[] = useMemo(
    () => [
      ...LENSES.map((l) => ({ id: l.id, label: l.label, hint: l.blurb, action: { kind: 'lens', lens: l.id } as PaletteAction })),
      { id: 'deeper', label: 'Go deeper', hint: 'One Socratic question', action: { kind: 'deeper' }, shortcut: 'Ctrl Enter' },
      { id: 'stepback', label: 'Step back', hint: 'Third-person or a year-from-now view', action: { kind: 'stepback' } },
      { id: 'forecast', label: 'Forecast an upcoming event', hint: 'Predict how it will feel, check it later', action: { kind: 'forecast' } },
      { id: 'finish', label: 'Finish entry', hint: 'Save, analyse and distil', action: { kind: 'finish' }, shortcut: 'Ctrl Shift Enter' },
    ],
    [],
  );
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const filtered = items.filter((i) => `${i.label} ${i.hint}`.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => setIndex(0), [query]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[index];
      if (item) onPick(item.action);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[14vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Mental model lenses and actions"
        className="nr-rise w-[520px] overflow-hidden rounded-2xl border border-ink-700 bg-ink-850 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder="Apply a lens or run an action"
          aria-label="Search lenses and actions"
          className="w-full border-b border-ink-700 bg-transparent px-5 py-4 text-[15px] text-paper-50 placeholder:text-paper-500 focus:outline-none"
        />
        <ul role="listbox" className="max-h-[360px] overflow-y-auto p-2">
          {filtered.map((item, i) => (
            <li key={item.id} role="option" aria-selected={i === index}>
              <button
                type="button"
                onMouseEnter={() => setIndex(i)}
                onClick={() => onPick(item.action)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left ${i === index ? 'bg-ink-800' : ''}`}
              >
                <span>
                  <span className="block text-[14px] text-paper-50">{item.label}</span>
                  <span className="block text-[12.5px] text-paper-500">{item.hint}</span>
                </span>
                {item.shortcut && <kbd className="text-[11px] text-paper-500">{item.shortcut}</kbd>}
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li className="px-3 py-4 text-[13px] text-paper-500">Nothing matches that.</li>}
        </ul>
      </div>
    </div>
  );
}
