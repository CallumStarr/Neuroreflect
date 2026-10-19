'use client';

import { useState } from 'react';
import { useUI, type MemoryMode } from '@/lib/store';
import GraphView from './GraphView';
import { KIND_STYLE, LegendShape, type Kind } from './kinds';
import RecallView from './RecallView';
import TimelineView, { type TimelineRange } from './TimelineView';

const MODES: { id: MemoryMode; label: string }[] = [
  { id: 'graph', label: 'Graph' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'recall', label: 'Recall' },
];

const RANGES: { id: TimelineRange; label: string }[] = [
  { id: '14', label: '14 days' },
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' },
  { id: 'all', label: 'All' },
];

function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg border border-ink-800 p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-md px-3 py-1 text-[12.5px] ${value === o.id ? 'bg-ink-850 text-paper-50' : 'text-paper-500 hover:text-paper-100'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function MemoryView() {
  const { memoryMode, setMemoryMode } = useUI();
  const [hidden, setHidden] = useState<Set<Kind>>(new Set());
  const [showCo, setShowCo] = useState(false);
  const [range, setRange] = useState<TimelineRange>('all');

  const toggleKind = (k: Kind) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-ink-800 px-6 py-3">
        <h1 className="font-serif text-[1.35rem] text-paper-50">Memory and themes</h1>
        <Segmented label="Memory view" options={MODES} value={memoryMode} onChange={setMemoryMode} />
        {memoryMode !== 'recall' && (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show node types">
            {(Object.keys(KIND_STYLE) as Kind[]).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={!hidden.has(k)}
                onClick={() => toggleKind(k)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] ${
                  hidden.has(k) ? 'border-ink-800 text-paper-500 line-through decoration-ink-600' : 'border-ink-700 text-paper-100'
                }`}
              >
                <LegendShape kind={k} />
                {KIND_STYLE[k].label}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto">
          {memoryMode === 'graph' ? (
            <label className="inline-flex items-center gap-2 text-[12.5px] text-paper-300">
              <input type="checkbox" checked={showCo} onChange={(e) => setShowCo(e.target.checked)} className="accent-[#e0aa4a]" />
              Link things that appear together
            </label>
          ) : memoryMode === 'timeline' ? (
            <Segmented label="Time range" options={RANGES} value={range} onChange={setRange} />
          ) : null
          }
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {memoryMode === 'graph' ? <GraphView hidden={hidden} showCo={showCo} /> : memoryMode === 'timeline' ? <TimelineView hidden={hidden} range={range} /> : <RecallView />}
      </div>
    </div>
  );
}
