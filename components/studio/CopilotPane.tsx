'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronsLeft, ChevronsRight, CircleStop, Compass, Layers, Loader, MessageCircleQuestion, Palette, ScrollText, X } from 'lucide-react';
import { COARSE_TO_FAMILIES } from '@/lib/lexicons';
import { LENSES, PERSPECTIVE_NOTE } from '@/lib/prompts';
import type { CopilotTurn, CoreValue, Entry, GraphNode, LensId, Mention, ProviderId, Synthesis, Telemetry, ValueAlignment } from '@/lib/types';
import EmotionWheel from './EmotionWheel';

export type CopilotTab = 'inquiry' | 'lenses' | 'synthesis' | 'name';

export interface StreamState {
  active: boolean;
  text: string;
  mode: CopilotTurn['mode'] | null;
  lens: LensId | null;
}

export interface FinishProgress {
  running: boolean;
  steps: { label: string; done: boolean }[];
}

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  tab: CopilotTab;
  setTab: (t: CopilotTab) => void;
  entry: Entry | null;
  turns: CopilotTurn[];
  stream: StreamState;
  ruminationActive: boolean;
  suggestDeeper: boolean;
  telemetry: Telemetry;
  synthesis: Synthesis | undefined;
  values: CoreValue[];
  alignments: ValueAlignment[];
  mentions: (Mention & { node?: GraphNode })[];
  finish: FinishProgress;
  onGoDeeper: () => void;
  onStepBack: () => void;
  onConcrete: () => void;
  onLens: (lens: LensId) => void;
  onCancel: () => void;
  onFinish: () => void;
  onReplaceCoarse: (word: string, term: string) => void;
  onInsertTerm: (term: string) => void;
  onConfirmMention: (id: string) => void;
  onRemoveMention: (id: string) => void;
  /** Narrow screens: the pane slides over the entry instead of sitting beside it. */
  overlay?: boolean;
}

const TABS: { id: CopilotTab; label: string; icon: typeof Compass }[] = [
  { id: 'inquiry', label: 'Inquiry', icon: MessageCircleQuestion },
  { id: 'lenses', label: 'Lenses', icon: Layers },
  { id: 'synthesis', label: 'Synthesis', icon: ScrollText },
  { id: 'name', label: 'Name it', icon: Palette },
];

function providerName(provider: ProviderId, model: string): string {
  if (provider === 'heuristic') return 'the built-in engine';
  const name = provider === 'ollama' ? 'Ollama' : provider === 'anthropic' ? 'Anthropic' : 'OpenAI';
  return `${name} (${model})`;
}

function providerNote(t: CopilotTurn): string {
  if (t.fallbackUsed) return 'Your AI provider did not respond, so the built-in engine answered';
  return `From ${providerName(t.provider, t.model)}`;
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export default function CopilotPane(props: Props) {
  const { collapsed, onToggle, tab, setTab, overlay } = props;

  if (collapsed && overlay) return null;
  if (collapsed) {
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center gap-1 border-l border-ink-800 bg-ink-950 py-3" aria-label="Co-pilot (collapsed)">
        <button type="button" onClick={onToggle} title="Open co-pilot" className="mb-2 rounded p-2 text-paper-500 hover:bg-ink-900 hover:text-paper-100">
          <ChevronsLeft size={16} />
        </button>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            title={label}
            onClick={() => {
              setTab(id);
              onToggle();
            }}
            className="rounded p-2 text-paper-500 hover:bg-ink-900 hover:text-paper-100"
          >
            <Icon size={16} />
          </button>
        ))}
      </aside>
    );
  }

  return (
    <>
    {overlay && <button type="button" aria-label="Close co-pilot" className="fixed inset-0 z-30 bg-black/50" onClick={onToggle} />}
    <aside className={`flex flex-col border-l border-ink-800 bg-ink-950 ${overlay ? 'fixed inset-y-0 right-0 z-40 w-[min(384px,92vw)] shadow-[0_0_60px_rgba(0,0,0,0.6)]' : 'w-[384px] shrink-0'}`} aria-label="Co-pilot">
      <div className="flex items-center gap-1 border-b border-ink-800 px-2 py-2">
        <div role="tablist" aria-label="Co-pilot modes" className="flex flex-1 gap-0.5">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] transition-colors ${
                tab === id ? 'bg-ink-850 text-paper-50 shadow-[inset_0_-2px_0_#e0aa4a]' : 'text-paper-500 hover:text-paper-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={onToggle} title="Collapse co-pilot" className="rounded p-1.5 text-paper-500 hover:bg-ink-900 hover:text-paper-100">
          <ChevronsRight size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {tab === 'inquiry' && <InquiryTab {...props} />}
        {tab === 'lenses' && <LensesTab {...props} />}
        {tab === 'synthesis' && <SynthesisTab {...props} />}
        {tab === 'name' && <NameTab {...props} />}
      </div>
    </aside>
    </>
  );
}

function StreamCard({ stream, onCancel }: { stream: StreamState; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [minH, setMinH] = useState(88);
  useEffect(() => {
    if (!stream.active && ref.current) setMinH(Math.max(88, ref.current.offsetHeight));
  }, [stream.active]);
  if (!stream.active) return null;
  return (
    <div ref={ref} className="rounded-xl border border-ember-500/40 bg-ink-900 p-4" style={{ minHeight: minH }} aria-live="polite">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12px] text-paper-500">{stream.mode === 'distancing' ? 'Stepping back' : stream.mode === 'concrete' ? 'Asking how' : stream.mode === 'lens' ? 'Applying lens' : 'Thinking of a question'}</span>
        <button type="button" onClick={onCancel} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-paper-500 hover:bg-ink-800 hover:text-paper-100">
          <CircleStop size={12} /> Stop
        </button>
      </div>
      <p className={`whitespace-pre-wrap font-serif text-[0.98rem] leading-7 text-paper-100 ${stream.text ? 'nr-caret' : ''}`}>
        {stream.text || <Loader size={14} className="animate-spin text-paper-500" />}
      </p>
    </div>
  );
}

function InquiryTab({ turns, stream, ruminationActive, suggestDeeper, onGoDeeper, onStepBack, onConcrete, onCancel, entry, telemetry }: Props) {
  const asked = turns.filter((t) => t.mode === 'socratic' || t.mode === 'distancing' || t.mode === 'concrete');
  const tooShort = telemetry.wordCount < 8;
  return (
    <div className="flex flex-col gap-4">
      {ruminationActive ? (
        <div className="rounded-xl border border-rose-400/40 bg-rose-400/10 p-4">
          <p className="text-[13.5px] font-medium text-rose-300">This may be going in circles</p>
          <p className="mt-1 text-[13px] leading-5 text-paper-300">
            Lots of &ldquo;I&rdquo;, strong negative feeling and little cause-and-effect language. Digging deeper tends to feed that loop, so questions now help you step back, or ask how rather than why.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onStepBack}
              disabled={stream.active}
              className="rounded-lg bg-rose-400 px-3 py-1.5 text-[13px] font-medium text-ink-950 hover:bg-rose-300 disabled:opacity-50"
            >
              Step back
            </button>
            <button type="button" onClick={onConcrete} disabled={stream.active} className="rounded-lg border border-rose-400/50 px-3 py-1.5 text-[13px] text-paper-100 hover:bg-rose-400/10 disabled:opacity-50">
              How exactly
            </button>
          </div>
          <p className="mt-2 text-[11.5px] text-paper-500">
            <kbd className="text-paper-300">Ctrl Enter</kbd> takes turns between the two.
          </p>
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={onGoDeeper}
            disabled={stream.active || tooShort}
            className={`w-full rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              suggestDeeper ? 'border-ember-400 bg-ember-400/10' : 'border-ink-700 hover:border-ink-600 hover:bg-ink-900'
            }`}
          >
            <span className="flex items-center justify-between">
              <span className="text-[14px] font-medium text-paper-50">Go deeper</span>
              <kbd className="text-[11px] text-paper-500">Ctrl Enter</kbd>
            </span>
            <span className="mt-0.5 block text-[12.5px] leading-5 text-paper-500">
              {tooShort ? 'Write a few lines first.' : suggestDeeper ? 'You have paused. Ask for one question when you are ready.' : 'One question, based on what you have written.'}
            </span>
          </button>
        </div>
      )}

      <StreamCard stream={stream} onCancel={onCancel} />

      {asked.length === 0 && !stream.active && (
        <p className="text-[13px] leading-5 text-paper-500">
          {entry?.status === 'complete'
            ? 'No questions were asked in this entry.'
            : 'Questions appear here and inline in your entry, with a fresh paragraph underneath for your answer. Nothing is sent anywhere until you ask.'}
        </p>
      )}

      <ol className="flex flex-col gap-3">
        {asked
          .slice()
          .reverse()
          .map((t) => (
            <li key={t.id} className="rounded-xl bg-ink-900 p-4">
              <p className="text-[12px] text-paper-500">
                {t.mode === 'distancing' ? 'A step back' : t.mode === 'concrete' ? 'How, not why' : 'A question'}, {timeOf(t.createdAt)}
                {t.incomplete ? ', stopped early' : ''}
              </p>
              <p className="mt-1 font-serif text-[0.98rem] leading-7 text-paper-100">{t.text}</p>
              <p className="mt-2 text-[11.5px] text-paper-500">{providerNote(t)}</p>
            </li>
          ))}
      </ol>
    </div>
  );
}

function LensesTab({ turns, stream, onLens, onCancel, telemetry }: Props) {
  const lensTurns = turns.filter((t) => t.mode === 'lens');
  const tooShort = telemetry.wordCount < 15;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] leading-5 text-paper-300">Look at this entry another way. Each lens reads what you have written so far. Perspectives are ways of looking at things, not tested techniques.</p>
      <div className="grid gap-2">
        {LENSES.map((l) => (
          <button
            key={l.id}
            type="button"
            disabled={stream.active || tooShort}
            onClick={() => onLens(l.id)}
            className="rounded-xl border border-ink-700 px-4 py-3 text-left hover:border-ink-600 hover:bg-ink-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="flex items-center gap-2 text-[14px] font-medium text-paper-50">
              {l.label}
              {l.perspective && (
                <span title={PERSPECTIVE_NOTE} className="rounded-full border border-ink-700 px-1.5 py-px text-[10.5px] font-normal text-paper-500">
                  Perspective
                </span>
              )}
            </span>
            <span className="block text-[12.5px] text-paper-500">{l.blurb}</span>
          </button>
        ))}
      </div>
      <p className="text-[12px] text-paper-500">
        {tooShort ? 'Write a little more first. ' : ''}
        <kbd className="text-paper-300">Ctrl K</kbd> opens the lens picker from the editor.
      </p>
      <StreamCard stream={stream} onCancel={onCancel} />
      <ol className="flex flex-col gap-3">
        {lensTurns
          .slice()
          .reverse()
          .map((t) => (
            <li key={t.id} className="rounded-xl bg-ink-900 p-4">
              <p className="text-[12px] text-paper-500">
                {LENSES.find((l) => l.id === t.lens)?.label ?? 'Lens'}, {timeOf(t.createdAt)}
              </p>
              <div className="mt-2 space-y-1.5">
                {t.text.split('\n').filter(Boolean).map((line, i) => {
                  const m = line.match(/^([^:]{2,40}):\s*(.*)$/);
                  return m ? (
                    <p key={i} className="text-[13.5px] leading-6 text-paper-100">
                      <span className="text-paper-300">{m[1]}:</span> {m[2]}
                    </p>
                  ) : (
                    <p key={i} className="text-[13.5px] leading-6 text-paper-100">
                      {line}
                    </p>
                  );
                })}
              </div>
              <p className="mt-2 text-[11.5px] text-paper-500">{providerNote(t)}</p>
            </li>
          ))}
      </ol>
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  // Diverging -2..+2 with a neutral centre; warm = drift, cool = aligned.
  const pct = (Math.abs(score) / 2) * 50;
  const color = score > 0 ? '#6f93d9' : score < 0 ? '#bf8a30' : '#4d453c';
  return (
    <div className="relative h-2 w-24 rounded-full bg-ink-800" aria-hidden>
      <div className="absolute left-1/2 top-[-2px] h-3 w-px bg-ink-600" />
      {score !== 0 && (
        <div
          className="absolute top-0 h-2"
          style={{ background: color, width: `${pct}%`, left: score > 0 ? '50%' : `${50 - pct}%`, borderRadius: score > 0 ? '0 4px 4px 0' : '4px 0 0 4px' }}
        />
      )}
    </div>
  );
}

function SynthesisTab({ entry, synthesis, finish, onFinish, values, alignments, mentions, onConfirmMention, onRemoveMention }: Props) {
  if (finish.running) {
    return (
      <div aria-live="polite">
        <p className="text-[14px] font-medium text-paper-50">Finishing this entry</p>
        <ol className="mt-3 space-y-2">
          {finish.steps.map((s) => (
            <li key={s.label} className="flex items-center gap-2 text-[13px] text-paper-300">
              {s.done ? <Check size={14} className="text-sage-400" /> : <Loader size={14} className="animate-spin text-paper-500" />}
              {s.label}
            </li>
          ))}
        </ol>
      </div>
    );
  }
  if (!entry || (!synthesis && entry.status !== 'complete')) {
    return (
      <div>
        <p className="text-[14px] font-medium text-paper-50">When you are done writing</p>
        <p className="mt-1 text-[13px] leading-5 text-paper-300">
          Finishing saves the entry, measures it, links the people, themes and values in it to your memory graph, and distils it into one takeaway, one hidden assumption and one small plan.
        </p>
        <button type="button" onClick={onFinish} disabled={!entry || entry.wordCount === 0} className="mt-4 rounded-lg bg-ember-400 px-3.5 py-2 text-[13px] font-medium text-ink-950 hover:bg-ember-300 disabled:opacity-40">
          Finish entry <kbd className="ml-1 text-[11px] opacity-70">Ctrl Shift Enter</kbd>
        </button>
      </div>
    );
  }
  const byKind = (k: string) => mentions.filter((m) => m.node?.kind === k);
  return (
    <div className="flex flex-col gap-6">
      {synthesis ? (
        <section className="space-y-4">
          <div>
            <h3 className="text-[12px] text-paper-500">Key takeaway</h3>
            <p className="mt-1 font-serif text-[1.02rem] leading-7 text-paper-50">{synthesis.keyTakeaway}</p>
          </div>
          <div>
            <h3 className="text-[12px] text-paper-500">Hidden assumption</h3>
            <p className="mt-1 font-serif text-[1.02rem] leading-7 text-paper-100">{synthesis.hiddenAssumption}</p>
          </div>
          <div className="rounded-xl border border-ember-500/40 bg-ember-500/10 p-3.5">
            <h3 className="text-[12px] text-ember-300">One small plan</h3>
            <p className="mt-1 text-[14px] leading-6 text-paper-50">{synthesis.microAction}</p>
          </div>
          <p className="text-[11.5px] text-paper-500">
            Distilled by {providerName(synthesis.provider, synthesis.model)}.{' '}
            <button type="button" onClick={onFinish} className="underline decoration-ink-600 underline-offset-2 hover:text-paper-100">
              Re-run
            </button>
          </p>
        </section>
      ) : (
        <button type="button" onClick={onFinish} className="self-start rounded-lg bg-ember-400 px-3.5 py-2 text-[13px] font-medium text-ink-950 hover:bg-ember-300">
          Distil this entry
        </button>
      )}

      {values.length > 0 && alignments.length > 0 && (
        <section>
          <h3 className="text-[12px] text-paper-500">Values in this entry</h3>
          <ul className="mt-2 space-y-2.5">
            {values.map((v) => {
              const a = alignments.find((x) => x.valueId === v.id);
              if (!a) return null;
              return (
                <li key={v.id}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[13.5px] text-paper-100">{v.label}</span>
                    <span className="flex items-center gap-2">
                      <span className="nr-num w-7 text-right text-[12px] text-paper-300">{a.score > 0 ? `+${a.score}` : a.score}</span>
                      <ScoreBar score={a.score} />
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12px] leading-5 text-paper-500">{a.evidence}</p>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[11.5px] text-paper-500">From +2 (acted on it) to -2 (drifted from it). Scored by {alignments[0]?.source === 'llm' ? 'your AI provider' : 'the built-in engine'}.</p>
        </section>
      )}

      {mentions.length > 0 && (
        <section>
          <h3 className="text-[12px] text-paper-500">Remembered from this entry</h3>
          <p className="mt-0.5 text-[12px] leading-5 text-paper-500">Tagged items are kept. Suggestions stay provisional until you confirm them; remove anything that is wrong.</p>
          {(['person', 'theme', 'value', 'distortion', 'pattern'] as const).map((k) => {
            const list = byKind(k);
            if (!list.length) return null;
            const name = { person: 'People', theme: 'Themes', value: 'Values', distortion: 'Thinking patterns', pattern: 'Loops' }[k];
            return (
              <div key={k} className="mt-3">
                <p className="text-[12px] text-paper-300">{name}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {list.map((m) => (
                    <span
                      key={m.id}
                      className={`inline-flex items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-[12.5px] ${
                        m.confirmed ? 'border-ink-600 text-paper-100' : 'border-dashed border-ink-600 text-paper-300'
                      }`}
                      title={m.source === 'explicit_tag' ? 'You tagged this' : m.source === 'llm' ? 'Suggested by your AI provider' : 'Suggested by the built-in engine'}
                    >
                      {m.node?.label}
                      {!m.confirmed && (
                        <button type="button" aria-label={`Confirm ${m.node?.label}`} onClick={() => onConfirmMention(m.id)} className="rounded-full p-0.5 text-paper-500 hover:bg-ink-800 hover:text-sage-300">
                          <Check size={12} />
                        </button>
                      )}
                      <button type="button" aria-label={`Remove ${m.node?.label}`} onClick={() => onRemoveMention(m.id)} className="rounded-full p-0.5 text-paper-500 hover:bg-ink-800 hover:text-rose-300">
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

function NameTab({ telemetry, onReplaceCoarse, onInsertTerm }: Props) {
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const coarse = telemetry.coarseLabels;
  useEffect(() => {
    if (selectedWord && !coarse.includes(selectedWord)) setSelectedWord(null);
  }, [coarse, selectedWord]);
  const highlight = selectedWord ? COARSE_TO_FAMILIES[selectedWord] ?? [] : [];
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-[12px] text-paper-500">Granularity in this entry</p>
          <p className="text-[22px] font-medium text-paper-50">{telemetry.granularityIndex.toFixed(1)}</p>
        </div>
        <p className="max-w-[190px] text-right text-[12px] leading-5 text-paper-500">Distinct, precise emotion words per 1,000 words. Precise naming is linked to better regulation.</p>
      </div>

      <section>
        <p className="text-[13px] text-paper-100">Broad words you used</p>
        {coarse.length === 0 ? (
          <p className="mt-1 text-[12.5px] text-paper-500">None so far. Words like &ldquo;stressed&rdquo;, &ldquo;fine&rdquo; or &ldquo;bad&rdquo; get a dashed underline when you use them about yourself.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {coarse.map((w) => (
              <button
                key={w}
                type="button"
                aria-pressed={selectedWord === w}
                onClick={() => setSelectedWord(selectedWord === w ? null : w)}
                className={`rounded-full border px-2.5 py-1 text-[12.5px] ${selectedWord === w ? 'border-dusk-400 bg-dusk-400/15 text-paper-50' : 'border-dashed border-dusk-400/70 text-paper-100 hover:bg-ink-800'}`}
              >
                {w}
              </button>
            ))}
          </div>
        )}
        <p className="mt-2 text-[12px] text-paper-500">
          {selectedWord ? `Pick a term below to replace "${selectedWord}" in your entry.` : 'Select a broad word to replace it, or pick any term to insert it where your cursor is.'}
        </p>
      </section>

      <EmotionWheel key={selectedWord ?? 'none'} highlight={highlight} onPick={(t) => (selectedWord ? (onReplaceCoarse(selectedWord, t), setSelectedWord(null)) : onInsertTerm(t))} />

      {telemetry.fineLabels.length > 0 && (
        <section>
          <p className="text-[13px] text-paper-100">Precise words already here</p>
          <p className="mt-1 text-[12.5px] leading-5 text-paper-300">{telemetry.fineLabels.join(', ')}</p>
        </section>
      )}
    </div>
  );
}
