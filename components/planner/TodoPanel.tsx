'use client';

import { useMemo, useState } from 'react';
import { BookOpen, Check, ChevronDown, ChevronRight, Circle, Hourglass, ListTodo, Repeat as RepeatIcon, StickyNote, Target, Trash2 } from 'lucide-react';
import { getDB } from '@/lib/db';
import { describeRepeat, describeWhen, formatTime } from '@/lib/nl-date';
import { addTask, bucketOf, completeTask, keepTask, letGoTask, moveTask, needsReview, reopenTask, type Bucket } from '@/lib/planner';
import { useUI } from '@/lib/store';
import { toast } from '@/lib/toasts';
import type { CaptureNote, CoreValue, Task } from '@/lib/types';
import { addDays, localDayOf } from '@/lib/util';
import QuickAddInput from './QuickAddInput';

/** "yesterday" or "Thu 15 Oct": lower case only for the relative words. */
function sinceLabel(day: string, today: string): string {
  const label = describeWhen(day, null, today);
  return /^(Today|Tomorrow|Yesterday)$/.test(label) ? label.toLowerCase() : label;
}

const BUCKETS: { id: Bucket; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'later', label: 'Later' },
];

function TaskRow({ task, today, values, onOpen }: { task: Task; today: string; values: CoreValue[]; onOpen: (t: Task) => void }) {
  const done = task.status === 'done';
  const value = values.find((v) => v.id === task.valueId);
  const meta: React.ReactNode[] = [];
  if (task.dueDay && bucketOf(task, today) === 'later') meta.push(describeWhen(task.dueDay, task.dueTime, today));
  else if (task.dueTime) meta.push(formatTime(task.dueTime));
  if (task.dueDay && task.dueDay < today) meta.push(<span key="since" className="text-paper-500">planned for {sinceLabel(task.dueDay, today)}</span>);
  return (
    <li className="group flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-ink-900">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark ${task.title} not done` : `Mark ${task.title} done`}
        onClick={async () => {
          if (done) await reopenTask(task.id);
          else {
            await completeTask(task.id);
            if (task.repeat) toast({ title: 'Done', body: `${task.title} comes round again on its next date.` });
          }
        }}
        className={`mt-0.5 shrink-0 rounded-full ${done ? 'text-sage-400' : 'text-paper-500 hover:text-sage-300'}`}
      >
        {done ? <Check size={16} strokeWidth={2.2} /> : <Circle size={16} strokeWidth={1.6} />}
      </button>
      <button type="button" onClick={() => onOpen(task)} className="min-w-0 flex-1 text-left">
        <span className={`block text-[13.5px] leading-5 ${done ? 'text-paper-500 line-through decoration-ink-600' : 'text-paper-50'}`}>{task.title}</span>
        {(meta.length > 0 || task.repeat || task.plan || task.entryId || value) && (
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-paper-500">
            {meta.map((m, i) => (
              <span key={i}>{m}</span>
            ))}
            {task.repeat && (
              <span className="inline-flex items-center gap-0.5" title={describeRepeat(task.repeat.rule, task.repeat.fromCompletion)}>
                <RepeatIcon size={11} /> {describeRepeat(task.repeat.rule, task.repeat.fromCompletion)}
              </span>
            )}
            {task.plan && (task.plan.when || task.plan.where) && (
              <span className="inline-flex items-center gap-0.5 text-ember-300" title="Has a when and where">
                <Target size={11} /> {[task.plan.when, task.plan.where].filter(Boolean).join(', ')}
              </span>
            )}
            {value && <span className="text-dusk-300">for {value.label.toLowerCase()}</span>}
            {task.entryId && (
              <span className="inline-flex items-center gap-0.5" title="Came from an entry">
                <BookOpen size={11} /> from an entry
              </span>
            )}
          </span>
        )}
      </button>
    </li>
  );
}

function ReviewCard({ tasks, today }: { tasks: Task[]; today: string }) {
  const [moving, setMoving] = useState<string | null>(null);
  if (!tasks.length) return null;
  return (
    <section className="rounded-xl border border-ink-700 bg-ink-900 p-3" aria-label="Waiting a while">
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-paper-100">
        <Hourglass size={14} className="text-ember-400" /> A few things have waited a while
      </p>
      <p className="mt-0.5 text-[12px] leading-5 text-paper-500">Keep them, give them a new day, or let them go. Letting go of what no longer fits is a real choice.</p>
      <ul className="mt-2 space-y-2">
        {tasks.slice(0, 4).map((t) => (
          <li key={t.id} className="rounded-lg border border-ink-800 px-2.5 py-2">
            <p className="text-[13px] text-paper-50">{t.title}</p>
            <p className="text-[11.5px] text-paper-500">{t.dueDay ? `Planned for ${sinceLabel(t.dueDay, today)}` : 'No date, added a while ago'}</p>
            {moving === t.id ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {[
                  { label: 'Tomorrow', day: addDays(today, 1) },
                  { label: 'Next week', day: addDays(today, 7) },
                  { label: 'No date', day: null },
                ].map((o) => (
                  <button key={o.label} type="button" onClick={() => void moveTask(t.id, o.day).then(() => setMoving(null))} className="rounded-md border border-ink-700 px-2 py-0.5 text-[12px] text-paper-100 hover:bg-ink-800">
                    {o.label}
                  </button>
                ))}
                <input
                  type="date"
                  aria-label="Pick a day"
                  min={today}
                  onChange={(e) => e.target.value && void moveTask(t.id, e.target.value).then(() => setMoving(null))}
                  className="rounded-md border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[12px] text-paper-50 [color-scheme:dark]"
                />
              </div>
            ) : (
              <div className="mt-1.5 flex gap-1">
                <button type="button" onClick={() => void keepTask(t.id)} className="rounded-md border border-ink-700 px-2 py-0.5 text-[12px] text-paper-100 hover:bg-ink-800">
                  Keep
                </button>
                <button type="button" onClick={() => setMoving(t.id)} className="rounded-md border border-ink-700 px-2 py-0.5 text-[12px] text-paper-100 hover:bg-ink-800">
                  Move
                </button>
                <button type="button" onClick={() => void letGoTask(t.id)} className="rounded-md border border-ink-700 px-2 py-0.5 text-[12px] text-paper-300 hover:bg-ink-800">
                  Let go
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function NotesSection({ notes }: { notes: CaptureNote[] }) {
  const startEntryWith = useUI((s) => s.startEntryWith);
  const [open, setOpen] = useState(true);
  const list = notes.filter((n) => !n.doneAt).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (!list.length) return null;
  const worries = list.filter((n) => n.kind === 'worry').length;
  return (
    <section aria-label="Notes">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-1 px-1 text-[12px] font-medium text-paper-300">
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Notes <span className="font-normal text-paper-500">{list.length}{worries ? `, ${worries} parked worr${worries === 1 ? 'y' : 'ies'}` : ''}</span>
      </button>
      {open && (
        <ul className="mt-1 space-y-1">
          {list.map((n) => (
            <li key={n.id} className="group rounded-lg px-2 py-1.5 hover:bg-ink-900">
              <p className="flex items-start gap-2 text-[13px] leading-5 text-paper-100">
                {n.kind === 'worry' ? <Hourglass size={13} className="mt-1 shrink-0 text-dusk-300" aria-label="Parked worry" /> : <StickyNote size={13} className="mt-1 shrink-0 text-paper-500" aria-hidden />}
                <span className="min-w-0 flex-1 whitespace-pre-wrap">{n.text}</span>
              </p>
              <div className="ml-5 mt-1 flex flex-wrap gap-1 text-[11.5px]">
                <button
                  type="button"
                  onClick={async () => {
                    await addTask({ title: n.text.split('\n')[0].slice(0, 120) });
                    await getDB().notes.update(n.id, { doneAt: new Date().toISOString() });
                  }}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-paper-300 hover:bg-ink-800"
                >
                  <ListTodo size={11} /> Make it a task
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await getDB().notes.update(n.id, { doneAt: new Date().toISOString() });
                    startEntryWith({ id: `note:${n.id}`, text: n.text, reason: n.kind === 'worry' ? 'A worry you parked.' : 'A note you captured.' });
                  }}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-paper-300 hover:bg-ink-800"
                >
                  <BookOpen size={11} /> Write about it
                </button>
                <button type="button" aria-label="Delete note" onClick={() => void getDB().notes.delete(n.id)} className="rounded px-1.5 py-0.5 text-paper-500 hover:bg-ink-800 hover:text-rose-300">
                  <Trash2 size={11} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function TodoPanel({ tasks, notes, values, today, onOpen }: { tasks: Task[]; notes: CaptureNote[]; values: CoreValue[]; today: string; onOpen: (t: Task) => void }) {
  const [showDone, setShowDone] = useState(false);
  const open = useMemo(() => tasks.filter((t) => t.status === 'open'), [tasks]);
  const review = useMemo(() => open.filter((t) => needsReview(t, today)), [open, today]);
  const reviewIds = new Set(review.map((t) => t.id));
  const doneToday = tasks.filter((t) => t.status === 'done' && t.doneAt && localDayOf(new Date(t.doneAt)) === today);
  const byBucket = (b: Bucket) =>
    open
      .filter((t) => bucketOf(t, today) === b && !reviewIds.has(t.id))
      .sort((a, b2) => (a.dueDay ?? '9999').localeCompare(b2.dueDay ?? '9999') || (a.dueTime ?? '99').localeCompare(b2.dueTime ?? '99') || a.order - b2.order);

  return (
    <div className="flex flex-col gap-4" data-testid="todo-panel">
      <QuickAddInput
        label="Add a task"
        placeholder="Add a task, like 'ring Mum Friday 6pm'"
        onSubmit={async ({ title, when }) => {
          if (!title.trim()) return;
          await addTask({ title, dueDay: when?.day ?? (when?.repeat ? today : null), dueTime: when?.time ?? null, repeat: when?.repeat ?? null });
        }}
      />
      <ReviewCard tasks={review} today={today} />
      {BUCKETS.map((b) => {
        const list = byBucket(b.id);
        return (
          <section key={b.id} aria-label={b.label}>
            <h3 className="px-1 text-[12px] font-medium text-paper-300">
              {b.label} <span className="font-normal text-paper-500">{list.length || ''}</span>
            </h3>
            {list.length ? (
              <ul className="mt-1">
                {list.map((t) => (
                  <TaskRow key={t.id} task={t} today={today} values={values} onOpen={onOpen} />
                ))}
              </ul>
            ) : (
              <p className="px-1 pt-1 text-[12px] text-paper-500">{b.id === 'today' ? 'Nothing for today.' : b.id === 'tomorrow' ? 'Nothing yet.' : 'Anything without a date lands here.'}</p>
            )}
          </section>
        );
      })}
      {doneToday.length > 0 && (
        <section aria-label="Done today">
          <button type="button" onClick={() => setShowDone((v) => !v)} className="flex items-center gap-1 px-1 text-[12px] font-medium text-paper-300">
            {showDone ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Done today <span className="font-normal text-paper-500">{doneToday.length}</span>
          </button>
          {showDone && (
            <ul className="mt-1">
              {doneToday.map((t) => (
                <TaskRow key={t.id} task={t} today={today} values={values} onOpen={onOpen} />
              ))}
            </ul>
          )}
        </section>
      )}
      <NotesSection notes={notes} />
    </div>
  );
}
