'use client';

import { useState } from 'react';
import { saveSettings } from '@/lib/db';
import { withSetAt } from '@/lib/nudge';
import { seedDatabase } from '@/lib/seed';
import { useUI } from '@/lib/store';
import { GOALS } from '@/lib/techniques';
import type { GoalId } from '@/lib/types';
import Dialog from '../ui/Dialog';
import WritingPlanEditor, { MOMENTS, type PlanDraft } from './WritingPlanEditor';

/** The first prompt, for the first entry: concrete, about now, and easy to start. */
export const FIRST_ENTRY_PROMPT = {
  id: 'first-entry',
  text: "What's taking up the most room in your head this week?",
  reason: 'Your first entry. A few lines is plenty. When you finish, NeuroReflect pulls out the takeaway.',
};

/**
 * The first session: what the journal is for, when the person will write, and
 * then straight into a first entry, so day two has a reason before day one
 * ends. Everything can be skipped, and the sample entries stay available as a
 * demo for anyone who would rather look around first.
 */
export default function WelcomeDialog({ onDone }: { onDone: () => void }) {
  const { settings, setSettings, startEntryWith, openEntry } = useUI();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [goals, setGoals] = useState<GoalId[]>(settings.guidance.goals);
  const [name, setName] = useState(settings.userName);
  const [draft, setDraft] = useState<PlanDraft>({
    plan: settings.engagement.plan ?? { moment: MOMENTS[3].moment, usualTime: MOMENTS[3].time, place: '' },
    nudge: settings.engagement.nudge.enabled,
    rhythm: settings.engagement.rhythm,
  });
  const [busy, setBusy] = useState(false);

  const close = async () => {
    setSettings(await saveSettings({ engagement: { welcomeDone: true } }));
    onDone();
  };

  const explore = async () => {
    setBusy(true);
    await seedDatabase();
    setSettings(await saveSettings({ engagement: { welcomeDone: true } }));
    openEntry(null);
    setBusy(false);
    onDone();
  };

  const finish = async () => {
    setBusy(true);
    const next = await saveSettings({
      userName: name.trim(),
      guidance: { goals, setupDone: true },
      engagement: { plan: draft.plan.moment.trim() ? withSetAt({ ...draft.plan, moment: draft.plan.moment.trim(), place: draft.plan.place.trim() }, settings.engagement.plan) : null, nudge: { enabled: draft.nudge }, rhythm: draft.rhythm, welcomeDone: true },
    });
    setSettings(next);
    setBusy(false);
    onDone();
    startEntryWith(FIRST_ENTRY_PROMPT);
  };

  if (step === 0) {
    return (
      <Dialog label="Welcome to NeuroReflect" title="Welcome to NeuroReflect" onClose={() => void close()} width="w-[540px]">
        <div data-testid="welcome-dialog">
          <p className="text-[14px] leading-6 text-paper-300">
            A private journal that keeps everything on this computer. Two quick choices, then your first entry. It takes about five minutes, and you can change anything later.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setStep(1)} className="rounded-lg bg-ember-400 px-3.5 py-2 text-[13px] font-medium text-ink-950 hover:bg-ember-300">
              Let's start
            </button>
            <button type="button" disabled={busy} onClick={() => void explore()} className="rounded-lg border border-ink-700 px-3.5 py-2 text-[13px] text-paper-100 hover:bg-ink-900 disabled:opacity-50">
              Explore with sample entries first
            </button>
          </div>
        </div>
      </Dialog>
    );
  }

  if (step === 1) {
    return (
      <Dialog label="What are you journalling for?" title="What are you journalling for?" description="Pick as many as you like. This shapes which prompts you're offered." onClose={() => void close()} width="w-[600px]">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label="Goals">
          {GOALS.map((g) => {
            const on = goals.includes(g.id);
            return (
              <button
                key={g.id}
                type="button"
                aria-pressed={on}
                onClick={() => setGoals((list) => (on ? list.filter((x) => x !== g.id) : [...list, g.id]))}
                className={`rounded-xl border px-3.5 py-2.5 text-left ${on ? 'border-ember-400 bg-ember-400/10' : 'border-ink-700 hover:border-ink-600'}`}
              >
                <span className="block text-[13.5px] text-paper-50">{g.label}</span>
                <span className="block text-[12px] text-paper-500">{g.blurb}</span>
              </button>
            );
          })}
        </div>
        <label htmlFor="welcome-name" className="mt-4 block text-[13px] text-paper-100">
          Your first name <span className="text-paper-500">(optional, for prompts that address you by name)</span>
        </label>
        <input
          id="welcome-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full max-w-xs rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-[14px] text-paper-50 focus:border-ember-400 focus:outline-none"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => setStep(2)} className="rounded-lg bg-ember-400 px-3.5 py-2 text-[13px] font-medium text-ink-950 hover:bg-ember-300">
            Next
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      label="Your writing time"
      title="When will you write?"
      description="Tie writing to a moment that already happens in your day. That moment becomes the cue; the nudge is only a backup."
      onClose={() => void close()}
      width="w-[640px]"
    >
      <WritingPlanEditor value={draft} onChange={setDraft} engagement={settings.engagement} />
      <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-ink-800 pt-4">
        <button type="button" disabled={busy} onClick={() => void finish()} className="rounded-lg bg-ember-400 px-3.5 py-2 text-[13px] font-medium text-ink-950 hover:bg-ember-300 disabled:opacity-50" data-testid="welcome-finish">
          Start my first entry
        </button>
      </div>
    </Dialog>
  );
}
