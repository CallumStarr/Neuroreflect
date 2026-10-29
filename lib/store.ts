import { create } from 'zustand';
import type { AppSettings, LocalDay } from './types';
import { DEFAULT_SETTINGS } from './db';

export type Tab = 'studio' | 'planner' | 'dashboard' | 'graph' | 'settings';
export type MemoryMode = 'graph' | 'timeline' | 'recall';
export type PlannerMode = 'day' | 'week' | 'month';

/** The view order, which Alt+1 to Alt+5 follow. */
export const TAB_ORDER: Tab[] = ['studio', 'planner', 'dashboard', 'graph', 'settings'];

/** A prompt to start the next new entry with, for example from the weekly review. */
export interface PendingPrompt {
  id: string;
  text: string;
  reason: string;
}

interface UIState {
  tab: Tab;
  activeEntryId: string | null;
  settings: AppSettings;
  ready: boolean;
  memoryMode: MemoryMode;
  plannerMode: PlannerMode;
  plannerDay: LocalDay | null;
  helpOpen: boolean;
  captureOpen: boolean;
  /** Opens this task's editor when the planner shows. */
  focusTaskId: string | null;
  pendingPrompt: PendingPrompt | null;
  /** Bumped to ask the journal for a fresh, empty entry. */
  newEntryNonce: number;
  setTab: (tab: Tab) => void;
  openEntry: (id: string | null) => void;
  setSettings: (s: AppSettings) => void;
  setReady: (r: boolean) => void;
  setMemoryMode: (m: MemoryMode) => void;
  setPlannerMode: (m: PlannerMode) => void;
  setPlannerDay: (d: LocalDay | null) => void;
  setHelpOpen: (open: boolean) => void;
  setCaptureOpen: (open: boolean) => void;
  openTask: (id: string | null) => void;
  startEntryWith: (p: PendingPrompt | null) => void;
  takePendingPrompt: () => PendingPrompt | null;
}

export const useUI = create<UIState>((set, get) => ({
  tab: 'studio',
  activeEntryId: null,
  settings: DEFAULT_SETTINGS,
  ready: false,
  memoryMode: 'graph',
  plannerMode: 'week',
  plannerDay: null,
  helpOpen: false,
  captureOpen: false,
  focusTaskId: null,
  pendingPrompt: null,
  newEntryNonce: 0,
  setTab: (tab) => set({ tab }),
  openEntry: (id) => set({ activeEntryId: id, tab: 'studio' }),
  setSettings: (settings) => set({ settings }),
  setReady: (ready) => set({ ready }),
  setMemoryMode: (memoryMode) => set({ memoryMode }),
  setPlannerMode: (plannerMode) => set({ plannerMode }),
  setPlannerDay: (plannerDay) => set({ plannerDay }),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  setCaptureOpen: (captureOpen) => set({ captureOpen }),
  openTask: (focusTaskId) => set({ focusTaskId, tab: focusTaskId ? 'planner' : get().tab }),
  startEntryWith: (pendingPrompt) => set((s) => ({ pendingPrompt, tab: 'studio', activeEntryId: null, newEntryNonce: s.newEntryNonce + 1 })),
  takePendingPrompt: () => {
    const p = get().pendingPrompt;
    if (p) set({ pendingPrompt: null });
    return p;
  },
}));
