'use client';

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Scale } from 'lucide-react';
import { getDB } from '@/lib/db';
import type { Forecast } from '@/lib/types';
import { formatDay, localDayOf } from '@/lib/util';
import { Slider } from './ForecastPanel';

function relativeDay(day: string): string {
  const today = localDayOf();
  const [y, m, d] = day.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const diff = Math.round((new Date(ty, tm - 1, td).getTime() - new Date(y, m - 1, d).getTime()) / 86400000);
  if (diff === 1) return 'yesterday';
  if (diff < 7) return `${diff} days ago`;
  return `on ${formatDay(day)}`;
}

export default function CalibrationBanner() {
  const due = useLiveQuery(async () => {
    const today = localDayOf();
    const all = await getDB().forecasts.toArray();
    return all.filter((f) => f.calibratedAt === null && f.targetDate < today).sort((a, b) => a.targetDate.localeCompare(b.targetDate));
  }, []);
  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState(40);
  const [coping, setCoping] = useState(60);
  const [note, setNote] = useState('');
  const [result, setResult] = useState<{ name: string; delta: number } | null>(null);

  if (result) {
    const over = result.delta > 0;
    return (
      <div className="nr-rise mx-auto mt-4 flex w-full max-w-[720px] items-center gap-3 rounded-xl border border-ink-700 bg-ink-900 px-4 py-3" role="status">
        <Scale size={17} className="shrink-0 text-dusk-400" />
        <p className="flex-1 text-[13.5px] text-paper-100">
          {result.delta === 0
            ? `Your forecast for ${result.name} was spot on.`
            : `For ${result.name}, you ${over ? 'overestimated' : 'underestimated'} the impact by ${Math.abs(result.delta)} points.`}{' '}
          <span className="text-paper-500">It is now on your calibration chart.</span>
        </p>
        <button type="button" onClick={() => setResult(null)} className="rounded-lg px-2.5 py-1 text-[12.5px] text-paper-300 hover:bg-ink-800">
          Done
        </button>
      </div>
    );
  }

  if (!due || due.length === 0) return null;
  const f: Forecast = due[0];

  const save = async () => {
    await getDB().forecasts.update(f.id, { actualImpact: impact, actualCoping: coping, actualNote: note.trim(), calibratedAt: new Date().toISOString() });
    setResult({ name: f.eventName, delta: f.predictedDread - impact });
    setOpen(false);
    setNote('');
  };

  return (
    <div className="nr-rise mx-auto mt-4 w-full max-w-[720px] rounded-xl border border-dusk-400/40 bg-dusk-400/[0.07] px-4 py-3" data-testid="calibration-banner">
      <div className="flex items-center gap-3">
        <Scale size={17} className="shrink-0 text-dusk-400" />
        <p className="flex-1 text-[13.5px] leading-5 text-paper-100">
          <span className="font-medium">Reality check:</span> {f.eventName} was {relativeDay(f.targetDate)}. You predicted dread of {f.predictedDread} out of 100.
          {due.length > 1 && <span className="text-paper-500"> ({due.length - 1} more waiting)</span>}
        </p>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="shrink-0 rounded-lg bg-dusk-400 px-3 py-1.5 text-[12.5px] font-medium text-ink-950 hover:bg-dusk-300">
            Log how it went
          </button>
        )}
      </div>
      {open && (
        <div className="mt-4 grid grid-cols-2 gap-5 pb-1">
          {f.worstCase && (
            <p className="col-span-2 font-serif text-[14px] italic leading-6 text-paper-300">You feared: &ldquo;{f.worstCase}&rdquo;</p>
          )}
          <Slider id="cal-impact" label="How bad did it actually feel?" value={impact} onChange={setImpact} low="Not at all" high="Overwhelming" />
          <Slider id="cal-coping" label="How well did you actually cope?" value={coping} onChange={setCoping} low="Not at all" high="Completely" />
          <div className="col-span-2">
            <label htmlFor="cal-note" className="text-[13px] text-paper-100">
              What actually happened? (optional)
            </label>
            <input
              id="cal-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-[14px] text-paper-50 focus:border-dusk-400 focus:outline-none"
            />
          </div>
          <div className="col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-[13px] text-paper-300 hover:bg-ink-800">
              Later
            </button>
            <button type="button" onClick={save} className="rounded-lg bg-dusk-400 px-3.5 py-1.5 text-[13px] font-medium text-ink-950 hover:bg-dusk-300">
              Save reality check
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
