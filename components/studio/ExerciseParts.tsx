'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Hourglass, ListTodo, Pause, Play } from 'lucide-react';
import { FEELINGS } from '@/lib/feelings';
import { ifThenSentence } from '@/lib/planner';
import type { CaptureNote, FeelingValue, LocalDay } from '@/lib/types';
import { addDays, formatDay, localDayOf } from '@/lib/util';

export function FeelingCheckRow({ question, onPick, onSkip }: { question: string; onPick: (v: FeelingValue) => void; onSkip?: () => void }) {
  return (
    <div data-testid="feeling-check">
      <p className="text-[13px] text-paper-100">{question}</p>
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={question}>
        {FEELINGS.map((f) => (
          <button key={f.value} type="button" onClick={() => onPick(f.value)} className="rounded-full border border-ink-700 px-3 py-1 text-[12.5px] text-paper-100 hover:border-ember-400 hover:bg-ink-800">
            {f.label}
          </button>
        ))}
        {onSkip && (
          <button type="button" onClick={onSkip} className="rounded-full px-2.5 py-1 text-[12.5px] text-paper-500 hover:text-paper-100">
            Skip
          </button>
        )}
      </div>
      <p className="mt-1.5 text-[11.5px] text-paper-500">Only for you, to see over time which exercises suit you. It is not a score of anything.</p>
    </div>
  );
}

/** In for four, out for six: a slow breath with a longer out-breath, for one minute. */
export function BreathingPacer({ seconds = 60, onDone }: { seconds?: number; onDone: () => void }) {
  const [left, setLeft] = useState(seconds);
  const [running, setRunning] = useState(true);
  const [phase, setPhase] = useState<'in' | 'out'>('in');
  const started = useRef(Date.now());
  const pausedAt = useRef<number | null>(null);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      const elapsed = (Date.now() - started.current) / 1000;
      const cycle = elapsed % 10;
      setPhase(cycle < 4 ? 'in' : 'out');
      const remaining = Math.max(0, Math.ceil(seconds - elapsed));
      setLeft(remaining);
      if (remaining === 0) {
        clearInterval(t);
        onDone();
      }
    }, 200);
    return () => clearInterval(t);
  }, [running, seconds, onDone]);
  return (
    <div className="flex items-center gap-4" data-testid="breathing-pacer">
      <div className="relative flex h-16 w-16 shrink-0 items-center justify-center" aria-hidden>
        <div className={`absolute rounded-full bg-dusk-400/25 transition-all ease-in-out ${phase === 'in' ? 'h-16 w-16 duration-[4000ms]' : 'h-7 w-7 duration-[6000ms]'}`} />
        <div className="relative h-2.5 w-2.5 rounded-full bg-dusk-300" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] text-paper-50" aria-live="polite">
          {phase === 'in' ? 'Breathe in, gently' : 'And slowly out'}
        </p>
        <p className="nr-num text-[12px] text-paper-500">{left} seconds left</p>
      </div>
      <button
        type="button"
        aria-label={running ? 'Pause' : 'Carry on'}
        onClick={() => {
          if (running) {
            pausedAt.current = Date.now();
            setRunning(false);
          } else {
            if (pausedAt.current) started.current += Date.now() - pausedAt.current;
            pausedAt.current = null;
            setRunning(true);
          }
        }}
        className="rounded-lg p-2 text-paper-300 hover:bg-ink-800"
      >
        {running ? <Pause size={15} /> : <Play size={15} />}
      </button>
      <button type="button" onClick={onDone} className="rounded-lg px-2.5 py-1.5 text-[12.5px] text-paper-300 hover:bg-ink-800">
        Skip
      </button>
    </div>
  );
}

/** "When I notice ..., I will ..." built from two short answers. */
export function PlanBuilder({ hint, onSave }: { hint?: string; onSave: (sentence: string, parts: { when: string; then: string; where: string }) => void }) {
  const [when, setWhen] = useState('');
  const [then, setThen] = useState('');
  const [where, setWhere] = useState('');
  const sentence = when.trim() && then.trim() ? ifThenSentence(then, { when: when.trim(), where: where.trim() }) : '';
  return (
    <div className="space-y-2" data-testid="plan-builder">
      {hint && <p className="text-[12px] text-paper-500">{hint}</p>}
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
        <input aria-label="When" value={when} onChange={(e) => setWhen(e.target.value)} placeholder="When I notice my chest tighten" className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-[13.5px] text-paper-50 placeholder:text-paper-500 focus:border-ember-400 focus:outline-none" />
        <input aria-label="I will" value={then} onChange={(e) => setThen(e.target.value)} placeholder="breathe out slowly, twice" className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-[13.5px] text-paper-50 placeholder:text-paper-500 focus:border-ember-400 focus:outline-none" />
      </div>
      <input aria-label="Where (optional)" value={where} onChange={(e) => setWhere(e.target.value)} placeholder="Where, if it helps (optional)" className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-[13.5px] text-paper-50 placeholder:text-paper-500 focus:border-ember-400 focus:outline-none" />
      {sentence && <p className="font-serif text-[15px] italic leading-6 text-paper-100">{sentence}</p>}
      <button
        type="button"
        disabled={!sentence}
        onClick={() => onSave(sentence, { when: when.trim(), then: then.trim(), where: where.trim() })}
        className="rounded-lg bg-ember-400 px-3 py-1.5 text-[12.5px] font-medium text-ink-950 hover:bg-ember-300 disabled:opacity-40"
      >
        Keep this plan
      </button>
    </div>
  );
}

export function WorryList({ worries, onPlan, onLetWait, onWrite }: { worries: CaptureNote[]; onPlan: (w: CaptureNote) => void; onLetWait: (w: CaptureNote) => void; onWrite: (w: CaptureNote) => void }) {
  if (!worries.length) return <p className="text-[12.5px] text-paper-500">No parked worries. Write about whatever is on your mind, then stop when the time is up.</p>;
  return (
    <ul className="space-y-2" data-testid="worry-list">
      {worries.map((w) => (
        <li key={w.id} className="rounded-lg border border-ink-800 px-3 py-2">
          <p className="flex items-start gap-2 text-[13px] text-paper-100">
            <Hourglass size={13} className="mt-1 shrink-0 text-dusk-300" aria-hidden />
            {w.text}
          </p>
          <div className="ml-5 mt-1.5 flex flex-wrap gap-1 text-[12px]">
            <button type="button" onClick={() => onPlan(w)} className="inline-flex items-center gap-1 rounded-md border border-ink-700 px-2 py-0.5 text-paper-100 hover:bg-ink-800">
              <ListTodo size={12} /> I can do something: add a task
            </button>
            <button type="button" onClick={() => onWrite(w)} className="rounded-md border border-ink-700 px-2 py-0.5 text-paper-100 hover:bg-ink-800">
              Write about it
            </button>
            <button type="button" onClick={() => onLetWait(w)} className="rounded-md border border-ink-700 px-2 py-0.5 text-paper-300 hover:bg-ink-800">
              Let it rest
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Kindness day: pick a day, plan three small kind acts, each becomes a task. */
export function KindnessPlanner({ onSave }: { onSave: (day: LocalDay, acts: string[]) => void }) {
  const today = localDayOf();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const [day, setDay] = useState(addDays(today, 1));
  const [acts, setActs] = useState(['', '', '']);
  return (
    <div className="space-y-2" data-testid="kindness-planner">
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Kindness day">
        {days.map((d) => (
          <button key={d} type="button" role="radio" aria-checked={day === d} onClick={() => setDay(d)} className={`rounded-md border px-2 py-0.5 text-[12px] ${day === d ? 'border-ember-400 bg-ember-400/15 text-paper-50' : 'border-ink-700 text-paper-300'}`}>
            {d === today ? 'Today' : formatDay(d, { weekday: 'short', day: 'numeric' })}
          </button>
        ))}
      </div>
      {acts.map((a, i) => (
        <input
          key={i}
          aria-label={`Kind act ${i + 1}`}
          value={a}
          onChange={(e) => setActs(acts.map((x, j) => (j === i ? e.target.value : x)))}
          placeholder={['Make a coffee for a colleague', 'Message a friend you miss', 'Let someone go ahead of you'][i]}
          className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-[13.5px] text-paper-50 placeholder:text-paper-500 focus:border-ember-400 focus:outline-none"
        />
      ))}
      <button
        type="button"
        disabled={!acts.some((a) => a.trim())}
        onClick={() => onSave(day, acts.map((a) => a.trim()).filter(Boolean))}
        className="inline-flex items-center gap-1.5 rounded-lg bg-ember-400 px-3 py-1.5 text-[12.5px] font-medium text-ink-950 hover:bg-ember-300 disabled:opacity-40"
      >
        <Check size={13} /> Add to my planner
      </button>
    </div>
  );
}

/** A gentle countdown for timed writing. It never stops the writing. */
export function WritingTimer({ minutes }: { minutes: number }) {
  const [start] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, minutes * 60 - Math.floor((now - start) / 1000));
  return (
    <span className="nr-num text-[12px] text-paper-500" role="timer">
      {left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left` : "Time's up. Finish the thought, then stop."}
    </span>
  );
}
