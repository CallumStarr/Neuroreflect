'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronRight, CircleStop, Feather, LifeBuoy, Wind } from 'lucide-react';
import { recordFeeling } from '@/lib/feelings';
import { addTask } from '@/lib/planner';
import { EVIDENCE, getTechnique, lighterOptions } from '@/lib/techniques';
import type { CaptureNote, CoreValue, EntryExercise, FeelingCheck, TechniqueId } from '@/lib/types';
import { getDB } from '@/lib/db';
import { toast } from '@/lib/toasts';
import { BreathingPacer, FeelingCheckRow, KindnessPlanner, PlanBuilder, WorryList, WritingTimer } from './ExerciseParts';

export interface RunnerProps {
  entryId: string;
  exercise: EntryExercise;
  checks: FeelingCheck[];
  circling: boolean;
  values: CoreValue[];
  worries: CaptureNote[];
  feelingCheckOn: boolean;
  firstCoarse: string | null;
  hasStepPrompt: (step: number) => boolean;
  onInsertStepPrompt: (step: number, text: string) => Promise<void>;
  onInsertText: (text: string) => void;
  onUpdate: (patch: Partial<EntryExercise>) => Promise<void>;
  onOpenName: (word: string | null) => void;
  onStepBack: () => void;
  onConcrete: () => void;
  onSwitch: (technique: TechniqueId) => void;
  onHelp: () => void;
}

function fill(text: string, values: CoreValue[]): string {
  const names = values.map((v) => v.label.toLowerCase());
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0] ?? 'whichever matters most to you';
  return text.replace('{values}', list);
}

export default function ExerciseRunner(p: RunnerProps) {
  const t = getTechnique(p.exercise.technique);
  const [exiting, setExiting] = useState(false);
  const [breathing, setBreathing] = useState(false);
  const step = t.steps[Math.min(p.exercise.step, t.steps.length - 1)];
  const finished = !!p.exercise.finishedAt;
  const hasBefore = p.checks.some((c) => c.phase === 'before');
  const hasAfter = p.checks.some((c) => c.phase === 'after');
  const [skippedBefore, setSkippedBefore] = useState(false);
  const [skippedAfter, setSkippedAfter] = useState(false);
  const needBefore = p.feelingCheckOn && !hasBefore && !skippedBefore && p.exercise.step === 0 && !finished;
  const paused = t.guarded && p.circling && !finished;
  const inserting = useRef<number | null>(null);

  // A writing step puts its prompt into the entry, with room to answer below it.
  useEffect(() => {
    if (finished || needBefore || paused || step.kind !== 'write') return;
    if (p.hasStepPrompt(p.exercise.step) || inserting.current === p.exercise.step) return;
    inserting.current = p.exercise.step;
    void p.onInsertStepPrompt(p.exercise.step, fill(step.prompt, p.values));
  }, [finished, needBefore, paused, step, p]);

  // A naming step opens the feeling-word picker beside the entry.
  useEffect(() => {
    if (!finished && !needBefore && step.kind === 'name') p.onOpenName(p.firstCoarse);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, needBefore, step.kind]);

  const next = async () => {
    if (p.exercise.step + 1 < t.steps.length) await p.onUpdate({ step: p.exercise.step + 1 });
    else await p.onUpdate({ finishedAt: new Date().toISOString() });
  };

  if (finished) {
    if (p.feelingCheckOn && hasBefore && !hasAfter && !skippedAfter && !p.exercise.exitedAt) {
      return (
        <RunnerShell title={t.name} subtitle="All done">
          <FeelingCheckRow question="And how are you feeling now?" onPick={(value) => void recordFeeling({ entryId: p.entryId, technique: t.id, phase: 'after', value })} onSkip={() => setSkippedAfter(true)} />
        </RunnerShell>
      );
    }
    return null;
  }

  if (exiting) {
    return (
      <RunnerShell title="That's okay. Let's make it lighter." subtitle={t.name}>
        {breathing ? (
          <BreathingPacer
            onDone={() => {
              setBreathing(false);
              setExiting(false);
            }}
          />
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {lighterOptions(t.id).map((o) => {
              const label =
                o === 'breathe' ? 'Breathe slowly for a minute' : o === 'free' ? 'Write about something else' : o === 'stop' ? 'Stop for today' : `Switch to ${getTechnique(o).name.toLowerCase()}`;
              return (
                <button
                  key={o}
                  type="button"
                  onClick={async () => {
                    if (o === 'breathe') {
                      setBreathing(true);
                      return;
                    }
                    await p.onUpdate({ exitedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), switchedTo: o === 'free' || o === 'stop' ? null : o });
                    if (o !== 'free' && o !== 'stop') p.onSwitch(o);
                    if (o === 'stop') toast({ title: 'Stopped for today', body: 'What you wrote is saved. Come back whenever you like.' });
                  }}
                  className="rounded-lg border border-ink-700 px-3 py-1.5 text-[12.5px] text-paper-100 hover:border-ember-400 hover:bg-ink-800"
                >
                  {label}
                </button>
              );
            })}
            <button type="button" onClick={p.onHelp} className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12.5px] text-rose-300 hover:bg-rose-400/10">
              <LifeBuoy size={13} /> Need help now?
            </button>
            <button type="button" onClick={() => setExiting(false)} className="rounded-lg px-3 py-1.5 text-[12.5px] text-paper-500 hover:text-paper-100">
              Back to the exercise
            </button>
          </div>
        )}
      </RunnerShell>
    );
  }

  if (needBefore) {
    return (
      <RunnerShell title={t.name} subtitle={`${EVIDENCE[t.evidence].label} · about ${t.minutes} minute${t.minutes === 1 ? '' : 's'}`}>
        <FeelingCheckRow question="Before you start, how are you feeling?" onPick={(value) => void recordFeeling({ entryId: p.entryId, technique: t.id, phase: 'before', value })} onSkip={() => setSkippedBefore(true)} />
      </RunnerShell>
    );
  }

  if (paused) {
    return (
      <RunnerShell title={`${t.name} is paused`} subtitle="Your writing is circling">
        <p className="text-[12.5px] leading-5 text-paper-300">Going back over things in detail can feed a loop like this, so this exercise waits. Stepping back, or asking how rather than why, tends to help more.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" onClick={p.onStepBack} className="rounded-lg bg-rose-400 px-3 py-1.5 text-[12.5px] font-medium text-ink-950 hover:bg-rose-300">
            Step back
          </button>
          <button type="button" onClick={p.onConcrete} className="rounded-lg border border-ink-700 px-3 py-1.5 text-[12.5px] text-paper-100 hover:bg-ink-800">
            How exactly
          </button>
          <button type="button" onClick={() => void p.onUpdate({ exitedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), pausedAt: new Date().toISOString() })} className="rounded-lg px-3 py-1.5 text-[12.5px] text-paper-500 hover:text-paper-100">
            End the exercise
          </button>
        </div>
      </RunnerShell>
    );
  }

  const isLast = p.exercise.step + 1 >= t.steps.length;
  const sessionLabel = t.sessions ? ` · session ${p.exercise.session} of ${t.sessions}` : '';
  return (
    <RunnerShell
      title={t.name}
      subtitle={`Step ${p.exercise.step + 1} of ${t.steps.length}${sessionLabel}`}
      actions={
        <>
          <button type="button" onClick={() => setExiting(true)} className="rounded-lg px-2.5 py-1.5 text-[12.5px] text-paper-300 hover:bg-ink-800" data-testid="too-much">
            This is too much
          </button>
          {step.kind !== 'breathe' && step.kind !== 'plan' && step.kind !== 'list' && (
            <button type="button" onClick={() => void next()} className="inline-flex items-center gap-1 rounded-lg bg-ember-400 px-3 py-1.5 text-[12.5px] font-medium text-ink-950 hover:bg-ember-300">
              {isLast ? 'Finish exercise' : 'Next step'} <ChevronRight size={13} />
            </button>
          )}
          <button type="button" aria-label="End exercise" title="End exercise" onClick={() => void p.onUpdate({ finishedAt: new Date().toISOString() })} className="rounded-lg p-1.5 text-paper-500 hover:bg-ink-800 hover:text-paper-100">
            <CircleStop size={14} />
          </button>
        </>
      }
    >
      {step.kind === 'write' && (
        <p className="flex items-center gap-2 text-[12.5px] text-paper-300">
          <Feather size={13} className="shrink-0 text-ember-400" /> Write your answer under the prompt in your entry.
          {step.minutes ? <WritingTimer minutes={step.minutes} /> : null}
        </p>
      )}
      {step.hint && step.kind === 'write' && <p className="mt-1 text-[12px] text-paper-500">{step.hint}</p>}
      {step.kind === 'breathe' && (
        <>
          <p className="mb-2 flex items-center gap-1.5 text-[12.5px] text-paper-300">
            <Wind size={13} className="text-dusk-300" /> {step.prompt}
          </p>
          <BreathingPacer seconds={(step.minutes ?? 1) * 60} onDone={() => void next()} />
        </>
      )}
      {step.kind === 'plan' && (
        <>
          <p className="mb-2 text-[13px] text-paper-100">{step.prompt}</p>
          <PlanBuilder
            hint={step.hint}
            onSave={async (sentence, parts) => {
              p.onInsertText(`Plan: ${sentence}`);
              await addTask({ title: parts.then, plan: { when: parts.when, where: parts.where }, entryId: p.entryId, sourceText: sentence, tag: 'exercise' });
              toast({ title: 'Plan kept', body: 'It is in your entry and on your to-do list, under Later.' });
              await next();
            }}
          />
        </>
      )}
      {step.kind === 'name' && <p className="text-[12.5px] text-paper-300">{step.prompt} The picker is open beside your entry.</p>}
      {step.kind === 'worries' && (
        <>
          <p className="mb-2 text-[12.5px] text-paper-300">{step.prompt}</p>
          <WorryList
            worries={p.worries.filter((w) => w.kind === 'worry' && !w.doneAt)}
            onPlan={async (w) => {
              await addTask({ title: w.text.slice(0, 120), entryId: p.entryId, tag: 'worry' });
              await getDB().notes.update(w.id, { doneAt: new Date().toISOString(), entryId: p.entryId });
              toast({ title: 'Added to your to-do list', body: 'Give it a day in the planner when you are ready.' });
            }}
            onLetWait={(w) => void getDB().notes.update(w.id, { doneAt: new Date().toISOString(), entryId: p.entryId })}
            onWrite={async (w) => {
              await getDB().notes.update(w.id, { doneAt: new Date().toISOString(), entryId: p.entryId });
              p.onInsertText(`The worry: ${w.text}`);
            }}
          />
        </>
      )}
      {step.kind === 'list' && (
        <>
          <p className="mb-2 text-[12.5px] text-paper-300">{step.prompt}</p>
          <KindnessPlanner
            onSave={async (day, acts) => {
              for (const act of acts) await addTask({ title: act, dueDay: day, entryId: p.entryId, tag: 'kindness' });
              p.onInsertText(`Kindness day planned: ${acts.join('; ')}.`);
              toast({ title: 'Kindness day planned', body: "They're in your planner. Afterwards, the journal will ask how it went." });
              await next();
            }}
          />
        </>
      )}
    </RunnerShell>
  );
}

function RunnerShell({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label="Exercise" className="nr-rise rounded-2xl border border-ember-500/40 bg-ink-900/95 p-4 shadow-[0_18px_40px_-16px_rgba(0,0,0,0.7)] backdrop-blur" data-testid="exercise-runner">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[13.5px] font-medium text-paper-50">{title}</p>
          {subtitle && <p className="text-[11.5px] text-paper-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-1">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
