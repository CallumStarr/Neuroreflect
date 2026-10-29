'use client';

import { useState } from 'react';
import { saveSettings } from '@/lib/db';
import { useUI } from '@/lib/store';
import { GOALS } from '@/lib/techniques';
import type { GoalId, Tone } from '@/lib/types';
import Dialog from './ui/Dialog';

const TONES: { id: Tone; label: string; blurb: string }[] = [
  { id: 'gentle', label: 'Gentle', blurb: 'Warm and encouraging' },
  { id: 'plain', label: 'Plain', blurb: 'Short and direct' },
  { id: 'curious', label: 'Curious', blurb: 'Open questions, more exploring' },
];

// Goals decide which prompts and techniques are offered. Everything here can be
// skipped and changed later in Settings.
export default function GoalsSetup({ onClose }: { onClose: () => void }) {
  const { settings, setSettings } = useUI();
  const [goals, setGoals] = useState<GoalId[]>(settings.guidance.goals);
  const [name, setName] = useState(settings.userName);
  const [tone, setTone] = useState<Tone>(settings.guidance.tone);
  const [avoid, setAvoid] = useState(settings.guidance.avoidTopics.join(', '));

  const save = async () => {
    const next = await saveSettings({
      userName: name.trim(),
      guidance: {
        goals,
        tone,
        avoidTopics: avoid
          .split(/[,\n]/)
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 12),
        setupDone: true,
      },
    });
    setSettings(next);
    onClose();
  };

  return (
    <Dialog
      label="Set up your journal"
      title="What are you journalling for?"
      description="This shapes which prompts and exercises you're offered. Pick as many as you like. You can change any of it in Settings."
      onClose={async () => {
        const next = await saveSettings({ guidance: { setupDone: true } });
        setSettings(next);
        onClose();
      }}
      width="w-[600px]"
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label="Goals">
        {GOALS.map((g) => {
          const on = goals.includes(g.id);
          return (
            <button
              key={g.id}
              type="button"
              aria-pressed={on}
              onClick={() => setGoals(on ? goals.filter((x) => x !== g.id) : [...goals, g.id])}
              className={`rounded-xl border px-3 py-2 text-left ${on ? 'border-ember-400 bg-ember-400/10' : 'border-ink-700 hover:border-ink-600'}`}
            >
              <span className="block text-[13.5px] text-paper-50">{g.label}</span>
              <span className="block text-[12px] text-paper-500">{g.blurb}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="setup-name" className="text-[12.5px] text-paper-300">
            The name to use for you (optional)
          </label>
          <input id="setup-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-[14px] text-paper-50 focus:border-ember-400 focus:outline-none" />
          <p className="mt-1 text-[11.5px] text-paper-500">Stepping-back prompts can talk about you in the third person.</p>
        </div>
        <div>
          <p className="text-[12.5px] text-paper-300">Tone</p>
          <div className="mt-1 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Tone">
            {TONES.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={tone === t.id} title={t.blurb} onClick={() => setTone(t.id)} className={`rounded-full border px-3 py-1 text-[12.5px] ${tone === t.id ? 'border-ember-400 bg-ember-400/10 text-paper-50' : 'border-ink-700 text-paper-300'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-4">
        <label htmlFor="setup-avoid" className="text-[12.5px] text-paper-300">
          Anything to leave alone? (optional)
        </label>
        <input
          id="setup-avoid"
          value={avoid}
          onChange={(e) => setAvoid(e.target.value)}
          placeholder="Separate topics with commas"
          className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-[14px] text-paper-50 placeholder:text-paper-500 focus:border-ember-400 focus:outline-none"
        />
        <p className="mt-1 text-[11.5px] text-paper-500">Prompts never raise these. You can still write about them whenever you want.</p>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={async () => {
            const next = await saveSettings({ guidance: { setupDone: true } });
            setSettings(next);
            onClose();
          }}
          className="rounded-lg px-3 py-1.5 text-[13px] text-paper-300 hover:bg-ink-800"
        >
          Skip for now
        </button>
        <button type="button" onClick={() => void save()} className="rounded-lg bg-ember-400 px-3.5 py-1.5 text-[13px] font-medium text-ink-950 hover:bg-ember-300">
          Save
        </button>
      </div>
    </Dialog>
  );
}
