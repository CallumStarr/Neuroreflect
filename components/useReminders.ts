'use client';

// Keeps reminders running for as long as NeuroReflect is open. Unlocked, the
// planner says what is due; locked, only the unsealed times are known, so the
// reminder says "You have a reminder". The daily writing nudge rides along with
// the planner's reminders, and its locked text is never personal. The desktop
// app hands the list to its Rust side; a browser tab sets its own timers and
// can only remind while open.

import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { create } from 'zustand';
import { saveSettings } from '@/lib/db';
import { onDesktopEvent, setDesktopReminders, takeFiredReminders } from '@/lib/desktop';
import type { LockState } from '@/lib/lock';
import { loadNudgeInputs } from '@/lib/engagement';
import { planNudges } from '@/lib/nudge';
import { loadAgendaData } from '@/lib/planner';
import { isDesktop } from '@/lib/platform';
import { LOCKED_REMINDER, markShown, missedReminders, readSchedule, upcomingReminders, writeSchedule, type DueReminder } from '@/lib/reminders';
import { useUI } from '@/lib/store';
import { toast } from '@/lib/toasts';

/** Reminders that came due while NeuroReflect was closed, until the person clears them. */
export const useMissed = create<{ missed: DueReminder[]; set: (m: DueReminder[]) => void; clear: () => void }>((set) => ({
  missed: [],
  set: (missed) => set({ missed }),
  clear: () => set({ missed: [] }),
}));

const LATE_LIMIT_MS = 5 * 60000;
const REFRESH_MS = 10 * 60000;

interface Item {
  id: string;
  at: number;
  title: string;
  body: string;
  day?: string;
}

export function useReminders(opened: boolean, lock: LockState) {
  const ready = useUI((s) => s.ready);
  const settings = useUI((s) => s.settings);
  const readable = opened && lock !== 'locked' && ready;
  const shown = useRef(new Set<string>());
  const unrecorded = useRef(new Set<string>());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [tick, setTick] = useState(0);
  const desktop = typeof window !== 'undefined' && isDesktop();

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  const record = (ids: string[]) => {
    for (const id of ids) {
      shown.current.add(id);
      unrecorded.current.add(id);
    }
    if (!readable) return;
    const pending = [...unrecorded.current];
    unrecorded.current.clear();
    void markShown(pending).catch(() => pending.forEach((id) => unrecorded.current.add(id)));
  };
  const recordRef = useRef(record);
  recordRef.current = record;

  const showInApp = (item: Item) => {
    const nudge = item.id.startsWith('nudge:');
    toast({
      id: `reminder:${item.id}`,
      title: item.title,
      body: item.body,
      sticky: true,
      action: readable ? (nudge ? { label: 'Start writing', run: () => useUI.getState().setTab('studio') } : { label: 'Open the planner', run: () => useUI.getState().setTab('planner') }) : undefined,
    });
  };

  const arm = (items: Item[]) => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
    const now = Date.now();
    for (const item of items) {
      if (shown.current.has(item.id)) continue;
      if (item.at < now - LATE_LIMIT_MS) continue;
      const delay = Math.max(0, item.at - now);
      if (delay > 24 * 3600000) continue; // re-armed by the next refresh
      timers.current.push(
        setTimeout(() => {
          if (shown.current.has(item.id)) return;
          showInApp(item);
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
            try {
              new Notification(item.title, { body: item.body, tag: item.id });
            } catch {
              // Some browsers only allow notifications from a service worker.
            }
          }
          recordRef.current([item.id]);
        }, delay),
      );
    }
  };
  const armRef = useRef(arm);
  armRef.current = arm;

  // Unlocked: the planner says what is due, and the journal says when to nudge.
  const data = useLiveQuery(() => (readable ? loadAgendaData() : null), [readable, tick]);
  const nudges = useLiveQuery(async () => (readable ? planNudges(await loadNudgeInputs(settings)) : null), [readable, tick, settings]);
  useEffect(() => {
    if (!data || !nudges) return;
    const upcoming = upcomingReminders(data);
    const nudgeRows = nudges.map((n) => ({ id: n.id, at: n.at, title: n.lockedText.title, body: n.lockedText.body }));
    void writeSchedule(upcoming, settings.planner.reminderTextWhenLocked, nudgeRows).catch(() => undefined);
    const items: Item[] = [
      ...upcoming.map((r) => ({ id: r.id, at: r.at, title: r.title, body: r.body, day: r.day })),
      ...nudges.map((n) => ({ id: n.id, at: n.at, title: n.text.title, body: n.text.body, day: n.day })),
    ].sort((a, b) => a.at - b.at);
    if (desktop) void setDesktopReminders(items);
    else armRef.current(items);
  }, [data, nudges, desktop, settings.planner.reminderTextWhenLocked]);

  // Locked: only the times are known.
  useEffect(() => {
    if (!opened || lock !== 'locked') return;
    let cancelled = false;
    void readSchedule().then((row) => {
      if (cancelled || !row) return;
      const items: Item[] = row.items.map((i) => ({ id: i.id, at: i.at, title: i.title ?? LOCKED_REMINDER.title, body: i.body ?? LOCKED_REMINDER.body }));
      if (desktop) void setDesktopReminders(items);
      else armRef.current(items);
    });
    return () => {
      cancelled = true;
    };
  }, [opened, lock, desktop, tick]);

  // The desktop side shows the notification; this records that it did.
  useEffect(() => {
    if (!desktop) return;
    let off: (() => void) | null = null;
    void onDesktopEvent<string>('reminder-fired', (id) => recordRef.current([id])).then((u) => (off = u));
    return () => off?.();
  }, [desktop]);

  // On unlock: record anything shown while locked, then look for what was missed while closed.
  const missedChecked = useRef(false);
  useEffect(() => {
    if (!readable || !data) return;
    void (async () => {
      const fired = await takeFiredReminders();
      recordRef.current(fired);
      if (missedChecked.current) return;
      missedChecked.current = true;
      const missed = (await missedReminders(data, settings.lastOpenAt)).filter((r) => !shown.current.has(r.id));
      if (missed.length) {
        useMissed.getState().set(missed);
        toast({
          id: 'missed-reminders',
          title: missed.length === 1 ? 'A reminder came while NeuroReflect was closed' : `${missed.length} reminders came while NeuroReflect was closed`,
          body: missed
            .slice(0, 3)
            .map((m) => m.title)
            .join(', '),
          sticky: true,
          action: { label: 'See them', run: () => useUI.getState().setTab('planner') },
        });
      }
    })();
  }, [readable, data, settings.lastOpenAt]);

  // Remember when the journal was last open, for the next "missed" check.
  useEffect(() => {
    if (!readable) return;
    const stamp = () => void saveSettings({ lastOpenAt: new Date().toISOString() }).catch(() => undefined);
    const first = setTimeout(stamp, 3000);
    const t = setInterval(stamp, 60000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [readable]);

  useEffect(
    () => () => {
      for (const t of timers.current) clearTimeout(t);
    },
    [],
  );
}
