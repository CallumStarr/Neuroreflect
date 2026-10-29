'use client';

import { useState } from 'react';
import { saveSettings } from '@/lib/db';
import { useUI } from '@/lib/store';
import { EVIDENCE, GOALS, LEVELS, TECHNIQUES, techniqueEnabled } from '@/lib/techniques';
import type { GuidanceLevel, TechniqueId } from '@/lib/types';
import GoalsSetup from '../GoalsSetup';
import { GuidanceSlider } from '../studio/GuidanceParts';
import { Section, quietButton } from './ui';

// How much the journal says, what it is for, and which exercises it may offer.
// The safety rails (help, the step-back guard, "This is too much") sit outside
// all of this and never switch off.
export default function GuidanceSection() {
  const { settings, setSettings } = useUI();
  const g = settings.guidance;
  const [goalsOpen, setGoalsOpen] = useState(false);

  const save = async (patch: Parameters<typeof saveSettings>[0]) => setSettings(await saveSettings(patch));
  const level = LEVELS.find((l) => l.id === g.level);
  const goalNames = g.goals.map((id) => GOALS.find((x) => x.id === id)?.label).filter(Boolean);
  const offersTechniques = g.level === 'guided' || g.level === 'deep';

  return (
    <Section
      title="Guidance"
      description="How much the journal says, and what it is for. Help, the step-back guard and This is too much stay on at every level."
    >
      <div data-testid="settings-guidance">
        <GuidanceSlider level={g.level} onChange={(l: GuidanceLevel) => void save({ guidance: { level: l } })} />
        {level && <p className="mt-2 text-[12.5px] leading-5 text-paper-500">{level.blurb}</p>}

        <div className="mt-5 rounded-xl border border-ink-800 px-4 py-3">
          <p className="text-[13px] text-paper-100">What you're journalling for</p>
          <p className="mt-0.5 text-[12.5px] leading-5 text-paper-500">
            {goalNames.length ? goalNames.join(', ') : 'Not chosen yet.'}
            {g.avoidTopics.length ? ` Topics to leave alone: ${g.avoidTopics.join(', ')}.` : ''}
          </p>
          <button type="button" onClick={() => setGoalsOpen(true)} className={`${quietButton} mt-3`}>
            Change goals, tone and topics
          </button>
        </div>

        <label className="mt-4 flex items-start gap-2 text-[13px] text-paper-100">
          <input type="checkbox" checked={g.feelingCheck} onChange={(e) => void save({ guidance: { feelingCheck: e.target.checked } })} className="mt-1 accent-[#e0aa4a]" />
          <span>
            Offer a one-tap feeling check before and after an exercise
            <span className="block text-[12px] text-paper-500">Some exercises feel worse at first and better later, so results are judged over days, not minutes.</span>
          </span>
        </label>

        <div className="mt-6">
          <p className="text-[13px] text-paper-100">Exercises the journal may offer</p>
          <p className="mt-0.5 text-[12px] leading-5 text-paper-500">
            {offersTechniques
              ? 'Guided offers the first set; Deep offers them all. A tick here always wins.'
              : 'Exercises are offered at Guided and Deep. Your ticks are kept for when you switch.'}
          </p>
          <ul className="mt-3 divide-y divide-ink-800 rounded-xl border border-ink-800" data-testid="technique-ticks">
            {TECHNIQUES.map((t) => {
              const on = techniqueEnabled(t.id, { level: g.level === 'blank' || g.level === 'open' ? 'deep' : g.level, techniques: g.techniques });
              return (
                <li key={t.id} className="px-4 py-2.5">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => void save({ guidance: { techniques: { ...g.techniques, [t.id as TechniqueId]: e.target.checked } } })}
                      className="mt-1 accent-[#e0aa4a]"
                    />
                    <span className="min-w-0">
                      <span className="text-[13px] text-paper-50">{t.name}</span>
                      <span className="ml-2 text-[11.5px] text-paper-500" title={EVIDENCE[t.evidence].note}>
                        {EVIDENCE[t.evidence].label}
                      </span>
                      <span className="block text-[12px] leading-5 text-paper-500">{t.oneLine}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      {goalsOpen && <GoalsSetup onClose={() => setGoalsOpen(false)} />}
    </Section>
  );
}
