'use client';

import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { CalendarClock, Repeat as RepeatIcon } from 'lucide-react';
import { describeRepeat, describeWhen, parseWhen, stripWhen, type ParsedWhen } from '@/lib/nl-date';
import { localDayOf } from '@/lib/util';

export interface QuickAddResult {
  title: string;
  when: ParsedWhen | null;
}

export interface QuickAddHandle {
  focus: () => void;
}

interface Props {
  placeholder: string;
  label: string;
  onSubmit: (r: QuickAddResult) => void | Promise<void>;
  autoFocus?: boolean;
  /** Extra classes for the outer box. */
  className?: string;
  defaultValue?: string;
}

// A one-line input that reads dates as you type, like "ring Mum Friday 6pm".
// The date words are highlighted in place and shown as a chip; tapping either
// keeps the words as part of the title instead.
const QuickAddInput = forwardRef<QuickAddHandle, Props>(function QuickAddInput({ placeholder, label, onSubmit, autoFocus, className = '', defaultValue = '' }, ref) {
  const [text, setText] = useState(defaultValue);
  const [ignored, setIgnored] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const backdrop = useRef<HTMLDivElement | null>(null);
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), []);

  const parsed = useMemo(() => {
    const p = text.trim() ? parseWhen(text, new Date()) : null;
    if (!p || p.text === ignored) return null;
    // Only highlight once there's something left to be the title.
    return stripWhen(text, p).length ? p : null;
  }, [text, ignored]);

  const submit = async () => {
    const value = text.trim();
    if (!value) return;
    const title = parsed ? stripWhen(text, parsed) : value;
    await onSubmit({ title, when: parsed });
    setText('');
    setIgnored(null);
  };

  const today = localDayOf();
  const segments = parsed
    ? [text.slice(0, parsed.start), text.slice(parsed.start, parsed.end), text.slice(parsed.end)]
    : [text, '', ''];

  return (
    <div className={className}>
      <div className="relative rounded-lg border border-ink-700 bg-ink-900 focus-within:border-ember-400">
        <div ref={backdrop} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre px-3 py-2 text-[14px] text-transparent">
          {segments[0]}
          {segments[1] && <span className="rounded bg-dusk-400/25 shadow-[0_1px_0_#6f93d9]">{segments[1]}</span>}
          {segments[2]}
        </div>
        <input
          ref={input}
          autoFocus={autoFocus}
          aria-label={label}
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            if (ignored && !e.target.value.includes(ignored)) setIgnored(null);
          }}
          onScroll={(e) => {
            if (backdrop.current) backdrop.current.scrollLeft = e.currentTarget.scrollLeft;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          className="relative w-full bg-transparent px-3 py-2 text-[14px] text-paper-50 placeholder:text-paper-500 focus:outline-none"
        />
      </div>
      {parsed && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px]">
          <button
            type="button"
            onClick={() => setIgnored(parsed.text)}
            title="Keep these words in the title instead"
            className="inline-flex items-center gap-1 rounded-full border border-dusk-400/50 bg-dusk-400/10 px-2 py-0.5 text-paper-100 hover:bg-dusk-400/20"
            data-testid="quick-add-when"
          >
            <CalendarClock size={12} className="text-dusk-300" />
            {describeWhen(parsed.day, parsed.time, today)}
            {parsed.repeat && (
              <>
                <RepeatIcon size={11} className="ml-0.5 text-dusk-300" />
                {describeRepeat(parsed.repeat.rule, parsed.repeat.fromCompletion)}
              </>
            )}
          </button>
          <span className="text-paper-500">Tap the date to keep it as words</span>
        </div>
      )}
    </div>
  );
});

export default QuickAddInput;
