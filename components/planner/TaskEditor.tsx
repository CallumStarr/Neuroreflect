'use client';

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookOpen, Check, RotateCcw, Trash2 } from 'lucide-react';
import { getDB } from '@/lib/db';
import { completeTask, deleteTask, ifThenSentence, letGoTask, reopenTask, updateTask } from '@/lib/planner';
import { useUI } from '@/lib/store';
import type { Task } from '@/lib/types';
import { formatDay } from '@/lib/util';
import Dialog from '../ui/Dialog';
import { fieldCls, labelCls, ReminderSelect, RepeatPicker } from './shared';

export default function TaskEditor({ task, onClose }: { task: Task; onClose: () => void }) {
  const [draft, setDraft] = useState<Task>(task);
  const [letGo, setLetGo] = useState(false);
  const [note, setNote] = useState('');
  const values = useLiveQuery(() => getDB().coreValues.orderBy('order').toArray(), []) ?? [];
  const source = useLiveQuery(() => (task.entryId ? getDB().entries.get(task.entryId) : undefined), [task.entryId]);
  const openEntry = useUI((s) => s.openEntry);
  const set = (patch: Partial<Task>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    const title = draft.title.trim();
    if (!title) return;
    const plan = draft.plan && (draft.plan.when.trim() || draft.plan.where.trim()) ? { when: draft.plan.when.trim(), where: draft.plan.where.trim() } : null;
    await updateTask(task.id, {
      title,
      notes: draft.notes,
      dueDay: draft.dueDay,
      dueTime: draft.dueDay ? draft.dueTime : null,
      repeat: draft.dueDay ? draft.repeat : null,
      plan,
      reminderMinutes: draft.dueDay ? draft.reminderMinutes : null,
      valueId: draft.valueId,
    });
    onClose();
  };

  const plan = draft.plan ?? { when: '', where: '' };
  return (
    <Dialog label="Edit task" title="Task" onClose={onClose} width="w-[520px]">
      <div className="space-y-4">
        <div>
          <label htmlFor="tk-title" className={labelCls}>
            What
          </label>
          <input id="tk-title" value={draft.title} onChange={(e) => set({ title: e.target.value })} className={`${fieldCls} mt-1`} onKeyDown={(e) => e.key === 'Enter' && void save()} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="tk-day" className={labelCls}>
              Day
            </label>
            <input id="tk-day" type="date" value={draft.dueDay ?? ''} onChange={(e) => set({ dueDay: e.target.value || null })} className={`${fieldCls} mt-1 [color-scheme:dark]`} />
          </div>
          <div>
            <label htmlFor="tk-time" className={labelCls}>
              Time (optional)
            </label>
            <input id="tk-time" type="time" disabled={!draft.dueDay} value={draft.dueTime ?? ''} onChange={(e) => set({ dueTime: e.target.value || null })} className={`${fieldCls} mt-1 [color-scheme:dark] disabled:opacity-40`} />
          </div>
        </div>
        {draft.dueDay && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="tk-repeat" className={labelCls}>
                Repeat
              </label>
              <div className="mt-1">
                <RepeatPicker id="tk-repeat" value={draft.repeat} onChange={(repeat) => set({ repeat })} day={draft.dueDay} allowFromCompletion />
              </div>
            </div>
            <div>
              <label htmlFor="tk-remind" className={labelCls}>
                Reminder
              </label>
              <div className="mt-1">
                <ReminderSelect id="tk-remind" value={draft.reminderMinutes} onChange={(reminderMinutes) => set({ reminderMinutes })} allDay={!draft.dueTime} />
              </div>
            </div>
          </div>
        )}

        <fieldset className="rounded-xl border border-ink-700 p-3">
          <legend className="px-1 text-[12.5px] text-paper-300">When and where (optional)</legend>
          <p className="text-[12px] leading-5 text-paper-500">Naming the moment and the place turns a task into an if-then plan, which tends to make it more likely to happen.</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input aria-label="When" value={plan.when} onChange={(e) => set({ plan: { ...plan, when: e.target.value } })} placeholder="When I get home" className={fieldCls} />
            <input aria-label="Where" value={plan.where} onChange={(e) => set({ plan: { ...plan, where: e.target.value } })} placeholder="at the kitchen table" className={fieldCls} />
          </div>
          {(plan.when.trim() || plan.where.trim()) && draft.title.trim() && (
            <p className="mt-2 font-serif text-[14.5px] italic leading-6 text-paper-100" data-testid="if-then-preview">
              {ifThenSentence(draft.title, plan)}
            </p>
          )}
        </fieldset>

        {values.length > 0 && (
          <div>
            <label htmlFor="tk-value" className={labelCls}>
              Something that matters
            </label>
            <select id="tk-value" value={draft.valueId ?? ''} onChange={(e) => set({ valueId: e.target.value || null })} className={`${fieldCls} mt-1 [color-scheme:dark]`}>
              <option value="">Not linked to a value</option>
              {values.map((v) => (
                <option key={v.id} value={v.id}>
                  For {v.label.toLowerCase()}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[12px] text-paper-500">Linked tasks get a &ldquo;How did it go?&rdquo; prompt once they&apos;re done.</p>
          </div>
        )}
        <div>
          <label htmlFor="tk-notes" className={labelCls}>
            Notes
          </label>
          <textarea id="tk-notes" rows={2} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} className={`${fieldCls} mt-1 resize-none`} />
        </div>

        {task.entryId && (
          <button
            type="button"
            onClick={() => {
              openEntry(task.entryId);
              onClose();
            }}
            className="flex w-full items-start gap-2 rounded-lg border border-ink-700 px-3 py-2 text-left text-[12.5px] text-paper-300 hover:bg-ink-900"
          >
            <BookOpen size={14} className="mt-0.5 shrink-0 text-ember-400" />
            <span>
              From your entry{source ? ` on ${formatDay(source.localDay)}` : ''}
              {task.sourceText && <span className="mt-0.5 block font-serif italic text-paper-100">&ldquo;{task.sourceText}&rdquo;</span>}
            </span>
          </button>
        )}

        {letGo ? (
          <div className="rounded-xl border border-ink-700 bg-ink-900 p-3">
            <p className="text-[13px] text-paper-100">Letting go is a real choice, not a failure. Want to note why? (optional)</p>
            <input aria-label="Why let it go" value={note} onChange={(e) => setNote(e.target.value)} className={`${fieldCls} mt-2`} placeholder="It stopped mattering, or it was never mine to do" />
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={() => setLetGo(false)} className="rounded-lg px-3 py-1.5 text-[13px] text-paper-300 hover:bg-ink-800">
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await letGoTask(task.id, note);
                  onClose();
                }}
                className="rounded-lg border border-ink-600 px-3 py-1.5 text-[13px] text-paper-100 hover:bg-ink-800"
              >
                Let it go
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-800 pt-3">
            <div className="flex gap-1">
              {task.status === 'open' ? (
                <>
                  <button
                    type="button"
                    onClick={async () => {
                      await completeTask(task.id);
                      onClose();
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-sage-300 hover:bg-ink-800"
                  >
                    <Check size={14} /> Done
                  </button>
                  <button type="button" onClick={() => setLetGo(true)} className="rounded-lg px-2.5 py-1.5 text-[13px] text-paper-300 hover:bg-ink-800">
                    Let go
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={async () => {
                    await reopenTask(task.id);
                    onClose();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-paper-300 hover:bg-ink-800"
                >
                  <RotateCcw size={14} /> Put back on the list
                </button>
              )}
              <button
                type="button"
                aria-label="Delete task"
                onClick={async () => {
                  await deleteTask(task.id);
                  onClose();
                }}
                className="rounded-lg px-2.5 py-1.5 text-paper-500 hover:bg-ink-800 hover:text-rose-300"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-[13px] text-paper-300 hover:bg-ink-800">
                Cancel
              </button>
              <button type="button" onClick={() => void save()} className="rounded-lg bg-ember-400 px-3.5 py-1.5 text-[13px] font-medium text-ink-950 hover:bg-ember-300">
                Save
              </button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
