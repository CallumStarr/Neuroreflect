'use client';

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download } from 'lucide-react';
import { getDB, saveSettings } from '@/lib/db';
import { saveTextFile } from '@/lib/platform';
import { computeFigures, usageSummary } from '@/lib/stats';
import { useUI } from '@/lib/store';
import { HabitCheckDialog } from '../engagement/Dialogs';
import { Message, Section, quietButton } from './ui';

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev';

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ink-800 py-1.5 last:border-b-0">
      <span className="text-[13px] text-paper-300">
        {label}
        {note && <span className="block text-[11.5px] text-paper-500">{note}</span>}
      </span>
      <span className="nr-num shrink-0 text-[13px] text-paper-50">{value}</span>
    </div>
  );
}

const pct = (n: number | null) => (n === null ? 'None yet' : `${Math.round(n * 100)}%`);

// The person's own figures, worked out on this device, and, for testers, a
// summary of counts they can choose to send. Nothing leaves the device unless
// they save the file and send it themselves.
export default function FiguresSection() {
  const { settings, setSettings } = useUI();
  const [habitOpen, setHabitOpen] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Re-read when entries, ratings or nudges change.
  const stamp = useLiveQuery(async () => {
    const db = getDB();
    const [e, r] = await Promise.all([db.entries.count(), db.reminderLog.count()]);
    return `${e}:${r}`;
  }, []);
  const figures = useLiveQuery(() => computeFigures(settings), [settings, stamp]);

  const exportSummary = async () => {
    if (!figures) return;
    const summary = usageSummary(figures, settings, APP_VERSION);
    const saved = await saveTextFile('neuroreflect-usage-summary.json', JSON.stringify(summary, null, 2));
    setMsg(saved ? { ok: true, text: 'Saved. It holds counts only: open it to see exactly what it contains before you send it.' } : null);
  };

  return (
    <Section title="Your figures" description="Worked out on this device and never sent anywhere. They describe how you use NeuroReflect, not you.">
      <div data-testid="settings-figures">
        {figures ? (
          <div className="rounded-xl border border-ink-800 px-4 py-2">
            <Row label="Entries" value={String(figures.entries)} note={`${figures.entriesLast28} in the last four weeks`} />
            <Row
              label="Weeks with writing"
              value={figures.weeksSinceStart ? `${figures.weeksWrittenOf8} of ${figures.weeksSinceStart}` : 'None yet'}
              note={figures.weeksSinceStart === 0 ? undefined : figures.weeksSinceStart < 8 ? 'since your first entry' : 'in the last eight weeks'}
            />
            <Row label="Entries you found worth your time" value={pct(figures.valuedShare)} note={figures.rated ? `4 or 5 out of 5, of the ${figures.rated} you rated` : undefined} />
            <Row label="Nudges in the last four weeks" value={String(figures.nudges.shownLast28)} note={figures.nudges.shownLast28 ? `${figures.nudges.within2h} followed by writing within two hours` : undefined} />
            {figures.rhythm.target !== null && <Row label="Weeks your aim was met" value={figures.rhythm.weeksKeptOf8 ? String(figures.rhythm.weeksKeptOf8) : 'None yet'} note="in the last eight weeks" />}
            {figures.habit.length > 0 && <Row label="Habit check" value={figures.habit.map((h) => h.score.toFixed(1)).join(', ')} note="1 to 7, higher means more automatic" />}
          </div>
        ) : (
          <p className="text-[12.5px] text-paper-500">Working them out...</p>
        )}

        <label className="mt-5 flex items-start gap-2 text-[13px] text-paper-100" data-testid="tester-toggle">
          <input type="checkbox" checked={settings.engagement.tester} onChange={async (ev) => setSettings(await saveSettings({ engagement: { tester: ev.target.checked } }))} className="mt-1 accent-[#e0aa4a]" />
          <span>
            I'm testing NeuroReflect
            <span className="block text-[12px] leading-5 text-paper-500">Offers a 30-second habit check every four weeks, and lets you save a usage summary to send by email.</span>
          </span>
        </label>
        {settings.engagement.tester && (
          <div className="ml-6 mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setHabitOpen(true)} className={quietButton}>
              Take the habit check
            </button>
            <button type="button" onClick={() => void exportSummary()} disabled={!figures} className={`${quietButton} inline-flex items-center gap-1.5`} data-testid="export-usage">
              <Download size={14} /> Save my usage summary
            </button>
          </div>
        )}
        {settings.engagement.tester && <p className="ml-6 mt-2 text-[12px] leading-5 text-paper-500">The summary holds counts and settings only: no entry text, no feelings, no dates, no names and nothing from your planner.</p>}
        <div className="ml-6 mt-2">
          <Message value={msg} />
        </div>
      </div>
      {habitOpen && <HabitCheckDialog onClose={() => setHabitOpen(false)} />}
    </Section>
  );
}
