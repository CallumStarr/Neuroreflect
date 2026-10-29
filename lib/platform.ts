// The same screens run inside the desktop app and in a browser tab (used for
// development and the browser tests). Everything that has to behave differently
// between the two goes through here.
//
// Call these from effects and event handlers, never while rendering: the static
// HTML is built without a window, so rendering differently on the desktop would
// make React's hydration fail.

/** True inside the desktop app. */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Requests to AI providers. In the desktop app they go through the HTTP plugin,
 * which may only reach the addresses allowed in src-tauri/capabilities and is
 * not bound by browser CORS rules. Responses still stream.
 *
 * The plugin would otherwise label every request with the window's origin
 * (http://tauri.localhost on Windows), which Ollama refuses unless it is added
 * to OLLAMA_ORIGINS. An empty Origin tells the plugin to send none; that needs
 * its unsafe-headers feature, set in src-tauri/Cargo.toml.
 */
export async function providerFetch(url: string, init: RequestInit): Promise<Response> {
  if (!isDesktop()) return fetch(url, init);
  const { fetch: desktopFetch } = await import('@tauri-apps/plugin-http');
  const headers = new Headers(init.headers);
  headers.set('Origin', '');
  try {
    return await desktopFetch(url, { ...init, headers });
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/** The desktop app reaches Ollama on this computer only. */
export function isThisComputer(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

/**
 * Saves text as a file. The desktop app asks where with the system save dialog;
 * a browser downloads it. Resolves to false if the person cancels.
 */
export interface SaveKind {
  /** Shown in the save dialog's file type list. */
  label: string;
  extensions: string[];
  mime: string;
}

export const JSON_FILE: SaveKind = { label: 'NeuroReflect export', extensions: ['json'], mime: 'application/json' };

export async function saveTextFile(filename: string, text: string, kind: SaveKind = JSON_FILE): Promise<boolean> {
  if (isDesktop()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<boolean>('save_text_file', { suggestedName: filename, contents: text, filterName: kind.label, extensions: kind.extensions });
  }
  const blob = new Blob([text], { type: kind.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
