// Export and import of the whole local database, as raw or encrypted JSON.
// Encryption: PBKDF2-SHA256 (600,000 iterations) derives an AES-GCM 256 key
// from a passphrase. Everything happens on this device via WebCrypto. Files
// record their own iteration count, so older exports still open.
//
// Exports always contain readable records: when the on-device lock is on,
// rows pass through the lock middleware and arrive decrypted. The lock's own
// metadata never leaves the device, and import keeps this device's lock.

import { DERIVED_TABLES, DEVICE_TABLES, TABLE_NAMES, getDB, loadSettings, type TableName } from './db';
import { eraseAll } from './lock';
import { LOCK_ROW_KEY, SCHEDULE_ROW_KEY } from './lock-core';
import { rebuildMemoryArtifacts } from './memory';
import { saveTextFile } from './platform';
import type { AppSettings } from './types';
import { fromB64, toB64 } from './util';

export interface RawExport {
  app: 'neuroreflect';
  format: 'raw';
  version: 1;
  exportedAt: string;
  tables: Partial<Record<TableName, unknown[]>>;
}

export interface EncryptedExport {
  app: 'neuroreflect';
  format: 'encrypted';
  version: 1;
  exportedAt: string;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string };
  ciphertext: string;
}

export const EXPORT_ITERATIONS = 600000;

// Rows about this device, not the journal: the lock and the reminder times.
const isLockRow = (row: unknown) => {
  const key = (row as { key?: unknown } | null)?.key;
  return key === LOCK_ROW_KEY || key === SCHEDULE_ROW_KEY;
};

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function stripKeys(settings: AppSettings): AppSettings {
  return { ...settings, provider: { ...settings.provider, anthropicKey: '', openaiKey: '' } };
}

export async function buildExport(includeApiKeys: boolean): Promise<RawExport> {
  const db = getDB();
  const tables: Partial<Record<TableName, unknown[]>> = {};
  for (const name of TABLE_NAMES) {
    // The search index, moments and threads are rebuilt from entries after import,
    // and which reminders this device has shown stays on this device.
    if (DERIVED_TABLES.includes(name) || DEVICE_TABLES.includes(name)) continue;
    const rows = await db.table(name).toArray();
    tables[name] = name === 'settings' ? rows.filter((r) => !isLockRow(r)) : rows;
  }
  if (!includeApiKeys) {
    const settings = await loadSettings();
    tables.settings = [{ key: 'app', value: stripKeys(settings) }];
  }
  return { app: 'neuroreflect', format: 'raw', version: 1, exportedAt: new Date().toISOString(), tables };
}

export async function encryptExport(raw: RawExport, passphrase: string): Promise<EncryptedExport> {
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const key = await deriveKey(passphrase, salt, EXPORT_ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(raw));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  return {
    app: 'neuroreflect',
    format: 'encrypted',
    version: 1,
    exportedAt: raw.exportedAt,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: EXPORT_ITERATIONS, salt: toB64(salt) },
    cipher: { name: 'AES-GCM', iv: toB64(iv) },
    ciphertext: toB64(ciphertext),
  };
}

export async function decryptExport(enc: EncryptedExport, passphrase: string): Promise<RawExport> {
  const key = await deriveKey(passphrase, fromB64(enc.kdf.salt), enc.kdf.iterations);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(enc.cipher.iv) }, key, fromB64(enc.ciphertext));
    return JSON.parse(new TextDecoder().decode(plain)) as RawExport;
  } catch {
    throw new Error('That passphrase does not unlock this file.');
  }
}

export type ParsedImport = { kind: 'raw'; data: RawExport } | { kind: 'encrypted'; data: EncryptedExport };

export function parseImportFile(text: string): ParsedImport {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  const obj = json as { app?: string; format?: string };
  if (obj.app !== 'neuroreflect') throw new Error('This is not a NeuroReflect export.');
  if (obj.format === 'encrypted') return { kind: 'encrypted', data: json as EncryptedExport };
  if (obj.format === 'raw') return { kind: 'raw', data: json as RawExport };
  throw new Error('Unknown export format.');
}

export async function restoreExport(raw: RawExport): Promise<void> {
  const db = getDB();
  const current = await loadSettings();
  const lockRow = await db.settings.get(LOCK_ROW_KEY);
  await db.transaction('rw', TABLE_NAMES.map((n) => db.table(n)), async () => {
    for (const name of TABLE_NAMES) {
      if (DEVICE_TABLES.includes(name)) continue;
      await db.table(name).clear();
      let rows = raw.tables[name];
      if (!Array.isArray(rows)) continue;
      if (name === 'settings') rows = rows.filter((r) => !isLockRow(r));
      // Exports from before editable prompts mirrored the built-in templates;
      // only rows carrying a user-edited body are overrides.
      if (name === 'promptTemplates') rows = rows.filter((r) => typeof (r as { body?: unknown }).body === 'string');
      if (rows.length) await db.table(name).bulkPut(rows);
    }
    if (lockRow) await db.settings.put(lockRow);
  });
  // Keep API keys already on this device if the file did not carry any.
  const restored = await loadSettings();
  const provider = { ...restored.provider };
  if (!provider.anthropicKey && current.provider.anthropicKey) provider.anthropicKey = current.provider.anthropicKey;
  if (!provider.openaiKey && current.provider.openaiKey) provider.openaiKey = current.provider.openaiKey;
  await db.settings.put({ key: 'app', value: { ...restored, provider, seeded: true } });
  await rebuildMemoryArtifacts();
}

// keepLock: clear the journal but leave the passphrase lock on (used when
// restoring the sample journal). Otherwise the lock is removed too.
export async function wipeAll(options: { keepLock?: boolean; markSeeded?: boolean } = {}): Promise<void> {
  await eraseAll({ keepLock: !!options.keepLock, markSeeded: !!options.markSeeded });
}

/** Saves an export. Resolves to false if the person cancels the save dialog. */
export function downloadJSON(filename: string, data: unknown): Promise<boolean> {
  return saveTextFile(filename, JSON.stringify(data, null, 2));
}
