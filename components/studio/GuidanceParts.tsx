'use client';

import { useState } from 'react';
import { CalendarDays, Check, LifeBuoy, RefreshCw, Sparkles, X } from 'lucide-react';
import { describeWhen, formatTime, parseWhen, stripWhen } from '@/lib/nl-date';
import type { AgendaItem } from '@/lib/planner';
import { addTask } from '@/lib/planner';
import { EVIDENCE, getTechnique, LEVELS } from '@/lib/techniques';
import type { EntryPrompt, GuidanceLevel, TechniqueId } from '@/lib/types';
import type { TechniqueOffer } from '@/lib/guidance';
import { HelpContacts } from '../HelpPanel';
import { toast } from '@/lib/toasts';
import { addDays, localDayOf } from '@/lib/util';
import { FeelingCheckRow } from './ExerciseParts';

/** How much the journal says: four steps, the safety rails outside all of them. */
export function GuidanceSlider({ level, onChange }: { level: GuidanceLevel; onChange: (l: GuidanceLevel) => void }) {
  const index = LEVELS.findIndex((l) => l.id === level);
  return (
    <div className="flex items-center gap-3" data-testid="guidance-slider">
      <span className="hidden text-[11.5px] text-paper-500 sm:inline">Guidance</span>
      <div role="radiogroup" aria-label="How much the journal says" className="relative flex rounded-full border border-ink-700 p-0.5">
        <span
          aria-hidden
          className="absolute top-0.5 h-[calc(100%-4px)] rounded-full bg-ink-800 shadow-[inset_0_-2px_0_#e0aa4a] transition-all duration-200"
          style={{ width: `calc((100% - 4px) / 4)`, left: `calc(2px + ${index} * (100% - 4px) / 4)` }}
        />
        {LEVELS.map((l) => (
          <button
            key={l.id}
            type="button"
            role="radio"
            aria-checked={level === l.id}
            title={l.blurb}
            onClick={() => onChange(l.id)}
            className={`relative z-[1] w-[78px] whitespace-nowrap rounded-full py-1 text-center text-[12px] transition-colors sm:w-[86px] ${level === l.id ? 'text-paper-50' : 'text-paper-500 hover:text-paper-100'}`}
          >
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ComingUpStrip({ items, onOpen }: { items: AgendaItem[]; onOpen: () => void }) {
  if (!items.length) return null;
  const today = localDayOf();
  return (
    <button type="button" onClick={onOpen} className="mb-4 flex w-full items-center gap-2 overflow-hidden rounded-lg border border-ink-800 px-3 py-1.5 text-left text-[12px] text-paper-300 hover:bg-ink-900" data-testid="coming-up-strip">
      <CalendarDays size={13} className="shrink-0 text-ember-400" />
      <span className="shrink-0 text-paper-500">Coming up</span>
      <span className="truncate">
        {items
          .map((i) => `${i.title} ${describeWhen(i.day, null, today).toLowerCase()}${i.time ? ` ${formatTime(i.time)}` : ''}`)
          .join('  ·  ')}
      </span>
    </button>
  );
}

export function OfferChip({ offer, onStart, onDismiss }: { offer: TechniqueOffer; onStart: (o: TechniqueOffer) => void; onDismiss: (id: TechniqueId) => void }) {
  const t = getTechnique(offer.technique);
  return (
    <div className="nr-rise mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-ember-500/50 px-3 py-2" data-testid="technique-offer">
      <Sparkles size={14} className="shrink-0 text-ember-400" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-paper-100">
          Try: <span className="font-medium">{t.name}</span>
          <span className="text-paper-500"> · about {t.minutes} min · </span>
          <span className="text-paper-500" title={`${EVIDENCE[t.evidence].note} (${t.source})`}>
            {EVIDENCE[t.evidence].label}
          </span>
        </p>
        <p className="text-[12px] leading-5 text-paper-500">{offer.reason}</p>
      </div>
      <button type="button" onClick={() => onStart(offer)} className="rounded-lg bg-ember-400 px-3 py-1 text-[12.5px] font-medium text-ink-950 hover:bg-ember-300">
        Start
      </button>
      <button type="button" aria-label="Not now" title="Not now" onClick={() => onDismiss(offer.technique)} className="rounded p-1 text-paper-500 hover:text-paper-100">
        <X size={14} />
      </button>
    </div>
  );
}

interface PromptCardProps {
  prompt: EntryPrompt | null;
  canCycle: boolean;
  onAnother: () => void;
  onHide: () => void;
  onSetup?: () => void;
  children?: React.ReactNode;
}

export function PromptCard({ prompt, canCycle, onAnother, onHide, onSetup, children }: PromptCardProps) {
  if (!prompt) return children ? <div className="mb-6">{children}</div> : null;
  return (
    <div className="mb-6" data-testid="prompt-card">
      <div className="group flex items-start gap-3">
        <div className="min-w-0 flex-1 border-l-2 border-ember-500/70 pl-4">
          <p className="font-serif text-[1.15rem] italic leading-7 text-paper-100" data-testid="prompt-text">
            {prompt.text}
          </p>
          <p className="mt-1 text-[12px] leading-5 text-paper-500">
            {prompt.reason}
            {onSetup && (
              <>
                {' '}
                <button type="button" onClick={onSetup} className="underline decoration-ink-600 underline-offset-2 hover:text-paper-100">
                  Set up goals
                </button>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
          {canCycle && (
            <button type="button" aria-label="Another prompt" title="Another prompt" onClick={onAnother} className="rounded p-1.5 text-paper-500 hover:bg-ink-900 hover:text-paper-100">
              <RefreshCw size={14} />
            </button>
          )}
          <button type="button" aria-label="Hide the prompt" title="Hide the prompt" onClick={onHide} className="rounded p-1.5 text-paper-500 hover:bg-ink-900 hover:text-paper-100">
            <X size={14} />
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

export function NextTimeCheck({ techniqueName, onPick, onSkip }: { techniqueName: string; onPick: (v: 1 | 2 | 3 | 4 | 5) => void; onSkip: () => void }) {
  return (
    <div className="mt-3 rounded-xl border border-ink-800 px-3 py-2.5">
      <FeelingCheckRow question={`Last time you tried ${techniqueName.toLowerCase()}. How are you feeling today?`} onPick={onPick} onSkip={onSkip} />
    </div>
  );
}

/** Tomorrow's list before bed: each line becomes a task for tomorrow (Scullin et al. 2018). */
export function TomorrowList() {
  const [lines, setLines] = useState(['', '', '']);
  const [saved, setSaved] = useState(0);
  const tomorrow = addDays(localDayOf(), 1);
  if (saved) {
    return (
      <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-sage-300">
        <Check size={14} /> {saved} on tomorrow&apos;s list. They&apos;re in your planner, so they can wait until morning.
      </p>
    );
  }
  return (
    <div className="mt-3 space-y-1.5" data-testid="tomorrow-list">
      {lines.map((l, i) => (
        <input
          key={i}
          aria-label={`Tomorrow, item ${i + 1}`}
          value={l}
          onChange={(e) => {
            const next = lines.map((x, j) => (j === i ? e.target.value : x));
            if (i === lines.length - 1 && e.target.value && lines.length < 7) next.push('');
            setLines(next);
          }}
          placeholder={i === 0 ? 'Email the landlord about the boiler' : ''}
          className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-[13.5px] text-paper-50 placeholder:text-paper-500 focus:border-ember-400 focus:outline-none"
        />
      ))}
      <button
        type="button"
        disabled={!lines.some((l) => l.trim())}
        onClick={async () => {
          const items = lines.map((l) => l.trim()).filter(Boolean);
          for (const item of items) {
            const when = parseWhen(item, new Date());
            await addTask({ title: when ? stripWhen(item, when) : item, dueDay: tomorrow, dueTime: when?.time ?? null, tag: 'tomorrow_list' });
          }
          setSaved(items.length);
          toast({ title: "Tomorrow's list is in your planner" });
        }}
        className="rounded-lg bg-ember-400 px-3 py-1.5 text-[12.5px] font-medium text-ink-950 hover:bg-ember-300 disabled:opacity-40"
      >
        Put them on tomorrow&apos;s list
      </button>
    </div>
  );
}

/** Explicit crisis language gets help contacts, at every level, with no AI involved. Nothing is stored. */
export function CrisisCard({ onHide, onMore }: { onHide: () => void; onMore: () => void }) {
  return (
    <section role="region" aria-label="Help is here" className="nr-rise mb-6 rounded-2xl border border-rose-400/40 bg-rose-400/[0.07] p-4" data-testid="crisis-card">
      <p className="flex items-center gap-2 text-[14px] font-medium text-paper-50">
        <LifeBuoy size={16} className="text-rose-300" /> It sounds like things are really hard right now
      </p>
      <p className="mt-1 text-[13px] leading-5 text-paper-300">You don&apos;t have to deal with this on your own. Talking to someone can help, any time of day.</p>
      <div className="mt-3">
        <HelpContacts compact />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onMore} className="rounded-lg border border-ink-700 px-3 py-1.5 text-[12.5px] text-paper-100 hover:bg-ink-800">
          More places to get help
        </button>
        <button type="button" onClick={onHide} className="rounded-lg px-3 py-1.5 text-[12.5px] text-paper-500 hover:text-paper-100">
          Hide this
        </button>
      </div>
    </section>
  );
}
