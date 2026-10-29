'use client';

import { useState } from 'react';
import { getDB } from '@/lib/db';
import { describeWhen } from '@/lib/nl-date';
import { addTask } from '@/lib/planner';
import { useUI } from '@/lib/store';
import { toast } from '@/lib/toasts';
import { uid } from '@/lib/util';
import QuickAddInput from './planner/QuickAddInput';
import Dialog from './ui/Dialog';
import Segmented from './ui/Segmented';

type Kind = 'task' | 'note' | 'worry';

// Catches a thought before it's gone: a task (with a date typed in), a note to
// come back to, or a worry parked for the worry period.
export default function QuickCapture({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<Kind>('task');
  const [text, setText] = useState('');
  const worryOn = useUI((s) => s.settings.planner.worryPeriod.enabled);

  const saveNote = async () => {
    const value = text.trim();
    if (!value) return;
    await getDB().notes.add({ id: uid('nt'), kind: kind === 'worry' ? 'worry' : 'note', text: value.slice(0, 2000), createdAt: new Date().toISOString(), doneAt: null, entryId: null });
    toast({ title: kind === 'worry' ? 'Parked for your worry period' : 'Note saved', body: kind === 'worry' ? 'It will be waiting for you then.' : 'It is in the planner, under Notes.' });
    onClose();
  };

  return (
    <Dialog label="Quick capture" title="Quick capture" description="Alt+C from anywhere in NeuroReflect." onClose={onClose} width="w-[480px]">
      <Segmented<Kind>
        label="What to capture"
        value={kind}
        onChange={setKind}
        options={[
          { id: 'task', label: 'Task' },
          { id: 'note', label: 'Note' },
          { id: 'worry', label: 'Worry' },
        ]}
      />
      <div className="mt-3">
        {kind === 'task' ? (
          <QuickAddInput
            autoFocus
            label="New task"
            placeholder="Ring Mum on Friday"
            onSubmit={async ({ title, when }) => {
              if (!title.trim()) return;
              await addTask({ title, dueDay: when?.day ?? null, dueTime: when?.time ?? null, repeat: when?.repeat ?? null });
              toast({ title: 'Added to your to-do list', body: `${title}${when?.day ? `, ${describeWhen(when.day, when.time)}` : ''}` });
              onClose();
            }}
          />
        ) : (
          <>
            <textarea
              autoFocus
              aria-label={kind === 'worry' ? 'Worry to park' : 'Note'}
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void saveNote();
                }
              }}
              placeholder={kind === 'worry' ? 'What is the worry? It can wait for its slot.' : 'Anything you want to come back to'}
              className="w-full resize-none rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 font-serif text-[15px] text-paper-50 placeholder:text-paper-500 focus:border-ember-400 focus:outline-none"
            />
            {kind === 'worry' && !worryOn && (
              <p className="mt-1.5 text-[12px] leading-5 text-paper-500">Your worry period is off, so parked worries wait in the planner. Turn it on in Settings to give them a set time.</p>
            )}
            <div className="mt-3 flex justify-end">
              <button type="button" onClick={() => void saveNote()} disabled={!text.trim()} className="rounded-lg bg-ember-400 px-3.5 py-1.5 text-[13px] font-medium text-ink-950 hover:bg-ember-300 disabled:opacity-40">
                {kind === 'worry' ? 'Park it' : 'Save note'}
              </button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
