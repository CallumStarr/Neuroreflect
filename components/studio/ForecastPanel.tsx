'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { getDB } from '@/lib/db';
import type { Forecast } from '@/lib/types';
import { addDays, localDayOf, uid } from '@/lib/util';

interface Props {
  entryId: string | null;
  ensureEntry: () => Promise<string>;
  onClose: () => void;
  onSaved: (f: Forecast) => void;
}

export function Slider({ label, value, onChange, low, high, id }: { label: string; value: number; onChange: (v: number) => void; low: string; high: string; id: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-[13px] text-paper-100">
          {label}
        </label>
        <span className="nr-num text-[15px] font-medium text-paper-50">{value}</span>
      </div>
      <input id={id} type="range" min={0} max={100} step={5} value={value} onChange={(e) => onChange(Number(e.target.value))} className="nr-range mt-2 w-full" />
      <div className="mt-1 flex justify-between text-[11px] text-paper-500">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}

export default function ForecastPanel({ entryId, ensureEntry, onClose, onSaved }: Props) {
  const [eventName, setEventName] = useState('');
  const [targetDate, setTargetDate] = useState(addDays(localDayOf(), 1));
  const [dread, setDread] = useState(60);
  const [coping, setCoping] = useState(50);
  const [worstCase, setWorstCase] = useState('');
  const [error, setError] = useState('');
  const today = localDayOf();

  const save = async () => {
    if (!eventName.trim()) {
      setError('Give the event a name.');
      return;
    }
    if (targetDate < today) {
      setError('Pick today or a future date. Past events go in the reality check instead.');
      return;
    }
    const id = entryId ?? (await ensureEntry());
    const f: Forecast = {
      id: uid('f'),
      entryId: id,
      eventName: eventName.trim(),
      targetDate,
      predictedDread: dread,
      predictedCoping: coping,
      worstCase: worstCase.trim(),
      actualImpact: null,
      actualCoping: null,
      actualNote: '',
      calibratedAt: null,
      createdAt: new Date().toISOString(),
    };
    await getDB().forecasts.add(f);
    onSaved(f);
  };

  return (
    <div role="dialog" aria-label="Forecast an upcoming event" className="nr-rise absolute right-6 top-16 z-30 w-[380px] rounded-2xl border border-ink-700 bg-ink-850 p-5 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.75)]">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-serif text-[1.15rem] text-paper-50">Forecast an upcoming event</h2>
          <p className="mt-0.5 text-[12.5px] leading-5 text-paper-500">Predict now; on the day after, you will be asked how it actually felt. Over time this shows how far your brain overestimates.</p>
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 text-paper-500 hover:text-paper-100">
          <X size={16} />
        </button>
      </div>
      <div className="mt-4 space-y-4">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <div>
            <label htmlFor="fc-name" className="text-[13px] text-paper-100">
              Event
            </label>
            <input
              id="fc-name"
              autoFocus
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              placeholder="e.g. Job interview"
              className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-[14px] text-paper-50 placeholder:text-paper-500 focus:border-ember-400 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="fc-date" className="text-[13px] text-paper-100">
              Date
            </label>
            <input
              id="fc-date"
              type="date"
              min={today}
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="mt-1 rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-2 text-[14px] text-paper-50 [color-scheme:dark] focus:border-ember-400 focus:outline-none"
            />
          </div>
        </div>
        <Slider id="fc-dread" label="How much dread do you expect?" value={dread} onChange={setDread} low="None" high="Overwhelming" />
        <Slider id="fc-coping" label="How well do you expect to cope?" value={coping} onChange={setCoping} low="Not at all" high="Completely" />
        <div>
          <label htmlFor="fc-worst" className="text-[13px] text-paper-100">
            Worst case you are imagining
          </label>
          <textarea
            id="fc-worst"
            rows={2}
            value={worstCase}
            onChange={(e) => setWorstCase(e.target.value)}
            className="mt-1 w-full resize-none rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 font-serif text-[14px] text-paper-50 focus:border-ember-400 focus:outline-none"
          />
        </div>
        {error && <p className="text-[12.5px] text-rose-300">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-[13px] text-paper-300 hover:bg-ink-800">
            Cancel
          </button>
          <button type="button" onClick={save} className="rounded-lg bg-ember-400 px-3.5 py-1.5 text-[13px] font-medium text-ink-950 hover:bg-ember-300">
            Save forecast
          </button>
        </div>
      </div>
    </div>
  );
}
