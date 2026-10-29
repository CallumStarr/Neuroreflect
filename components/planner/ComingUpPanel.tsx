'use client';

import { useMemo } from 'react';
import { BellOff, CalendarRange, Heart, Scale } from 'lucide-react';
import { describeWhen, formatTime } from '@/lib/nl-date';
import { comingUp, type AgendaData, type Occurrence } from '@/lib/planner';
import { markShown } from '@/lib/reminders';
import type { LocalDay, Task } from '@/lib/types';
import { formatDay } from '@/lib/util';
import { useMissed } from '../useReminders';

interface Props {
  data: AgendaData;
  today: LocalDay;
  onEvent: (o: Occurrence) => void;
  onTask: (t: Task) => void;
  onWeeklyReview: () => void;
}

export default function ComingUpPanel({ data, today, onEvent, onTask, onWeeklyReview }: Props) {
  const items = useMemo(() => comingUp(data, today, 7), [data, today]);
  const { missed, clear } = useMissed();
  const days = new Map<string, typeof items>();
  for (const i of items) days.set(i.day, [...(days.get(i.day) ?? []), i]);

  return (
    <div className="flex flex-col gap-4" data-testid="coming-up">
      {missed.length > 0 && (
        <section className="rounded-xl border border-ember-500/40 bg-ember-500/[0.07] p-3" aria-label="Missed reminders">
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-paper-100">
            <BellOff size={14} className="text-ember-300" /> While NeuroReflect was closed
          </p>
          <ul className="mt-1.5 space-y-1">
            {missed.map((m) => (
              <li key={m.id} className="text-[12.5px] leading-5 text-paper-100">
                {m.title} <span className="text-paper-500">· {describeWhen(m.day, null, today)}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={async () => {
              await markShown(missed.map((m) => m.id));
              clear();
            }}
            className="mt-2 rounded-lg border border-ink-700 px-2.5 py-1 text-[12px] text-paper-100 hover:bg-ink-800"
          >
            Got it
          </button>
        </section>
      )}

      <section aria-label="Coming up">
        <h3 className="px-1 text-[12px] font-medium text-paper-300">Coming up, next 7 days</h3>
        {items.length === 0 ? (
          <p className="px-1 pt-1 text-[12.5px] text-paper-500">Nothing planned. Events, dated tasks and forecasts show here.</p>
        ) : (
          <ol className="mt-1 space-y-2.5">
            {[...days.entries()].map(([day, list]) => (
              <li key={day}>
                <p className={`px-1 text-[11.5px] ${day === today ? 'text-ember-300' : 'text-paper-500'}`}>{day === today ? 'Today' : formatDay(day, { weekday: 'long', day: 'numeric', month: 'short' })}</p>
                <ul className="mt-0.5">
                  {list.map((i) => (
                    <li key={i.key}>
                      <button
                        type="button"
                        onClick={() => (i.kind === 'event' ? onEvent(i.occurrence) : i.kind === 'task' ? onTask(i.task) : undefined)}
                        className="flex w-full items-baseline gap-2 rounded-md px-1.5 py-1 text-left hover:bg-ink-900"
                      >
                        <span className="nr-num w-12 shrink-0 text-[11.5px] text-paper-500">{i.time ? formatTime(i.time) : i.kind === 'task' ? 'to do' : 'all day'}</span>
                        <span className="min-w-0 flex-1 text-[13px] leading-5 text-paper-100">
                          {i.kind === 'event' && i.occurrence.event.big && <Heart size={11} className="mr-1 inline text-ember-300" aria-label="Matters to you" />}
                          {i.kind === 'forecast' && <Scale size={11} className="mr-1 inline text-dusk-300" aria-label="Forecast" />}
                          {i.title}
                          {i.kind === 'forecast' && <span className="text-paper-500"> · forecast to check</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </section>

      <button type="button" onClick={onWeeklyReview} className="flex items-center gap-2 rounded-xl border border-ink-700 px-3 py-2.5 text-left hover:bg-ink-900">
        <CalendarRange size={15} className="shrink-0 text-ember-400" />
        <span>
          <span className="block text-[13px] text-paper-50">Your week</span>
          <span className="block text-[12px] text-paper-500">Takeaways, plans, forecasts, and what got done</span>
        </span>
      </button>
    </div>
  );
}
