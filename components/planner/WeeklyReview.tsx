'use client';

import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getDB } from '@/lib/db';
import { buildAgenda, startOfWeek, type AgendaData } from '@/lib/planner';
import { useUI } from '@/lib/store';
import type { LocalDay } from '@/lib/types';
import { addDays, formatDay, localDayOf } from '@/lib/util';
import Dialog from '../ui/Dialog';

// Progress was the most prominent feature of people's best working days
// (Amabile & Kramer), so the review starts with what got done, puts what was
// let go beside it without judgement, and ends with one question.

export default function WeeklyReview({ data, today, weekStartsOn, onClose }: { data: AgendaData; today: LocalDay; weekStartsOn: 0 | 1; onClose: () => void }) {
  const [start, setStart] = useState(() => startOfWeek(today, weekStartsOn));
  const end = addDays(start, 6);
  const { startEntryWith, openEntry } = useUI();
  const entries = useLiveQuery(() => getDB().entries.where('localDay').between(start, end, true, true).toArray(), [start, end]) ?? [];
  const inWeek = (iso: string | null) => !!iso && localDayOf(new Date(iso)) >= start && localDayOf(new Date(iso)) <= end;
  const done = data.tasks.filter((t) => t.status === 'done' && inWeek(t.doneAt));
  const letGo = data.tasks.filter((t) => t.status === 'let_go' && inWeek(t.doneAt));
  const events = useMemo(() => buildAgenda({ ...data, tasks: [] }, start, end).filter((i) => i.kind === 'event'), [data, start, end]);

  const Column = ({ title, empty, children, count }: { title: string; empty: string; children: React.ReactNode; count: number }) => (
    <section className="min-w-0 rounded-xl border border-ink-800 bg-ink-900/60 p-3">
      <h3 className="text-[12px] font-medium text-paper-300">
        {title} <span className="font-normal text-paper-500">{count || ''}</span>
      </h3>
      {count ? <ul className="mt-1.5 space-y-1">{children}</ul> : <p className="mt-1.5 text-[12px] text-paper-500">{empty}</p>}
    </section>
  );

  return (
    <Dialog label="Week in review" title="Week in review" onClose={onClose} width="w-[880px]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-paper-100">
          {formatDay(start, { day: 'numeric', month: 'short' })} to {formatDay(end, { day: 'numeric', month: 'short' })}
        </p>
        <div className="flex gap-1">
          <button type="button" aria-label="Previous week" onClick={() => setStart(addDays(start, -7))} className="rounded p-1.5 text-paper-300 hover:bg-ink-800">
            <ChevronLeft size={15} />
          </button>
          <button type="button" aria-label="Next week" disabled={addDays(start, 7) > today} onClick={() => setStart(addDays(start, 7))} className="rounded p-1.5 text-paper-300 hover:bg-ink-800 disabled:opacity-30">
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Column title="Done" empty="Nothing ticked off this week. Rest counts too." count={done.length}>
          {done.map((t) => (
            <li key={t.id} className="text-[12.5px] leading-5 text-paper-100">
              {t.title}
            </li>
          ))}
        </Column>
        <Column title="Let go" empty="Nothing let go." count={letGo.length}>
          {letGo.map((t) => (
            <li key={t.id} className="text-[12.5px] leading-5 text-paper-300">
              {t.title}
              {t.letGoNote && <span className="block text-[11.5px] italic text-paper-500">{t.letGoNote}</span>}
            </li>
          ))}
        </Column>
        <Column title="Events" empty="No events this week." count={events.length}>
          {events.map((e) => (
            <li key={e.key} className="text-[12.5px] leading-5 text-paper-100">
              {e.title} <span className="text-paper-500">· {formatDay(e.day, { weekday: 'short' })}</span>
            </li>
          ))}
        </Column>
        <Column title="Entries" empty="No entries this week." count={entries.length}>
          {entries
            .sort((a, b) => a.localDay.localeCompare(b.localDay))
            .map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => {
                    openEntry(e.id);
                    onClose();
                  }}
                  className="text-left text-[12.5px] leading-5 text-paper-100 underline decoration-ink-600 underline-offset-2 hover:text-paper-50"
                >
                  {e.title || e.blocks.find((b) => b.text.trim())?.text.slice(0, 40) || 'Untitled'}
                </button>{' '}
                <span className="text-[12px] text-paper-500">· {formatDay(e.localDay, { weekday: 'short' })}</span>
              </li>
            ))}
        </Column>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-ink-800 pt-3">
        <p className="font-serif text-[15px] italic text-paper-100">What moved forward this week, even a little?</p>
        <button
          type="button"
          onClick={() => {
            startEntryWith({ id: `weekly-review:${start}`, text: 'What moved forward this week, even a little?', reason: `Your week in review, ${formatDay(start, { day: 'numeric', month: 'short' })} to ${formatDay(end, { day: 'numeric', month: 'short' })}.` });
            onClose();
          }}
          className="rounded-lg bg-ember-400 px-3.5 py-1.5 text-[13px] font-medium text-ink-950 hover:bg-ember-300"
        >
          Write about it
        </button>
      </div>
    </Dialog>
  );
}
