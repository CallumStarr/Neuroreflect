// On-device encryption core: the in-memory key, the lock state, and the Dexie
// middleware that seals records on their way into IndexedDB and opens them on
// the way out. Deliberately free of database imports so db.ts can install it.
//
// When the passphrase lock is on, every field that IndexedDB does not need for
// a primary key or an index is moved into one sealed envelope per record:
// XSalsa20-Poly1305 (TweetNaCl secretbox) with a fresh random 24-byte nonce.
// The cipher is synchronous on purpose: IndexedDB transactions close as soon
// as they wait on anything else, so asynchronous WebCrypto cannot run inside
// them. The sealed payload also names its table and primary key, so an
// envelope copied onto another record fails to open.

import Dexie, { type DBCore, type DBCoreCursor, type DBCoreTable, type DBCoreTableSchema, type Middleware } from 'dexie';
import nacl from 'tweetnacl';

export type LockState = 'off' | 'locked' | 'unlocked';

/** Settings row holding the lock metadata. Stored unsealed so it can be read while locked. */
export const LOCK_ROW_KEY = 'lock';

const SEALED = '$sealed';
/** Marks objects that were opened from an envelope (non-enumerable, never stored). */
export const WAS_SEALED = Symbol('neuroreflect.wasSealed');

export class LockedError extends Error {
  constructor() {
    super('The journal is locked.');
    this.name = 'LockedError';
  }
}

export class SealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SealError';
  }
}

interface Envelope {
  v: 1;
  n: Uint8Array;
  b: Uint8Array;
}

let state: LockState = 'off';
let key: Uint8Array | null = null;
// The previous key stays readable while a passphrase change is re-sealing, so
// a cached query result sealed under the old key can still be opened.
let previousKey: Uint8Array | null = null;
// True only while encryption is being turned off: reads still open envelopes,
// writes are stored plain.
let writePlain = false;
// True while encryption is being turned on: writes are sealed although the
// state only becomes 'unlocked' once the transaction has committed.
let sealing = false;
const listeners = new Set<() => void>();

export function getLockState(): LockState {
  return state;
}

export function subscribeLock(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** For lib/lock.ts only. Components use the functions exported there. */
export const lockInternals = {
  setState(next: LockState) {
    if (state === next) return;
    state = next;
    for (const fn of listeners) fn();
  },
  getKey: () => key,
  setKey(next: Uint8Array | null) {
    key = next;
  },
  setPreviousKey(prev: Uint8Array | null) {
    previousKey = prev;
  },
  setWritePlain(v: boolean) {
    writePlain = v;
  },
  setSealing(v: boolean) {
    sealing = v;
  },
};

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();

function asBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  throw new SealError('A sealed record is malformed.');
}

export function isSealed(value: unknown): boolean {
  return !!value && typeof value === 'object' && SEALED in (value as object);
}

function isExempt(table: string, value: unknown): boolean {
  return table === 'settings' && (value as { key?: unknown } | null)?.key === LOCK_ROW_KEY;
}

function plainFieldsOf(schema: DBCoreTableSchema): Set<string> {
  const out = new Set<string>();
  const add = (kp: string | string[] | null) => {
    if (!kp) return;
    for (const p of Array.isArray(kp) ? kp : [kp]) out.add(p.split('.')[0]);
  };
  add(schema.primaryKey.keyPath);
  for (const idx of schema.indexes) add(idx.keyPath);
  return out;
}

function sameKey(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function primaryKeyOf(schema: DBCoreTableSchema, value: unknown): unknown {
  return schema.primaryKey.extractKey ? schema.primaryKey.extractKey(value) : undefined;
}

function tryOpen(env: Envelope, k: Uint8Array | null): Uint8Array | null {
  if (!k) return null;
  return nacl.secretbox.open(asBytes(env.b), asBytes(env.n), k);
}

export function openRecord(table: string, schema: DBCoreTableSchema, value: unknown): unknown {
  if (!isSealed(value)) return value;
  if (!key) throw new LockedError();
  const record = value as Record<string, unknown>;
  const env = record[SEALED] as Envelope;
  const bytes = tryOpen(env, key) ?? tryOpen(env, previousKey);
  if (!bytes) throw new SealError(`A record in ${table} could not be decrypted with this passphrase.`);
  const payload = JSON.parse(fromUtf8.decode(bytes)) as { t: string; k: unknown; f: Record<string, unknown> };
  if (payload.t !== table || !sameKey(payload.k, primaryKeyOf(schema, value))) {
    throw new SealError(`A record in ${table} failed its integrity check.`);
  }
  const out: Record<string, unknown> = { ...payload.f };
  for (const k of Object.keys(record)) if (k !== SEALED) out[k] = record[k];
  Object.defineProperty(out, WAS_SEALED, { value: true, enumerable: false });
  return out;
}

export function sealRecord(table: string, schema: DBCoreTableSchema, plain: Set<string>, value: unknown): unknown {
  if (!value || typeof value !== 'object' || isExempt(table, value)) return value;
  const seal = !writePlain && (sealing || state === 'unlocked');
  if (!seal && (writePlain || state === 'off')) return isSealed(value) ? openRecord(table, schema, value) : value;
  if (!seal || !key) throw new LockedError();
  const source = (isSealed(value) ? openRecord(table, schema, value) : value) as Record<string, unknown>;
  const kept: Record<string, unknown> = {};
  const secret: Record<string, unknown> = {};
  for (const k of Object.keys(source)) {
    if (plain.has(k)) kept[k] = source[k];
    else secret[k] = source[k];
  }
  const payload = utf8.encode(JSON.stringify({ t: table, k: primaryKeyOf(schema, source), f: secret }));
  const n = nacl.randomBytes(nacl.secretbox.nonceLength);
  const envelope: Envelope = { v: 1, n, b: nacl.secretbox(payload, n, key) };
  kept[SEALED] = envelope;
  return kept;
}

function wrapCursor(cursor: DBCoreCursor, open: (v: unknown) => unknown): DBCoreCursor {
  let lastRaw: unknown;
  let lastOpened: unknown;
  // Native cursor getters reject foreign receivers, so key and primaryKey are
  // forwarded explicitly; methods live on the underlying object and resolve
  // through the prototype.
  return Object.create(cursor, {
    key: { get: () => cursor.key },
    primaryKey: { get: () => cursor.primaryKey },
    value: {
      get: () => {
        const raw = cursor.value;
        if (raw !== lastRaw) {
          lastRaw = raw;
          lastOpened = open(raw);
        }
        return lastOpened;
      },
    },
  });
}

export const lockMiddleware: Middleware<DBCore> = {
  stack: 'dbcore',
  name: 'NeuroReflectLock',
  level: 20,
  create(down: DBCore): Partial<DBCore> {
    return {
      ...down,
      table(name: string): DBCoreTable {
        const table = down.table(name);
        const schema = table.schema;
        const plain = plainFieldsOf(schema);
        const open = (v: unknown) => openRecord(name, schema, v);
        return {
          ...table,
          get: (req) => table.get(req).then(open),
          getMany: (req) => table.getMany(req).then((values) => values.map(open)),
          query: (req) => table.query(req).then((res) => (req.values ? { ...res, result: res.result.map(open) } : res)),
          openCursor: (req) => table.openCursor(req).then((cursor) => (cursor && req.values !== false ? wrapCursor(cursor, open) : cursor)),
          mutate: (req) => {
            if (req.type !== 'add' && req.type !== 'put') return table.mutate(req);
            let values: unknown[];
            try {
              values = req.values.map((v) => sealRecord(name, schema, plain, v));
            } catch (err) {
              return Dexie.Promise.reject(err);
            }
            return table.mutate({ ...req, values });
          },
        };
      },
    };
  },
};
