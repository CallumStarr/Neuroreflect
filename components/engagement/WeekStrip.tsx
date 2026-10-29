'use client';

import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BellOff, BellRing, CalendarRange } from 'lucide-react';
import { getDB, saveSettings } from '@/lib/db';
import { loadNudgeInputs } from '@/lib/engagement';
import { formatTime } from '@/lib/nl-date';
import { backedOff, nudgeMinute, planNudges, timeOfMinutes } from '@/lib/nudge';
import { rhythmLine, rhythmWeek, weekStart } from '@/lib/rhythm';
import { useUI } from '@/lib/store';
import { addDays, formatDay, localDayOf } from '@/lib/util';
import { WritingTimeDialog } from './Dialogs';

/**
 * This week's dots (when the person chose a weekly aim), today's nudge with
 * Not today and Change time, and the way into the week's chapter. Only this
 * week is ever shown, so nothing here can read as a loss.
 */
export default function WeekStrip({ onOpenWeek }: { onOpenWeek: () => void }) {
  const { settings, setSettings } = useUI();
  const e = settings.engagement;
  const today = localDayOf();
  const [menu, setMenu] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (ev: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(ev.target as Node)) setMenu(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  const data = useLiveQuery(async () => {
    const start = weekStart(today, settings.planner.weekStartsOn);
    const [week, inputs] = await Promise.all([getDB().entries.where('localDay').between(start, addDays(start, 6), true, true).toArray(), loadNudgeInputs(settings)]);
    const days = week.filter((x) => x.wordCount > 0).map((x) => x.localDay);
    const todays = planNudges(inputs, 1)[0] ?? null;
    return { days, todays, backed: backedOff(inputs), wroteToday: days.includes(today) };
  }, [settings, today]);
  if (!data) return null;

  const week = rhythmWeek(data.days, today, settings.planner.weekStartsOn, e.rhythm);
  const save = async (patch: Parameters<typeof saveSettings>[0]) => setSettings(await saveSettings(patch));
  const minute = nudgeMinute(e);

  let nudgeLabel: string | null = null;
  if (e.plan && e.nudge.enabled && minute !== null) {
    if (e.nudge.pausedUntil && e.nudge.pausedUntil >= today) nudgeLabel = `Nudge paused until ${formatDay(e.nudge.pausedUntil, { weekday: 'short', day: 'numeric', month: 'short' })}`;
    else if (data.backed) nudgeLabel = 'Nudge paused';
    else if (e.nudge.skipDay === today) nudgeLabel = 'No nudge today';
    else if (data.wroteToday) nudgeLabel = 'Written today';
    else if (data.todays) nudgeLabel = `Nudge at ${formatTime(timeOfMinutes(minute))}`;
    else if (e.nudge.frequency === 'weekly') nudgeLabel = 'Nudge on your review day';
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" data-testid="week-strip">
      {e.rhythm !== null && (
        <span className="inline-flex items-center gap-2" title="Your weekly aim. Each week starts clean, and nothing counts what was missed.">
          <span className="flex gap-1" aria-hidden>
            {week.days.map((d) => (
              <span
                key={d.day}
                className={`h-2 w-2 rounded-full ${d.wrote ? 'bg-ember-400' : d.isFuture ? 'border border-ink-700' : 'bg-ink-800'} ${d.isToday ? 'ring-1 ring-paper-500 ring-offset-1 ring-offset-ink-950' : ''}`}
              />
            ))}
          </span>
          <span className="text-[11.5px] text-paper-500" data-testid="rhythm-line">
            {rhythmLine(week)}
          </span>
        </span>
      )}

      {nudgeLabel && (
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenu((v) => !v)}
            aria-expanded={menu}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-paper-500 hover:bg-ink-900 hover:text-paper-100"
            data-testid="nudge-status"
          >
            {e.nudge.skipDay === today || data.backed ? <BellOff size={12} /> : <BellRing size={12} />}
            {nudgeLabel}
          </button>
          {menu && (
            <div className="absolute left-0 top-7 z-20 w-56 rounded-xl border border-ink-700 bg-ink-850 p-1.5 shadow-xl" role="menu">
              {e.nudge.skipDay === today ? (
                <button type="button" role="menuitem" onClick={() => void save({ engagement: { nudge: { skipDay: null } } }).then(() => setMenu(false))} className="block w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-paper-100 hover:bg-ink-800">
                  Nudge me today after all
                </button>
              ) : (
                <button type="button" role="menuitem" onClick={() => void save({ engagement: { nudge: { skipDay: today } } }).then(() => setMenu(false))} className="block w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-paper-100 hover:bg-ink-800">
                  Not today
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  setTimeOpen(true);
                }}
                className="block w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-paper-100 hover:bg-ink-800"
              >
                Change time
              </button>
              {e.nudge.pausedUntil && e.nudge.pausedUntil >= today ? (
                <button type="button" role="menuitem" onClick={() => void save({ engagement: { nudge: { pausedUntil: null } } }).then(() => setMenu(false))} className="block w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-paper-100 hover:bg-ink-800">
                  Resume the nudge
                </button>
              ) : (
                <button type="button" role="menuitem" onClick={() => void save({ engagement: { nudge: { pausedUntil: addDays(today, 6) } } }).then(() => setMenu(false))} className="block w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-paper-100 hover:bg-ink-800">
                  Pause for a week
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <button type="button" onClick={onOpenWeek} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-paper-500 hover:bg-ink-900 hover:text-paper-100" data-testid="open-week">
        <CalendarRange size={12} /> Your week
      </button>
      {timeOpen && <WritingTimeDialog onClose={() => setTimeOpen(false)} />}
    </div>
  );
}
