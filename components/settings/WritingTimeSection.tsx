'use client';

import { useState } from 'react';
import { saveSettings, type SettingsPatch } from '@/lib/db';
import { formatTime } from '@/lib/nl-date';
import { useUI } from '@/lib/store';
import { WritingTimeDialog } from '../engagement/Dialogs';
import { nudgeTimeLabel } from '../engagement/WritingPlanEditor';
import { Section, inputCls, quietButton } from './ui';

function Check({ checked, onChange, label, note, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; note?: string; testId?: string }) {
  return (
    <label className="flex items-start gap-2 text-[13px] text-paper-100" data-testid={testId}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 accent-[#e0aa4a]" />
      <span>
        {label}
        {note && <span className="block text-[12px] leading-5 text-paper-500">{note}</span>}
      </span>
    </label>
  );
}

// The writing plan, the nudge and its limits, and the features that bring
// people back by giving them something worth coming back to.
export default function WritingTimeSection() {
  const { settings, setSettings } = useUI();
  const e = settings.engagement;
  const [open, setOpen] = useState(false);
  const save = async (patch: NonNullable<SettingsPatch['engagement']>) => setSettings(await saveSettings({ engagement: patch }));
  const when = nudgeTimeLabel(e);

  return (
    <Section title="Writing time" description="A moment in your day is the cue; one nudge is the backup. Nothing here ever counts a missed day.">
      <div className="space-y-4" data-testid="settings-writing-time">
        <div className="rounded-xl border border-ink-800 px-4 py-3">
          <p className="text-[13px] text-paper-100">
            {e.plan ? (
              <>
                You write {e.plan.moment}
                {e.plan.place ? `, ${e.plan.place}` : ''}, usually around {formatTime(e.plan.usualTime)}.
              </>
            ) : (
              'No writing time yet.'
            )}
          </p>
          <p className="mt-0.5 text-[12px] leading-5 text-paper-500">
            {!e.plan
              ? 'Choose a moment that already happens in your day.'
              : !e.nudge.enabled
                ? 'No nudge.'
                : when
                  ? `Nudge around ${when}${e.nudge.frequency === 'weekly' ? ' on your review day only' : ''}, only on days you haven't written.`
                  : 'Your moment falls in quiet hours, so no nudge is sent.'}
            {e.rhythm !== null ? ` Weekly aim: ${e.rhythm === 7 ? 'every day' : `${e.rhythm} days`}.` : ''}
          </p>
          <button type="button" onClick={() => setOpen(true)} className={`${quietButton} mt-3`} data-testid="edit-writing-time">
            {e.plan ? 'Change writing time' : 'Choose a writing time'}
          </button>
        </div>

        {e.plan && (
          <div className="space-y-3">
            <Check checked={e.nudge.enabled} onChange={(v) => void save({ nudge: { enabled: v } })} label="One nudge if I haven't written by an hour after my moment" />
            {e.nudge.enabled && (
              <div className="ml-6 flex flex-wrap items-center gap-2 text-[13px] text-paper-300">
                <label htmlFor="wt-freq">Send it</label>
                <select id="wt-freq" value={e.nudge.frequency} onChange={(ev) => void save({ nudge: { frequency: ev.target.value as 'daily' | 'weekly' } })} className={`${inputCls} w-auto`}>
                  <option value="daily">any day I haven't written</option>
                  <option value="weekly">on my review day only</option>
                </select>
              </div>
            )}
            <Check
              checked={e.nudge.showEventNames}
              onChange={(v) => void save({ nudge: { showEventNames: v } })}
              label="Name planner events in the nudge"
              note='Off: "Something you planned has happened. How did it go?" A locked journal never shows names.'
            />
          </div>
        )}

        <div className="space-y-2">
          <Check checked={e.quietHours.enabled} onChange={(v) => void save({ quietHours: { enabled: v } })} label="Quiet hours" note="No nudge from NeuroReflect itself in these hours. Planner reminders you set still arrive." />
          {e.quietHours.enabled && (
            <div className="ml-6 flex flex-wrap items-center gap-2 text-[13px] text-paper-300">
              <span>From</span>
              <input type="time" aria-label="Quiet hours start" value={e.quietHours.from} onChange={(ev) => ev.target.value && void save({ quietHours: { from: ev.target.value } })} className={`${inputCls} w-auto`} />
              <span>to</span>
              <input type="time" aria-label="Quiet hours end" value={e.quietHours.to} onChange={(ev) => ev.target.value && void save({ quietHours: { to: ev.target.value } })} className={`${inputCls} w-auto`} />
            </div>
          )}
        </div>

        <Check
          checked={e.todaysQuestion}
          onChange={(v) => void save({ todaysQuestion: v })}
          label="Today's question"
          note="One light question a day, the same for everyone using NeuroReflect. Your answer stays private."
        />
        <Check
          checked={e.nextTimeQuestion}
          onChange={(v) => void save({ nextTimeQuestion: v })}
          label="Offer a question for next time when I finish an entry"
          note="Your own question then opens your next entry."
        />
        <Check
          checked={e.valuedEntries}
          onChange={(v) => void save({ valuedEntries: v })}
          label='Ask "Was this worth your time?" about one entry in five at most'
          note="Asked at a later visit, because some writing feels harder at the time and helps later. The answers help choose exercises that work for you."
        />
      </div>
      {open && <WritingTimeDialog onClose={() => setOpen(false)} />}
    </Section>
  );
}
