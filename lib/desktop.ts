// What only the desktop app can do: reminders that arrive while the window is
// hidden, the system tray, starting at sign-in and quick capture from anywhere. Every function is a quiet no-op in a browser tab, so callers never
// need to check. The Rust side is src-tauri/src/lib.rs.

import { isDesktop } from './platform';

export interface DesktopReminder {
  id: string;
  at: number;
  title: string;
  body: string;
}

async function invokeSafe<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isDesktop()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(cmd, args);
  } catch (e) {
    console.warn(`[NeuroReflect] desktop command ${cmd} failed:`, e instanceof Error ? e.message : e);
    return null;
  }
}

/** Replaces the reminders the desktop side will show. */
export function setDesktopReminders(items: DesktopReminder[]): Promise<null | void> {
  return invokeSafe<void>('set_reminders', { items });
}

/** Ids of reminders the desktop side showed since the last call. */
export async function takeFiredReminders(): Promise<string[]> {
  return (await invokeSafe<string[]>('take_fired_reminders')) ?? [];
}

export interface DesktopPrefs {
  keepInTray: boolean;
  globalCapture: boolean;
  startAtLogin: boolean;
}

export function setDesktopPrefs(prefs: DesktopPrefs): Promise<null | void> {
  return invokeSafe<void>('set_desktop_prefs', { prefs });
}

/** Closes the app for real (the window's close button may only hide it). */
export function quitApp(): Promise<null | void> {
  return invokeSafe<void>('quit_app');
}

export type DesktopEvent = 'reminder-fired' | 'quick-capture' | 'window-hidden' | 'quit-requested' | 'open-planner';

/** Listens for an event from the desktop side; returns an unlisten function. */
export async function onDesktopEvent<T = unknown>(name: DesktopEvent, handler: (payload: T) => void): Promise<() => void> {
  if (!isDesktop()) return () => {};
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen<T>(name, (e) => handler(e.payload));
  } catch {
    return () => {};
  }
}
