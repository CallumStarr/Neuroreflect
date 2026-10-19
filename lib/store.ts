import { create } from 'zustand';
import type { AppSettings } from './types';
import { DEFAULT_SETTINGS } from './db';

export type Tab = 'studio' | 'dashboard' | 'graph' | 'settings';
export type MemoryMode = 'graph' | 'timeline' | 'recall';

interface UIState {
  tab: Tab;
  activeEntryId: string | null;
  settings: AppSettings;
  ready: boolean;
  memoryMode: MemoryMode;
  setTab: (tab: Tab) => void;
  openEntry: (id: string | null) => void;
  setSettings: (s: AppSettings) => void;
  setReady: (r: boolean) => void;
  setMemoryMode: (m: MemoryMode) => void;
}

export const useUI = create<UIState>((set) => ({
  tab: 'studio',
  activeEntryId: null,
  settings: DEFAULT_SETTINGS,
  ready: false,
  memoryMode: 'graph',
  setTab: (tab) => set({ tab }),
  openEntry: (id) => set({ activeEntryId: id, tab: 'studio' }),
  setSettings: (settings) => set({ settings }),
  setReady: (ready) => set({ ready }),
  setMemoryMode: (memoryMode) => set({ memoryMode }),
}));
