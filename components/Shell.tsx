'use client';

import { Component, useEffect, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDB, loadSettings } from '@/lib/db';
import { LockedError, initLock, lockNow, readLockMeta } from '@/lib/lock';
import { seedIfEmpty } from '@/lib/seed';
import { memoryIsStale, rebuildMemoryArtifacts } from '@/lib/memory';
import { isDesktop } from '@/lib/platform';
import { useUI } from '@/lib/store';
import { localDayOf } from '@/lib/util';
import LockScreen from './LockScreen';
import Sidebar from './Sidebar';
import Studio from './studio/Studio';
import Dashboard from './dashboard/Dashboard';
import MemoryView from './graph/MemoryView';
import Settings from './settings/Settings';
import { useLockState } from './useLockState';

// Offline cache for the browser build (public/sw.js). The desktop app's files are
// already on the computer, so it registers none: WebView2 serves them through
// Tauri's own protocol, which a service worker would sit in front of.
function useOfflineShell() {
  useEffect(() => {
    if (isDesktop() || process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
}

// Opening the database and reading the lock state happen once per page load,
// even when React mounts effects twice in development.
let openPromise: Promise<void> | null = null;
function openOnce() {
  if (!openPromise) {
    openPromise = (async () => {
      await getDB().open();
      await initLock();
    })();
    openPromise.catch(() => {
      openPromise = null;
    });
  }
  return openPromise;
}

// The rest of the boot needs readable data, so it waits for an unlock.
let bootPromise: Promise<{ todayDraftId: string | null }> | null = null;
function bootOnce() {
  if (!bootPromise) {
    bootPromise = (async () => {
      await seedIfEmpty();
      if (await memoryIsStale()) await rebuildMemoryArtifacts();
      const todayDraft = await getDB().entries.where('localDay').equals(localDayOf()).filter((e) => e.status === 'draft').first();
      return { todayDraftId: todayDraft?.id ?? null };
    })();
    bootPromise.catch(() => {
      bootPromise = null;
    });
  }
  return bootPromise;
}

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

class ViewBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    if (!(error instanceof LockedError)) console.error('[NeuroReflect] a view failed to render', error);
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md">
          <h1 className="font-serif text-2xl text-paper-50">This view could not be shown</h1>
          <p className="mt-3 text-[14px] leading-6 text-paper-300">{error.message}</p>
          <p className="mt-2 text-[13px] text-paper-500">Your entries are safe on this device. Try again, or reload.</p>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={() => this.setState({ error: null })} className="rounded-lg border border-ink-700 px-3 py-1.5 text-[13px] text-paper-100 hover:bg-ink-900">
              Try again
            </button>
            <button type="button" onClick={() => window.location.reload()} className="rounded-lg bg-ember-400 px-3 py-1.5 text-[13px] font-medium text-ink-950 hover:bg-ember-300">
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default function Shell() {
  const { tab, ready, setReady, setSettings, openEntry, setTab } = useUI();
  const lock = useLockState();
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useOfflineShell();

  useEffect(() => {
    openOnce().then(
      () => setOpened(true),
      (e) => {
        console.error(e);
        setError(e instanceof Error ? e.message : String(e));
      },
    );
  }, []);

  // Boot (or refresh settings) whenever the journal is readable.
  useEffect(() => {
    if (!opened || lock === 'locked') return;
    let cancelled = false;
    (async () => {
      try {
        const { todayDraftId } = await bootOnce();
        const settings = await loadSettings();
        if (cancelled) return;
        setSettings(settings);
        if (!useUI.getState().ready) {
          openEntry(todayDraftId);
          setReady(true);
        }
      } catch (e) {
        if (cancelled || e instanceof LockedError) return;
        console.error(e);
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [opened, lock, openEntry, setReady, setSettings]);

  // Auto-lock after the chosen time without input.
  const lockMeta = useLiveQuery(() => (opened ? readLockMeta() : null), [opened]);
  const autoLockMinutes = lockMeta?.autoLockMinutes ?? 0;
  useEffect(() => {
    if (lock !== 'unlocked' || !autoLockMinutes) return;
    let last = Date.now();
    const bump = () => {
      last = Date.now();
    };
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, bump, { passive: true });
    const timer = setInterval(() => {
      if (Date.now() - last > autoLockMinutes * 60000) void lockNow();
    }, 15000);
    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, bump);
      clearInterval(timer);
    };
  }, [lock, autoLockMinutes]);

  // Alt+1..4 switches views from anywhere; Alt+L locks.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key.toLowerCase() === 'l' || e.code === 'KeyL') {
        e.preventDefault();
        void lockNow();
        return;
      }
      const map: Record<string, typeof tab> = { '1': 'studio', '2': 'dashboard', '3': 'graph', '4': 'settings' };
      const next = map[e.key];
      if (next) {
        e.preventDefault();
        setTab(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setTab]);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-ink-950 p-8">
        <div className="max-w-md">
          <h1 className="font-serif text-2xl text-paper-50">The journal could not open its local database</h1>
          <p className="mt-3 text-paper-300">{error}</p>
          <p className="mt-3 text-sm text-paper-500">
            NeuroReflect keeps your journal in its own storage on this device. In a browser, private windows and some privacy settings block that storage, so open it in a normal window and try again.
          </p>
        </div>
      </div>
    );
  }

  if (opened && lock === 'locked') return <LockScreen />;

  if (!opened || !ready) {
    return <div className="flex h-screen items-center justify-center bg-ink-950 font-serif text-lg text-paper-500">Opening your journal</div>;
  }

  return (
    <div className="flex h-screen flex-col bg-ink-950 text-paper-50 md:flex-row">
      <Sidebar />
      <main className="relative order-1 min-h-0 min-w-0 flex-1 md:order-2">
        <ViewBoundary key={tab}>
          {tab === 'studio' && <Studio />}
          {tab === 'dashboard' && <Dashboard />}
          {tab === 'graph' && <MemoryView />}
          {tab === 'settings' && <Settings />}
        </ViewBoundary>
      </main>
    </div>
  );
}
