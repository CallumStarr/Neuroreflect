'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronsLeft, PenLine, RefreshCcw } from 'lucide-react';
import { getDB } from '@/lib/db';
import { formatDay, localDayOf } from '@/lib/util';

interface Props {
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onCollapse: () => void;
}

export default function EntryRail({ activeId, onOpen, onNew, onCollapse }: Props) {
  const data = useLiveQuery(async () => {
    const db = getDB();
    const [entries, telemetry] = await Promise.all([db.entries.orderBy('updatedAt').reverse().toArray(), db.telemetry.toArray()]);
    const flags = new Set(telemetry.filter((t) => t.ruminationFlag).map((t) => t.entryId));
    return { entries, flags };
  }, []);
  const today = localDayOf();

  return (
    <aside className="flex w-[244px] shrink-0 flex-col border-r border-ink-800 bg-ink-950" aria-label="Entries">
      <div className="flex items-center gap-1.5 px-3 pb-2 pt-4">
        <button
          type="button"
          onClick={onNew}
          title="New entry (Alt+N)"
          className="flex flex-1 items-center gap-2 rounded-lg border border-ink-700 px-3 py-2 text-[13px] text-paper-100 hover:border-ink-600 hover:bg-ink-900"
        >
          <PenLine size={14} className="text-ember-400" /> New entry
        </button>
        <button type="button" onClick={onCollapse} title="Hide entries" className="rounded p-2 text-paper-500 hover:bg-ink-900 hover:text-paper-100">
          <ChevronsLeft size={15} />
        </button>
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {(data?.entries ?? []).map((e) => {
          const active = e.id === activeId;
          const first = e.blocks.find((b) => b.text.trim())?.text ?? '';
          return (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => onOpen(e.id)}
                aria-current={active ? 'true' : undefined}
                className={`mt-0.5 w-full rounded-lg px-3 py-2.5 text-left transition-colors ${active ? 'bg-ink-850' : 'hover:bg-ink-900'}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[11.5px] text-paper-500">{e.localDay === today ? 'Today' : formatDay(e.localDay)}</span>
                  <span className="flex items-center gap-1.5">
                    {data?.flags.has(e.id) && <RefreshCcw size={11} className="text-rose-400" aria-label="Rumination loop flagged" />}
                    {e.status === 'draft' && <span className="text-[11px] text-ember-300">Draft</span>}
                  </span>
                </span>
                <span className={`mt-0.5 block truncate font-serif text-[14.5px] ${active ? 'text-paper-50' : 'text-paper-100'}`}>{e.title || first.slice(0, 60) || 'Untitled'}</span>
                <span className="nr-num block text-[11.5px] text-paper-500">{e.wordCount} words</span>
              </button>
            </li>
          );
        })}
        {data && data.entries.length === 0 && <li className="px-3 py-4 text-[13px] text-paper-500">No entries yet. Start writing and it saves itself.</li>}
      </ol>
    </aside>
  );
}
