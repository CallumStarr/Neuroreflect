'use client';

import { useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { CALENDAR_FILE, writingTimeIcs } from '@/lib/calendar-export';
import { formatTime } from '@/lib/nl-date';
import { nudgeMinute, timeOfMinutes } from '@/lib/nudge';
import { saveTextFile } from '@/lib/platform';
import type { EngagementSettings, WritingPlan } from '@/lib/types';

export const MOMENTS: { moment: string; time: string }[] = [
  { moment: 'with my first coffee', time: '07:30' },
  { moment: 'at lunch', time: '12:30' },
  { moment: 'on the way home', time: '17:30' },
  { moment: 'after dinner', time: '19:30' },
  { moment: 'before bed', time: '21:30' },
];

const RHYTHMS: { value: number | null; label: string }[] = [
  { value: null, label: 'No aim' },
  { value: 3, label: '3 days' },
  { value: 4, label: '4 days' },
  { value: 5, label: '5 days' },
  { value: 7, label: 'Every day' },
];

export function nudgeTimeLabel(engagement: EngagementSettings): string | null {
  const m = nudgeMinute(engagement);
  return m === null ? null : formatTime(timeOfMinutes(m));
}

export interface PlanDraft {
  plan: WritingPlan;
  nudge: boolean;
  rhythm: number | null;
}

/**
 * When and where the person will write: a moment in their day, roughly when it
 * comes, an optional place, the nudge as a backup, and an optional weekly aim.
 * If-then plans made follow-through much likelier across 94 tests (Gollwitzer
 * & Sheeran 2006); a routine as the cue builds the habit better than a reminder.
 */
export default function WritingPlanEditor({
  value,
  onChange,
  engagement,
  compact = false,
}: {
  value: PlanDraft;
  onChange: (next: PlanDraft) => void;
  engagement: EngagementSettings;
  compact?: boolean;
}) {
  const preset = MOMENTS.find((m) => m.moment === value.plan.moment);
  const [custom, setCustom] = useState(!preset && !!value.plan.moment);
  const [calendarMsg, setCalendarMsg] = useState<string | null>(null);
  const set = (patch: Partial<PlanDraft>) => onChange({ ...value, ...patch });
  const setPlan = (patch: Partial<WritingPlan>) => set({ plan: { ...value.plan, ...patch } });
  const preview = nudgeTimeLabel({ ...engagement, plan: value.plan, nudge: { ...engagement.nudge, enabled: value.nudge } });

  const addToCalendar = async () => {
    try {
      const saved = await saveTextFile('NeuroReflect writing time.ics', writingTimeIcs(value.plan), CALENDAR_FILE);
      setCalendarMsg(saved ? 'Saved. Open the file to add it to your calendar.' : null);
    } catch (e) {
      setCalendarMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-5" data-testid="writing-plan-editor">
      <div>
        <p className="text-[13px] text-paper-100">When in your day will you write?</p>
        <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Writing moment">
          {MOMENTS.map((m) => {
            const on = !custom && value.plan.moment === m.moment;
            return (
              <button
                key={m.moment}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setCustom(false);
                  setPlan({ moment: m.moment, usualTime: m.time });
                }}
                className={`rounded-full border px-3 py-1 text-[12.5px] ${on ? 'border-ember-400 bg-ember-400/10 text-paper-50' : 'border-ink-700 text-paper-300 hover:border-ink-600'}`}
              >
                {m.moment.charAt(0).toUpperCase() + m.moment.slice(1)}
              </button>
            );
          })}
          <button
            type="button"
            role="radio"
            aria-checked={custom}
            onClick={() => {
              setCustom(true);
              setPlan({ moment: '' });
            }}
            className={`rounded-full border px-3 py-1 text-[12.5px] ${custom ? 'border-ember-400 bg-ember-400/10 text-paper-50' : 'border-ink-700 text-paper-300 hover:border-ink-600'}`}
          >
            Something else
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-paper-300">
          {custom && (
            <input
              aria-label="Your writing moment"
              value={value.plan.moment}
              onChange={(e) => setPlan({ moment: e.target.value })}
              placeholder="after the school run"
              className="w-56 rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-[13.5px] text-paper-50 placeholder:text-paper-500 focus:border-ember-400 focus:outline-none"
            />
          )}
          <span>usually around</span>
          <input
            type="time"
            aria-label="Usual time"
            value={value.plan.usualTime}
            onChange={(e) => e.target.value && setPlan({ usualTime: e.target.value })}
            className="rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5 text-[13.5px] text-paper-50 focus:border-ember-400 focus:outline-none"
          />
          <input
            aria-label="Where you will write"
            value={value.plan.place}
            onChange={(e) => setPlan({ place: e.target.value })}
            placeholder="where, if you like: at the kitchen table"
            className="min-w-[14rem] flex-1 rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-[13.5px] text-paper-50 placeholder:text-paper-500 focus:border-ember-400 focus:outline-none"
          />
        </div>
      </div>

      <label className="flex items-start gap-2 text-[13px] text-paper-100">
        <input type="checkbox" checked={value.nudge} onChange={(e) => set({ nudge: e.target.checked })} className="mt-1 accent-[#e0aa4a]" data-testid="nudge-toggle" />
        <span>
          If I haven't written by then, one gentle nudge an hour later
          <span className="block text-[12px] leading-5 text-paper-500">
            {value.nudge
              ? preview
                ? `Around ${preview}, only on days you haven't written. Never during quiet hours, and it steps back once writing becomes a habit.`
                : 'That time falls in your quiet hours, so no nudge will be sent. Choose an earlier moment or change quiet hours in Settings.'
              : 'No nudge. Your moment in the day does the reminding.'}
          </span>
        </span>
      </label>

      <div>
        <p className="text-[13px] text-paper-100">A weekly aim, if you'd like one</p>
        <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Weekly aim">
          {RHYTHMS.map((r) => (
            <button
              key={String(r.value)}
              type="button"
              role="radio"
              aria-checked={value.rhythm === r.value}
              onClick={() => set({ rhythm: r.value })}
              className={`rounded-full border px-3 py-1 text-[12.5px] ${value.rhythm === r.value ? 'border-ember-400 bg-ember-400/10 text-paper-50' : 'border-ink-700 text-paper-300 hover:border-ink-600'}`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {!compact && <p className="mt-1.5 text-[12px] leading-5 text-paper-500">Not a streak: this week's days fill in as you write, nothing resets, and every week starts clean.</p>}
      </div>

      <div>
        <button
          type="button"
          onClick={() => void addToCalendar()}
          disabled={!value.plan.moment.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-1.5 text-[12.5px] text-paper-100 hover:bg-ink-900 disabled:opacity-40"
        >
          <CalendarPlus size={14} /> Add my writing time to my calendar
        </button>
        <p className="mt-1.5 text-[12px] leading-5 text-paper-500">
          {calendarMsg ?? 'A repeating event called "Writing time" for Outlook, Google or Apple Calendar. If your calendar syncs, it reaches your phone too.'}
        </p>
      </div>
    </div>
  );
}
