'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { saveSettings, type SettingsPatch } from '@/lib/db';
import { importIcs } from '@/lib/ics';
import { isDesktop } from '@/lib/platform';
import { useUI } from '@/lib/store';
import { REMINDER_CHOICES } from '../planner/shared';
import { Message, Section, inputCls, quietButton } from './ui';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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

// The planner's settings: the desktop app's tray, sign-in and shortcut, reminder
// defaults, the weekly review day, evening and worry prompts, and calendar import.
export default function PlannerSection() {
  const { settings, setSettings } = useUI();
  const p = settings.planner;
  const [desktop, setDesktop] = useState(false);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => setDesktop(isDesktop()), []);

  const save = async (patch: NonNullable<SettingsPatch['planner']>) => setSettings(await saveSettings({ planner: patch }));

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setImportMsg(null);
    try {
      const report = await importIcs(await file.text());
      const parts = [`${report.added} added`, report.updated ? `${report.updated} updated` : '', report.skipped ? `${report.skipped} skipped (cancelled or long past)` : ''].filter(Boolean);
      setImportMsg({ ok: true, text: `Imported: ${parts.join(', ')}.` });
    } catch (e) {
      setImportMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Section title="Planner and reminders" description="Events and tasks stay on this device with the rest of the journal. Reminders come from NeuroReflect itself, never from a server.">
      <div className="space-y-4" data-testid="settings-planner">
        {desktop && (
          <div className="space-y-3 rounded-xl border border-ink-800 px-4 py-3">
            <p className="text-[12px] font-medium text-paper-300">On this computer</p>
            <Check
              checked={p.keepInTray}
              onChange={(v) => void save({ keepInTray: v })}
              label="Keep NeuroReflect in the system tray when the window closes"
              note="So reminders and your writing nudge still arrive. Quit from the tray icon to close it fully."
            />
            <Check checked={p.startAtLogin} onChange={(v) => void save({ startAtLogin: v })} label="Start NeuroReflect in the tray when you sign in to Windows" />
            <Check checked={p.globalCapture} onChange={(v) => void save({ globalCapture: v })} label="Quick capture from anywhere with Ctrl+Alt+Space" note="Alt+C works inside NeuroReflect either way." />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="pl-remind" className="text-[13px] text-paper-100">
            Reminder for new events
          </label>
          <select
            id="pl-remind"
            value={p.defaultReminder === null ? '' : String(p.defaultReminder)}
            onChange={(e) => void save({ defaultReminder: e.target.value === '' ? null : Number(e.target.value) })}
            className={`${inputCls} w-auto`}
          >
            {REMINDER_CHOICES.map((c) => (
              <option key={String(c.value)} value={c.value === null ? '' : String(c.value)}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <Check
          checked={p.reminderTextWhenLocked}
          onChange={(v) => void save({ reminderTextWhenLocked: v })}
          label="Show what a reminder is about while the journal is locked"
          note="Off: a locked journal says only that you have a reminder."
        />

        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="pl-week" className="text-[13px] text-paper-100">
            Weeks start on
          </label>
          <select id="pl-week" value={String(p.weekStartsOn)} onChange={(e) => void save({ weekStartsOn: Number(e.target.value) as 0 | 1 })} className={`${inputCls} w-auto`}>
            <option value="1">Monday</option>
            <option value="0">Sunday</option>
          </select>
          <label htmlFor="pl-review" className="ml-2 text-[13px] text-paper-100">
            Weekly review and chapter on
          </label>
          <select id="pl-review" value={String(p.weeklyReviewDay)} onChange={(e) => void save({ weeklyReviewDay: Number(e.target.value) })} className={`${inputCls} w-auto`}>
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <Check
          checked={p.bedtimeList.enabled}
          onChange={(v) => void save({ bedtimeList: { enabled: v } })}
          label={`Offer tomorrow's list in the evening, after ${p.bedtimeList.after}, when sleeping better is one of your goals`}
        />
        <div className="space-y-2">
          <Check checked={p.worryPeriod.enabled} onChange={(v) => void save({ worryPeriod: { enabled: v } })} label="A set time for worries" note="Worries that come up during the day wait for this time, and the journal reminds you when it comes." />
          {p.worryPeriod.enabled && (
            <div className="ml-6 flex flex-wrap items-center gap-2 text-[13px] text-paper-300">
              <span>At</span>
              <input type="time" aria-label="Worry time" value={p.worryPeriod.time} onChange={(e) => void save({ worryPeriod: { time: e.target.value } })} className={`${inputCls} w-auto`} />
              <span>for</span>
              <select aria-label="Worry time length" value={String(p.worryPeriod.minutes)} onChange={(e) => void save({ worryPeriod: { minutes: Number(e.target.value) } })} className={`${inputCls} w-auto`}>
                {[10, 15, 20, 30].map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </select>
              <input aria-label="Worry place" value={p.worryPeriod.place} onChange={(e) => void save({ worryPeriod: { place: e.target.value } })} className={`${inputCls} w-56`} />
            </div>
          )}
        </div>
        <Check checked={p.oneTap} onChange={(v) => void save({ oneTap: v })} label={'Offer "Add to your to-do list?" for lines that read like a task'} />
        {settings.provider.primary !== 'heuristic' && (
          <Check
            checked={p.aiTaskSuggestions}
            onChange={(v) => void save({ aiTaskSuggestions: v })}
            label="Let your AI provider suggest tasks when you finish an entry"
            note="Off by default. The entry is sent to the provider you chose."
          />
        )}

        <div className="rounded-xl border border-ink-800 px-4 py-3">
          <p className="text-[13px] text-paper-100">Import a calendar</p>
          <p className="mt-0.5 text-[12px] leading-5 text-paper-500">
            An .ics file exported from Outlook, Google Calendar or Apple Calendar. Events are copied in once and nothing syncs. Importing the same calendar again updates its events.
          </p>
          <input ref={fileRef} type="file" accept=".ics,text/calendar" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} data-testid="ics-input" />
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className={`${quietButton} mt-3 inline-flex items-center gap-1.5`}>
            <CalendarPlus size={14} /> {busy ? 'Importing...' : 'Choose an .ics file'}
          </button>
          <div className="mt-2">
            <Message value={importMsg} />
          </div>
        </div>
      </div>
    </Section>
  );
}
