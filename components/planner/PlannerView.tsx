'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react';
import { getDB } from '@/lib/db';
import { newEvent, startOfWeek, type AgendaData, type Occurrence } from '@/lib/planner';
import { useUI, type PlannerMode } from '@/lib/store';
import type { LocalDay, PlanEvent, Task } from '@/lib/types';
import { addDays, formatDay } from '@/lib/util';
import Segmented from '../ui/Segmented';
import { useMediaQuery } from '../useMediaQuery';
import { AgendaList, MonthView, WeekView } from './Calendar';
import ComingUpPanel from './ComingUpPanel';
import EventEditor from './EventEditor';
import { useToday } from './shared';
import TaskEditor from './TaskEditor';
import TodoPanel from './TodoPanel';
import WeeklyReview from './WeeklyReview';

type Pane = 'todo' | 'calendar' | 'upcoming';

function addMonths(day: LocalDay, delta: number): LocalDay {
  const [y, m] = day.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function PlannerView() {
  const { plannerMode, setPlannerMode, plannerDay, setPlannerDay, focusTaskId, openTask, settings } = useUI();
  const today = useToday();
  const anchor = plannerDay ?? today;
  const weekStartsOn = settings.planner.weekStartsOn;
  const [pane, setPane] = useState<Pane>('todo');
  const [editingEvent, setEditingEvent] = useState<{ event: PlanEvent; day?: LocalDay; isNew: boolean } | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const wide = useMediaQuery('(min-width: 1024px)');
  const widest = useMediaQuery('(min-width: 1280px)');
  const weekStart = startOfWeek(anchor, weekStartsOn);

  const live = useLiveQuery(async () => {
    const db = getDB();
    const [events, tasks, forecasts, values, notes] = await Promise.all([db.events.toArray(), db.tasks.toArray(), db.forecasts.toArray(), db.coreValues.orderBy('order').toArray(), db.notes.toArray()]);
    return { events, tasks, forecasts, values, notes };
  }, []);
  const data: AgendaData = useMemo(() => ({ events: live?.events ?? [], tasks: live?.tasks ?? [], forecasts: live?.forecasts ?? [] }), [live]);

  // Opening a task from elsewhere (an entry, a reminder) shows its editor here.
  useEffect(() => {
    if (!focusTaskId || !live) return;
    const t = live.tasks.find((x) => x.id === focusTaskId);
    if (t) setEditingTask(t);
    openTask(null);
  }, [focusTaskId, live, openTask]);

  const step = (dir: -1 | 1) => {
    if (plannerMode === 'month') setPlannerDay(addMonths(anchor, dir));
    else setPlannerDay(addDays(anchor, plannerMode === 'week' ? dir * 7 : dir));
  };
  const title =
    plannerMode === 'month'
      ? formatDay(`${anchor.slice(0, 7)}-01`, { month: 'long', year: 'numeric' })
      : plannerMode === 'day'
        ? formatDay(anchor, { weekday: 'long', day: 'numeric', month: 'long' })
        : `Week of ${formatDay(weekStart, { day: 'numeric', month: 'long' })}`;

  const handlers = {
    onEvent: (o: Occurrence) => setEditingEvent({ event: o.event, day: o.day, isNew: false }),
    onTask: (t: Task) => setEditingTask(t),
    onNewEvent: (day: LocalDay, time: string | null) =>
      setEditingEvent({
        event: newEvent({
          title: '',
          startDay: day,
          startTime: time,
          endTime: time ? `${String(Math.min(23, Number(time.slice(0, 2)) + 1)).padStart(2, '0')}:${time.slice(3)}` : null,
          reminderMinutes: time ? settings.planner.defaultReminder : null,
        }),
        isNew: true,
      }),
    onDay: (day: LocalDay) => {
      setPlannerDay(day);
      setPlannerMode('day');
    },
  };

  const todo = <TodoPanel tasks={data.tasks} notes={live?.notes ?? []} values={live?.values ?? []} today={today} onOpen={setEditingTask} />;
  const upcoming = <ComingUpPanel data={data} today={today} onEvent={handlers.onEvent} onTask={handlers.onTask} onWeeklyReview={() => setReviewOpen(true)} />;
  const calendar =
    plannerMode === 'month' ? (
      <MonthView data={data} anchor={anchor} today={today} weekStartsOn={weekStartsOn} {...handlers} />
    ) : (
      <WeekView data={data} anchor={anchor} today={today} weekStartsOn={weekStartsOn} single={plannerMode === 'day'} {...handlers} />
    );

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-ink-800 px-4 py-3 sm:px-6">
        <h1 className="font-serif text-[1.35rem] text-paper-50">Planner</h1>
        <Segmented<PlannerMode>
          label="Calendar view"
          value={plannerMode}
          onChange={setPlannerMode}
          options={[
            { id: 'day', label: 'Day' },
            { id: 'week', label: 'Week' },
            { id: 'month', label: 'Month' },
          ]}
        />
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous" onClick={() => step(-1)} className="rounded p-1.5 text-paper-300 hover:bg-ink-900">
            <ChevronLeft size={16} />
          </button>
          <button type="button" onClick={() => setPlannerDay(null)} className="rounded-lg border border-ink-700 px-2.5 py-1 text-[12.5px] text-paper-100 hover:bg-ink-900">
            Today
          </button>
          <button type="button" aria-label="Next" onClick={() => step(1)} className="rounded p-1.5 text-paper-300 hover:bg-ink-900">
            <ChevronRight size={16} />
          </button>
        </div>
        <p className="min-w-0 flex-1 truncate text-[13px] text-paper-300" aria-live="polite">
          {title}
        </p>
        <button type="button" onClick={() => handlers.onNewEvent(plannerMode === 'month' ? today : anchor, null)} className="inline-flex items-center gap-1.5 rounded-lg bg-ember-400 px-3 py-1.5 text-[12.5px] font-medium text-ink-950 hover:bg-ember-300">
          <CalendarPlus size={14} /> New event
        </button>
      </header>

      {wide ? (
        <div className="flex min-h-0 flex-1">
          <aside className="w-[300px] shrink-0 overflow-y-auto border-r border-ink-800 p-4" aria-label="To-do list">
            {todo}
            {!widest && <div className="mt-6 border-t border-ink-800 pt-4">{upcoming}</div>}
          </aside>
          <section className="min-w-0 flex-1" aria-label="Calendar">
            {calendar}
          </section>
          {widest && (
            <aside className="w-[280px] shrink-0 overflow-y-auto border-l border-ink-800 p-4" aria-label="Coming up">
              {upcoming}
            </aside>
          )}
        </div>
      ) : (
        // Phones and small windows: one pane at a time.
        <>
          <div className="border-b border-ink-800 px-4 py-2">
            <Segmented<Pane>
              label="Planner section"
              value={pane}
              onChange={setPane}
              options={[
                { id: 'todo', label: 'To do' },
                { id: 'calendar', label: 'Calendar' },
                { id: 'upcoming', label: 'Coming up' },
              ]}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {pane === 'todo' && todo}
            {pane === 'calendar' &&
              (plannerMode === 'month' ? calendar : <AgendaList data={data} from={plannerMode === 'day' ? anchor : weekStart} to={plannerMode === 'day' ? anchor : addDays(weekStart, 6)} today={today} {...handlers} />)}
            {pane === 'upcoming' && upcoming}
          </div>
        </>
      )}

      {editingEvent && <EventEditor event={editingEvent.event} occurrenceDay={editingEvent.day} isNew={editingEvent.isNew} onClose={() => setEditingEvent(null)} />}
      {editingTask && <TaskEditor task={editingTask} onClose={() => setEditingTask(null)} />}
      {reviewOpen && <WeeklyReview data={data} today={today} weekStartsOn={weekStartsOn} onClose={() => setReviewOpen(false)} />}
    </div>
  );
}
