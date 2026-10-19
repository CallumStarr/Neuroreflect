import type { Block, LocalDay } from './types';

export function uid(prefix = ''): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : Math.random().toString(36).slice(2, 18);
  return prefix ? `${prefix}_${rand}` : rand;
}

export function localDayOf(date: Date = new Date()): LocalDay {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(day: LocalDay, delta: number): LocalDay {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return localDayOf(dt);
}

export function formatDay(day: LocalDay, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', opts);
}

export function blocksToText(blocks: Block[]): string {
  return blocks.map((b) => b.text).join('\n\n');
}

export function textToBlocks(text: string): Block[] {
  const parts = text.split(/\n{2,}|\r\n\r\n/).map((p) => p.replace(/\n/g, ' ').trim());
  const blocks = parts.filter((p) => p.length > 0).map((p) => ({ id: uid('b'), text: p }));
  return blocks.length ? blocks : [{ id: uid('b'), text: '' }];
}

export function countWords(text: string): number {
  const m = text.match(/[A-Za-z0-9À-ɏ'’]+/g);
  return m ? m.length : 0;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function pct(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
