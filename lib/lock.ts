// Passphrase lock: turning on-device encryption on and off, unlocking,
// locking, changing the passphrase, and keeping several open tabs in step.
// The key is derived with PBKDF2-SHA256 through WebCrypto and is only ever
// held in memory. The sealing itself lives in lock-core.ts.

import type { Table } from 'dexie';
import nacl from 'tweetnacl';
import { DEFAULT_SETTINGS, TABLE_NAMES, getDB } from './db';
import { LOCK_ROW_KEY, LockedError, SCHEDULE_ROW_KEY, WAS_SEALED, getLockState, lockInternals, type LockState } from './lock-core';
import { fromB64, sleep, toB64 } from './util';

export { LockedError, SealError, getLockState, subscribeLock, type LockState } from './lock-core';

export interface LockMeta {
  version: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  /** A known phrase sealed with the key, used to recognise the right passphrase. */
  check: { n: string; b: string };
  enabledAt: string;
  /** Minutes without input before the journal locks itself; 0 means never. */
  autoLockMinutes: number;
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('That passphrase does not unlock this journal.');
    this.name = 'WrongPassphraseError';
  }
}

export const LOCK_ITERATIONS = 600000;
export const MIN_PASSPHRASE_LENGTH = 8;
export const AUTO_LOCK_DEFAULT = 15;
export const AUTO_LOCK_CHOICES: { minutes: number; label: string }[] = [
  { minutes: 5, label: '5 minutes' },
  { minutes: 15, label: '15 minutes' },
  { minutes: 30, label: '30 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 0, label: 'Never' },
];

const CHECK_PHRASE = 'neuroreflect-lock-check-v1';
const utf8 = new TextEncoder();

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', utf8.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256);
  return new Uint8Array(bits);
}

function makeCheck(key: Uint8Array): LockMeta['check'] {
  const n = nacl.randomBytes(nacl.secretbox.nonceLength);
  return { n: toB64(n), b: toB64(nacl.secretbox(utf8.encode(CHECK_PHRASE), n, key)) };
}

function passesCheck(key: Uint8Array, check: LockMeta['check']): boolean {
  const out = nacl.secretbox.open(fromB64(check.b), fromB64(check.n), key);
  return !!out && new TextDecoder().decode(out) === CHECK_PHRASE;
}

async function keyFromPassphrase(passphrase: string, meta: LockMeta): Promise<Uint8Array> {
  const key = await deriveKey(passphrase, fromB64(meta.kdf.salt), meta.kdf.iterations);
  if (!passesCheck(key, meta.check)) {
    key.fill(0);
    throw new WrongPassphraseError();
  }
  return key;
}

function allTables(): Table[] {
  const db = getDB();
  return TABLE_NAMES.map((n) => db.table(n));
}

async function readAll(): Promise<[string, unknown[]][]> {
  const db = getDB();
  const out: [string, unknown[]][] = [];
  for (const name of TABLE_NAMES) out.push([name, await db.table(name).toArray()]);
  return out;
}

async function writeAll(snapshot: [string, unknown[]][]): Promise<void> {
  const db = getDB();
  for (const [name, rows] of snapshot) if (rows.length) await db.table(name).bulkPut(rows);
}

// ---------- hooks that must run before the key goes ----------

type BeforeLock = () => Promise<void> | void;
const beforeLockHooks = new Set<BeforeLock>();

/** Lets a view save unsaved work before the journal locks. Returns an unregister function. */
export function registerBeforeLock(fn: BeforeLock): () => void {
  beforeLockHooks.add(fn);
  return () => {
    beforeLockHooks.delete(fn);
  };
}

async function runBeforeLock(): Promise<void> {
  const all = Promise.allSettled([...beforeLockHooks].map((fn) => fn()));
  await Promise.race([all, sleep(4000)]);
}

/** Saves unsaved work without locking, for example before the app quits. */
export function runBeforeLockHooks(): Promise<void> {
  return runBeforeLock();
}

// ---------- tabs ----------
// Only one tab is unlocked at a time, and every tab re-reads the lock state
// when another one turns encryption on or off or changes the passphrase.

const TAB_ID = Math.random().toString(36).slice(2);
let channel: BroadcastChannel | null = null;

function broadcast(type: 'unlocked' | 'changed') {
  channel?.postMessage({ type, from: TAB_ID });
}

function ensureChannel() {
  if (channel || typeof BroadcastChannel === 'undefined') return;
  channel = new BroadcastChannel('neuroreflect-lock');
  channel.onmessage = (ev: MessageEvent<{ type: string; from: string }>) => {
    if (!ev.data || ev.data.from === TAB_ID) return;
    if (ev.data.type === 'unlocked') void lockNow();
    if (ev.data.type === 'changed') void adoptExternalChange();
  };
}

async function adoptExternalChange(): Promise<void> {
  const meta = await readLockMeta();
  const now = getLockState();
  if (meta && now !== 'locked') {
    // Save anything typed here first; the next unlock seals it.
    await runBeforeLock();
    lockInternals.setState('locked');
    await sleep(120);
    lockInternals.setKey(null);
  } else if (!meta && now !== 'off') {
    lockInternals.setState('off');
    lockInternals.setKey(null);
  }
}

// ---------- public API ----------

export async function readLockMeta(): Promise<LockMeta | null> {
  const row = await getDB().settings.get(LOCK_ROW_KEY);
  return (row?.value as LockMeta | undefined) ?? null;
}

/** Reads the lock state stored on this device. Call once after opening the database. */
export async function initLock(): Promise<LockState> {
  ensureChannel();
  const meta = await readLockMeta();
  lockInternals.setKey(null);
  lockInternals.setState(meta ? 'locked' : 'off');
  return getLockState();
}

/** Encrypts every record in place and leaves the journal unlocked. */
export async function enableLock(passphrase: string, autoLockMinutes = AUTO_LOCK_DEFAULT): Promise<void> {
  if (getLockState() !== 'off') throw new Error('Encryption is already on.');
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) throw new Error(`Use at least ${MIN_PASSPHRASE_LENGTH} characters.`);
  await runBeforeLock();
  const salt = new Uint8Array(nacl.randomBytes(16));
  const key = await deriveKey(passphrase, salt, LOCK_ITERATIONS);
  const meta: LockMeta = {
    version: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: LOCK_ITERATIONS, salt: toB64(salt) },
    check: makeCheck(key),
    enabledAt: new Date().toISOString(),
    autoLockMinutes,
  };
  const db = getDB();
  try {
    await db.transaction('rw', allTables(), async () => {
      const snapshot = await readAll();
      lockInternals.setKey(key);
      lockInternals.setSealing(true);
      await writeAll(snapshot);
      await db.settings.put({ key: LOCK_ROW_KEY, value: meta });
    });
  } catch (err) {
    lockInternals.setSealing(false);
    lockInternals.setKey(null);
    key.fill(0);
    throw err;
  }
  // Only now, with every record sealed and committed, does the UI say so.
  lockInternals.setState('unlocked');
  lockInternals.setSealing(false);
  broadcast('changed');
  broadcast('unlocked');
}

/** Returns false for a wrong passphrase. */
export async function unlock(passphrase: string): Promise<boolean> {
  const meta = await readLockMeta();
  if (!meta) {
    lockInternals.setState('off');
    return true;
  }
  let key: Uint8Array;
  try {
    key = await keyFromPassphrase(passphrase, meta);
  } catch (err) {
    if (err instanceof WrongPassphraseError) return false;
    throw err;
  }
  lockInternals.setKey(key);
  lockInternals.setState('unlocked');
  broadcast('unlocked');
  await sealStragglers();
  return true;
}

/** Saves pending work, shows the lock screen, then forgets the key. */
export async function lockNow(): Promise<void> {
  if (getLockState() !== 'unlocked') return;
  await runBeforeLock();
  lockInternals.setState('locked');
  // Let open views unmount before the key goes, so nothing reads mid-render.
  await sleep(120);
  if (getLockState() === 'locked') lockInternals.setKey(null);
}

export async function changePassphrase(current: string, next: string): Promise<void> {
  if (getLockState() !== 'unlocked') throw new LockedError();
  if (next.length < MIN_PASSPHRASE_LENGTH) throw new Error(`Use at least ${MIN_PASSPHRASE_LENGTH} characters.`);
  const meta = await readLockMeta();
  if (!meta) throw new Error('Encryption is not on.');
  const checked = await keyFromPassphrase(current, meta);
  checked.fill(0);
  const oldKey = lockInternals.getKey();
  const salt = new Uint8Array(nacl.randomBytes(16));
  const newKey = await deriveKey(next, salt, LOCK_ITERATIONS);
  const nextMeta: LockMeta = { ...meta, kdf: { ...meta.kdf, iterations: LOCK_ITERATIONS, salt: toB64(salt) }, check: makeCheck(newKey) };
  const db = getDB();
  lockInternals.setPreviousKey(oldKey);
  try {
    await db.transaction('rw', allTables(), async () => {
      const snapshot = await readAll();
      lockInternals.setKey(newKey);
      await writeAll(snapshot);
      await db.settings.put({ key: LOCK_ROW_KEY, value: nextMeta });
    });
  } catch (err) {
    lockInternals.setKey(oldKey);
    lockInternals.setPreviousKey(null);
    newKey.fill(0);
    throw err;
  }
  await sleep(0);
  lockInternals.setPreviousKey(null);
  oldKey?.fill(0);
  broadcast('changed');
}

/** Decrypts every record in place and removes the lock. */
export async function disableLock(current: string): Promise<void> {
  if (getLockState() !== 'unlocked') throw new LockedError();
  const meta = await readLockMeta();
  if (!meta) return;
  const checked = await keyFromPassphrase(current, meta);
  checked.fill(0);
  const db = getDB();
  lockInternals.setWritePlain(true);
  try {
    await db.transaction('rw', allTables(), async () => {
      const snapshot = await readAll();
      await writeAll(snapshot);
      await db.settings.delete(LOCK_ROW_KEY);
    });
    lockInternals.setState('off');
  } finally {
    lockInternals.setWritePlain(false);
  }
  // Keep the key a moment for any query result cached before the change.
  await sleep(120);
  if (getLockState() === 'off') lockInternals.setKey(null);
  broadcast('changed');
}

export async function setAutoLockMinutes(minutes: number): Promise<void> {
  const meta = await readLockMeta();
  if (!meta) return;
  await getDB().settings.put({ key: LOCK_ROW_KEY, value: { ...meta, autoLockMinutes: minutes } });
}

/** No lock, no key. Used after the whole database has been erased. */
export function forgetLock(): void {
  lockInternals.setKey(null);
  lockInternals.setState('off');
  broadcast('changed');
}

/**
 * Empties every table in one transaction. With keepLock (and the journal
 * unlocked) the passphrase lock survives and new rows stay sealed; otherwise
 * the lock is removed too. markSeeded stops the sample journal reappearing.
 * Works from the lock screen, where nothing else may be written.
 */
export async function eraseAll(opts: { keepLock: boolean; markSeeded: boolean }): Promise<void> {
  const db = getDB();
  const lockRow = opts.keepLock && getLockState() === 'unlocked' ? await db.settings.get(LOCK_ROW_KEY) : undefined;
  if (!lockRow) lockInternals.setWritePlain(true);
  try {
    await db.transaction('rw', allTables(), async () => {
      for (const table of allTables()) await table.clear();
      if (lockRow) await db.settings.put(lockRow);
      if (opts.markSeeded) await db.settings.put({ key: 'app', value: { ...DEFAULT_SETTINGS, seeded: true } });
    });
  } finally {
    lockInternals.setWritePlain(false);
  }
  if (!lockRow) forgetLock();
}

/**
 * Seals any record that is still stored plain, for example one written by a
 * second tab in the moment before it noticed encryption had been turned on.
 */
export async function sealStragglers(): Promise<number> {
  if (getLockState() !== 'unlocked') return 0;
  const db = getDB();
  let count = 0;
  await db.transaction('rw', allTables(), async () => {
    for (const [name, rows] of await readAll()) {
      const plain = rows.filter((r) => {
        if ((r as Record<symbol, unknown>)[WAS_SEALED]) return false;
        const key = name === 'settings' ? (r as { key?: string }).key : undefined;
        return key !== LOCK_ROW_KEY && key !== SCHEDULE_ROW_KEY;
      });
      if (plain.length) {
        count += plain.length;
        await db.table(name).bulkPut(plain);
      }
    }
  });
  return count;
}
