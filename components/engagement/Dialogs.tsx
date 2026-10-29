'use client';

import { useState } from 'react';
import { saveSettings } from '@/lib/db';
import { withSetAt } from '@/lib/nudge';
import { HABIT_ITEMS } from '@/lib/stats';
import { useUI } from '@/lib/store';
import Dialog from '../ui/Dialog';
import WritingPlanEditor, { MOMENTS, type PlanDraft } from './WritingPlanEditor';

/** The writing plan on its own: set it, move it, or change the weekly aim. */
export function WritingTimeDialog({ onClose, answeringBackoff = false }: { onClose: () => void; answeringBackoff?: boolean }) {
  const { settings, setSettings } = useUI();
  const e = settings.engagement;
  const [draft, setDraft] = useState<PlanDraft>({
    plan: e.plan ?? { moment: MOMENTS[3].moment, usualTime: MOMENTS[3].time, place: '' },
    nudge: e.plan ? e.nudge.enabled : true,
    rhythm: e.rhythm,
  });
  const save = async () => {
    const plan = draft.plan.moment.trim() ? withSetAt({ ...draft.plan, moment: draft.plan.moment.trim(), place: draft.plan.place.trim() }, e.plan) : null;
    setSettings(
      await saveSettings({
        engagement: {
          plan,
          rhythm: draft.rhythm,
          nudge: { enabled: draft.nudge, ...(answeringBackoff ? { backoffAnsweredAt: new Date().toISOString() } : {}) },
          seen: [...new Set([...e.seen, 'writing-time-intro'])],
        },
      }),
    );
    onClose();
  };
  return (
    <Dialog label="Your writing time" title="Your writing time" description="A moment in your day is the cue; the nudge is a backup that steps back once writing is a habit." onClose={onClose} width="w-[640px]">
      <WritingPlanEditor value={draft} onChange={setDraft} engagement={e} />
      <div className="mt-6 flex justify-end gap-2 border-t border-ink-800 pt-4">
        <button type="button" onClick={onClose} className="rounded-lg border border-ink-700 px-3 py-1.5 text-[13px] text-paper-100 hover:bg-ink-900">
          Cancel
        </button>
        <button type="button" onClick={() => void save()} className="rounded-lg bg-ember-400 px-3.5 py-1.5 text-[13px] font-medium text-ink-950 hover:bg-ember-300" data-testid="writing-time-save">
          Save
        </button>
      </div>
    </Dialog>
  );
}

const SCALE = [1, 2, 3, 4, 5, 6, 7];

/**
 * The habit check: four statements, each from 1 (strongly disagree) to 7
 * (strongly agree), the Self-Report Behavioural Automaticity Index (Gardner et
 * al. 2012). It shows whether writing is becoming automatic rather than
 * prompted. Kept on this device; testers can include the scores in their
 * usage summary.
 */
export function HabitCheckDialog({ onClose }: { onClose: () => void }) {
  const { settings, setSettings } = useUI();
  const [answers, setAnswers] = useState<(number | null)[]>(HABIT_ITEMS.map(() => null));
  const complete = answers.every((a) => a !== null);
  const save = async () => {
    const score = Math.round(((answers as number[]).reduce((a, b) => a + b, 0) / answers.length) * 100) / 100;
    setSettings(await saveSettings({ engagement: { habitChecks: [...settings.engagement.habitChecks, { at: new Date().toISOString(), score }] } }));
    onClose();
  };
  return (
    <Dialog label="Habit check" title="A 30-second habit check" description="How much do you agree with each? 1 is strongly disagree and 7 is strongly agree. There are no right answers." onClose={onClose} width="w-[620px]">
      <ol className="space-y-4">
        {HABIT_ITEMS.map((item, i) => (
          <li key={item}>
            <p className="text-[13px] text-paper-100">{item}</p>
            <div className="mt-1.5 flex flex-wrap gap-1" role="radiogroup" aria-label={item}>
              {SCALE.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={answers[i] === n}
                  onClick={() => setAnswers((a) => a.map((v, j) => (j === i ? n : v)))}
                  className={`h-8 w-9 rounded-lg border text-[13px] ${answers[i] === n ? 'border-ember-400 bg-ember-400/15 text-paper-50' : 'border-ink-700 text-paper-300 hover:border-ink-600'}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex justify-end">
        <button type="button" disabled={!complete} onClick={() => void save()} className="rounded-lg bg-ember-400 px-3.5 py-1.5 text-[13px] font-medium text-ink-950 hover:bg-ember-300 disabled:opacity-40">
          Save
        </button>
      </div>
    </Dialog>
  );
}
