'use client';

import { useEffect, useMemo, useRef } from 'react';
import { CalendarClock, Circle, Heart, Repeat as RepeatIcon, Scale } from 'lucide-react';
import { formatTime } from '@/lib/nl-date';
import { buildAgenda, monthGrid, timeToMinutes, weekDays, type AgendaData, type AgendaItem, type Occurrence } from '@/lib/planner';
import type { LocalDay, Task } from '@/lib/types';
import { formatDay } from '@/lib/util';

export interface CalendarHandlers {
  onEvent: (o: Occurrence) => void;
  onTask: (t: Task) => void;
  onNewEvent: (day: LocalDay, time: string | null) => void;
  onDay: (day: LocalDay) => void;
}

const HOUR_PX = 44;

function Chip({ item, onEvent, onTask, compact }: { item: AgendaItem; compact?: boolean } & Pick<CalendarHandlers, 'onEvent' | 'onTask'>) {
  const base = `flex w-full min-w-0 items-center gap-1 rounded px-1.5 ${compact ? 'py-px text-[11px]' : 'py-0.5 text-[12px]'} text-left`;
  if (item.kind === 'event') {
    const ev = item.occurrence.event;
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onEvent(item.occurrence);
        }}
        className={`${base} ${ev.big ? 'bg-ember-400/20 text-paper-50 hover:bg-ember-400/30' : 'bg-dusk-400/15 text-paper-100 hover:bg-dusk-400/25'}`}
        title={`${item.time ? `${formatTime(item.time)} ` : ''}${item.title}`}
      >
        {ev.big && <Heart size={10} className="shrink-0 text-ember-300" aria-label="Matters to you" />}
        {ev.repeat && <RepeatIcon size={10} className="shrink-0 opacity-70" aria-hidden />}
        {item.time && <span className="nr-num shrink-0 text-paper-300">{formatTime(item.time)}</span>}
        <span className="truncate">{item.title}</span>
      </button>
    );
  }
  if (item.kind === 'task') {
    const done = item.task.status === 'done';
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onTask(item.task);
        }}
        className={`${base} text-paper-300 hover:bg-ink-800 ${done ? 'line-through opacity-60' : ''}`}
        title={item.title}
      >
        <Circle size={9} className="shrink-0" aria-label="Task" />
        {item.time && <span className="nr-num shrink-0">{formatTime(item.time)}</span>}
        <span className="truncate">{item.title}</span>
      </button>
    );
  }
  return (
    <span className={`${base} text-dusk-300`} title={`Forecast: ${item.title}`}>
      <Scale size={10} className="shrink-0" aria-label="Forecast" />
      <span className="truncate">{item.title}</span>
    </span>
  );
}

export function MonthView({ data, anchor, today, weekStartsOn, ...h }: { data: AgendaData; anchor: LocalDay; today: LocalDay; weekStartsOn: 0 | 1 } & CalendarHandlers) {
  const days = useMemo(() => monthGrid(anchor, weekStartsOn), [anchor, weekStartsOn]);
  const items = useMemo(() => buildAgenda(data, days[0], days[days.length - 1], { includeDone: true }), [data, days]);
  const month = anchor.slice(0, 7);
  const labels = days.slice(0, 7).map((d) => formatDay(d, { weekday: 'short' }));
  return (
    <div className="flex h-full min-h-[420px] flex-col" role="grid" aria-label="Month">
      <div className="grid grid-cols-7 border-b border-ink-800" role="row">
        {labels.map((l) => (
          <div key={l} role="columnheader" className="px-2 py-1.5 text-[11.5px] text-paper-500">
            {l}
          </div>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-7 grid-rows-6">
        {days.map((day) => {
          // Multi-day events show on every day they cover.
          const list = items.filter((i) => (i.kind === 'event' ? i.day <= day && i.occurrence.endDay >= day : i.day === day));
          const inMonth = day.startsWith(month);
          return (
            <div
              key={day}
              role="gridcell"
              aria-label={formatDay(day, { weekday: 'long', day: 'numeric', month: 'long' })}
              onClick={() => h.onDay(day)}
              onDoubleClick={() => h.onNewEvent(day, null)}
              className={`min-h-0 cursor-pointer overflow-hidden border-b border-r border-ink-800 p-1 hover:bg-ink-900/60 ${inMonth ? '' : 'bg-ink-950/60'}`}
            >
              <p className={`mb-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[11.5px] nr-num ${day === today ? 'bg-ember-400 font-medium text-ink-950' : inMonth ? 'text-paper-300' : 'text-ink-600'}`}>{Number(day.slice(8))}</p>
              <div className="space-y-px">
                {list.slice(0, 3).map((i) => (
                  <Chip key={`${i.key}:${day}`} item={i} compact onEvent={h.onEvent} onTask={h.onTask} />
                ))}
                {list.length > 3 && <p className="px-1.5 text-[10.5px] text-paper-500">+{list.length - 3} more</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function layoutTimed(items: AgendaItem[]): { item: AgendaItem; top: number; height: number; col: number; cols: number }[] {
  const timed = items
    .filter((i) => i.time)
    .map((i) => {
      const start = timeToMinutes(i.time);
      const end = i.endTime && timeToMinutes(i.endTime) > start ? timeToMinutes(i.endTime) : start + (i.kind === 'task' ? 30 : 60);
      return { item: i, start, end };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);
  // Side by side when they overlap.
  const out: { item: AgendaItem; top: number; height: number; col: number; cols: number }[] = [];
  let cluster: typeof timed = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols: number[] = [];
    const placed = cluster.map((c) => {
      let col = cols.findIndex((end) => end <= c.start);
      if (col < 0) {
        col = cols.length;
        cols.push(c.end);
      } else cols[col] = c.end;
      return { c, col };
    });
    for (const { c, col } of placed) out.push({ item: c.item, top: (c.start / 60) * HOUR_PX, height: Math.max(18, ((c.end - c.start) / 60) * HOUR_PX - 2), col, cols: cols.length });
    cluster = [];
  };
  for (const t of timed) {
    if (cluster.length && t.start >= clusterEnd) flush();
    cluster.push(t);
    clusterEnd = Math.max(clusterEnd, t.end);
  }
  if (cluster.length) flush();
  return out;
}

export function WeekView({ data, anchor, today, weekStartsOn, single, ...h }: { data: AgendaData; anchor: LocalDay; today: LocalDay; weekStartsOn: 0 | 1; single?: boolean } & CalendarHandlers) {
  const days = useMemo(() => (single ? [anchor] : weekDays(anchor, weekStartsOn)), [anchor, weekStartsOn, single]);
  const items = useMemo(() => buildAgenda(data, days[0], days[days.length - 1], { includeDone: true }), [data, days]);
  const scroller = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // Start the day at 7am rather than midnight.
    if (scroller.current) scroller.current.scrollTop = 7 * HOUR_PX;
  }, [anchor]);
  const now = new Date();
  const nowTop = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX;

  return (
    <div className="flex h-full min-h-[420px] flex-col" aria-label={single ? 'Day' : 'Week'}>
      <div className="flex border-b border-ink-800">
        <div className="w-12 shrink-0" />
        {days.map((d) => (
          <button key={d} type="button" onClick={() => h.onDay(d)} className="min-w-0 flex-1 border-l border-ink-800 px-2 py-1.5 text-left hover:bg-ink-900">
            <span className="block text-[11px] text-paper-500">{formatDay(d, { weekday: 'short' })}</span>
            <span className={`nr-num text-[15px] ${d === today ? 'font-medium text-ember-300' : 'text-paper-100'}`}>{Number(d.slice(8))}</span>
          </button>
        ))}
      </div>
      {/* All-day row: all-day events, untimed tasks and forecasts. */}
      <div className="flex border-b border-ink-800">
        <div className="w-12 shrink-0 px-1 py-1 text-right text-[10px] text-paper-500">all day</div>
        {days.map((d) => {
          const list = items.filter((i) => !i.time && (i.kind === 'event' ? i.day <= d && i.occurrence.endDay >= d : i.day === d));
          return (
            <div key={d} className="min-w-0 flex-1 space-y-px border-l border-ink-800 p-1" onDoubleClick={() => h.onNewEvent(d, null)}>
              {list.map((i) => (
                <Chip key={`${i.key}:${d}`} item={i} compact onEvent={h.onEvent} onTask={h.onTask} />
              ))}
            </div>
          );
        })}
      </div>
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="relative flex" style={{ height: 24 * HOUR_PX }}>
          <div className="w-12 shrink-0">
            {Array.from({ length: 24 }, (_, hr) => (
              <div key={hr} className="relative text-right text-[10px] text-paper-500" style={{ height: HOUR_PX }}>
                <span className="absolute -top-1.5 right-1.5 nr-num">{hr === 0 ? '' : formatTime(`${String(hr).padStart(2, '0')}:00`)}</span>
              </div>
            ))}
          </div>
          {days.map((d) => {
            const placed = layoutTimed(items.filter((i) => i.day === d));
            return (
              <div
                key={d}
                className="relative min-w-0 flex-1 border-l border-ink-800"
                onDoubleClick={(e) => {
                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                  const minutes = Math.max(0, Math.min(23 * 60, Math.floor(((e.clientY - rect.top) / HOUR_PX) * 2) * 30));
                  h.onNewEvent(d, `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
                }}
              >
                {Array.from({ length: 24 }, (_, hr) => (
                  <div key={hr} className="border-b border-ink-800/60" style={{ height: HOUR_PX }} />
                ))}
                {d === today && <div className="pointer-events-none absolute left-0 right-0 z-10 h-px bg-ember-400" style={{ top: nowTop }} aria-hidden />}
                {placed.map(({ item, top, height, col, cols }) => (
                  <div key={item.key} className="absolute px-0.5" style={{ top, height, left: `${(col / cols) * 100}%`, width: `${100 / cols}%` }}>
                    {item.kind === 'event' ? (
                      <button
                        type="button"
                        onClick={() => h.onEvent(item.occurrence)}
                        title={`${formatTime(item.time)}${item.endTime ? ` to ${formatTime(item.endTime)}` : ''} ${item.title}`}
                        className={`flex h-full w-full overflow-hidden rounded-md border px-1.5 text-left text-[11.5px] ${height < 38 ? 'items-center gap-1 py-0' : 'flex-col py-1'} ${item.occurrence.event.big ? 'border-ember-400/50 bg-ember-400/20' : 'border-dusk-400/40 bg-dusk-400/15'} text-paper-50 hover:brightness-125`}
                      >
                        {height < 38 ? (
                          <>
                            <span className="nr-num shrink-0 text-[10.5px] text-paper-300">{formatTime(item.time)}</span>
                            <span className="truncate font-medium">{item.title}</span>
                          </>
                        ) : (
                          <>
                            <span className="truncate font-medium">{item.title}</span>
                            <span className="nr-num truncate text-[10.5px] text-paper-300">
                              {formatTime(item.time)}
                              {item.endTime ? ` to ${formatTime(item.endTime)}` : ''}
                              {item.occurrence.event.location ? ` · ${item.occurrence.event.location}` : ''}
                            </span>
                          </>
                        )}
                      </button>
                    ) : item.kind === 'task' ? (
                      <button type="button" onClick={() => h.onTask(item.task)} className="flex h-full w-full items-start gap-1 overflow-hidden rounded-md border border-ink-700 bg-ink-900 px-1.5 py-1 text-left text-[11.5px] text-paper-100 hover:bg-ink-850">
                        <Circle size={9} className="mt-0.5 shrink-0" aria-label="Task" />
                        <span className="truncate">{item.title}</span>
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** A plain list for narrow screens, where a week grid has no room. */
export function AgendaList({ data, from, to, today, ...h }: { data: AgendaData; from: LocalDay; to: LocalDay; today: LocalDay } & CalendarHandlers) {
  const items = useMemo(() => buildAgenda(data, from, to, { includeDone: false }), [data, from, to]);
  const byDay = new Map<string, AgendaItem[]>();
  for (const i of items) byDay.set(i.day, [...(byDay.get(i.day) ?? []), i]);
  if (!items.length) return <p className="px-2 py-6 text-[13px] text-paper-500">Nothing planned in these days.</p>;
  return (
    <ol className="space-y-3">
      {[...byDay.entries()].map(([day, list]) => (
        <li key={day}>
          <p className={`px-1 text-[12px] ${day === today ? 'font-medium text-ember-300' : 'text-paper-300'}`}>{formatDay(day, { weekday: 'long', day: 'numeric', month: 'short' })}</p>
          <div className="mt-1 space-y-1">
            {list.map((i) => (
              <Chip key={i.key} item={i} onEvent={h.onEvent} onTask={h.onTask} />
            ))}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function ForecastIcon() {
  return <CalendarClock size={12} className="text-dusk-300" aria-hidden />;
}
