'use client';

import { memo, useState } from 'react';
import { CalendarClock, Check, ListTodo, X } from 'lucide-react';
import { describeRepeat, describeWhen } from '@/lib/nl-date';
import type { TaskSuggestion } from '@/lib/one-tap';

export interface AddedNote {
  key: string;
  label: string;
  taskId: string;
}

interface Props {
  suggestion: TaskSuggestion;
  added: AddedNote | null;
  onAdd: (s: TaskSuggestion, keepDate: boolean) => void;
  onDismiss: (s: TaskSuggestion) => void;
  onUndo: (note: AddedNote) => void;
  onOpen: (note: AddedNote) => void;
}

// "Add to your to-do list?" under a finished line that reads like a task. The
// date it found is shown as a chip; tapping the chip drops the date and adds
// the task with no day, keeping the words.
const OneTapChip = memo(function OneTapChip({ suggestion, added, onAdd, onDismiss, onUndo, onOpen }: Props) {
  const [keepDate, setKeepDate] = useState(true);
  if (added) {
    return (
      <div className="nr-rise mt-1.5 inline-flex items-center gap-2 rounded-full border border-sage-400/40 bg-sage-400/10 py-0.5 pl-2.5 pr-1 text-[12px] text-paper-100" data-testid="one-tap-added">
        <Check size={12} className="text-sage-300" /> {added.label}
        <button type="button" onClick={() => onOpen(added)} className="rounded-full px-1.5 py-0.5 text-paper-300 hover:bg-ink-800 hover:text-paper-50">
          Open
        </button>
        <button type="button" onClick={() => onUndo(added)} className="rounded-full px-1.5 py-0.5 text-paper-300 hover:bg-ink-800 hover:text-paper-50">
          Undo
        </button>
      </div>
    );
  }
  const when = suggestion.when;
  const hasDate = !!(when && (when.day || when.repeat));
  return (
    <div className="nr-rise mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px]" data-testid="one-tap">
      <span className="inline-flex items-center gap-1 text-paper-500">
        <ListTodo size={12} className="text-ember-400" /> Add to your to-do list?
      </span>
      <span className="rounded-md bg-ink-900 px-2 py-0.5 text-paper-100">{suggestion.title}</span>
      {hasDate && when && (
        <button
          type="button"
          onClick={() => setKeepDate((v) => !v)}
          aria-pressed={!keepDate}
          title={keepDate ? 'Tap to add it without this date' : 'Tap to use the date again'}
          className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 ${keepDate ? 'border-dusk-400/50 bg-dusk-400/10 text-paper-100' : 'border-ink-700 text-paper-500 line-through'}`}
          data-testid="one-tap-date"
        >
          <CalendarClock size={11} className="text-dusk-300" />
          {when.repeat ? describeRepeat(when.repeat.rule, when.repeat.fromCompletion) : describeWhen(when.day, when.time)}
        </button>
      )}
      <button type="button" onClick={() => onAdd(suggestion, keepDate && hasDate)} className="rounded-md bg-ember-400 px-2 py-0.5 font-medium text-ink-950 hover:bg-ember-300">
        Add
      </button>
      <button type="button" aria-label="Not a task" title="Not a task" onClick={() => onDismiss(suggestion)} className="rounded p-0.5 text-paper-500 hover:text-paper-100">
        <X size={12} />
      </button>
    </div>
  );
});

export default OneTapChip;
