// Storage checks run with `npm test`: the passphrase lock, exports and graph
// maintenance against a real Dexie database on fake-indexeddb. No browser needed.
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import Dexie from 'dexie';
import { DB_NAME, DERIVED_TABLES, SCHEMA, SCHEMA_V1, TABLE_NAMES, getDB, loadSettings, saveSettings } from '../lib/db';
import {
  LockedError,
  SealError,
  WrongPassphraseError,
  changePassphrase,
  disableLock,
  enableLock,
  eraseAll,
  getLockState,
  initLock,
  lockNow,
  readLockMeta,
  sealStragglers,
  unlock,
} from '../lib/lock';
import { rebuildGraph, syncValueNode } from '../lib/pipeline';
import { seedDatabase } from '../lib/seed';
import { mergeExport } from '../lib/sync';
import { buildExport, restoreExport } from '../lib/vault';

const PASS = 'correct horse battery staple';
const PASS2 = 'a different, longer passphrase';
const SECRETS = ['Review meeting', 'Priya', 'useless', 'Dentist appointment', 'Growth', 'Showing up for Sam', 'sk-ant-test-secret', 'Callum'];

let failures = 0;
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${(e as Error).stack?.split('\n').slice(0, 3).join('\n       ')}`);
  }
}

// A second connection without the lock middleware sees exactly what is stored.
const raw = new Dexie(DB_NAME);
raw.version(2).stores(SCHEMA);

function storedText(rows: unknown[]): string {
  return JSON.stringify(rows, (_k, v) => (v instanceof Uint8Array ? `<${v.length} bytes>` : v));
}

async function dumpAll(): Promise<Record<string, unknown[]>> {
  const db = getDB();
  const out: Record<string, unknown[]> = {};
  for (const name of TABLE_NAMES) {
    const rows = (await db.table(name).toArray()) as Record<string, unknown>[];
    out[name] = rows.filter((r) => !(name === 'settings' && r.key === 'lock')).map((r) => ({ ...r }));
  }
  return out;
}

function withoutDerived(dump: Record<string, unknown[]>): Record<string, unknown[]> {
  return Object.fromEntries(Object.entries(dump).filter(([name]) => !(DERIVED_TABLES as readonly string[]).includes(name)));
}

async function storedRows(): Promise<[string, Record<string, unknown>[]][]> {
  const out: [string, Record<string, unknown>[]][] = [];
  for (const name of TABLE_NAMES) out.push([name, (await raw.table(name).toArray()) as Record<string, unknown>[]]);
  return out;
}

async function main() {
  console.log('Storage checks:');

  // A journal created by the first release (schema v1) upgrades in place.
  const v1 = new Dexie(DB_NAME);
  v1.version(1).stores(SCHEMA_V1);
  await v1.open();
  await v1.table('nodes').put({ id: 'n_old', kind: 'person', label: 'Morwenna', normalised: 'morwenna', firstSeen: '2026-01-01', lastSeen: '2026-01-01', mentionCount: 1 });
  await v1.table('promptTemplates').put({ id: 'socratic', title: 'Socratic inquiry', description: '', system: 'mirrored default' });
  v1.close();

  await getDB().open();
  await check('a version 1 journal upgrades: nodes kept, name index gone, mirrored prompts cleared, memory tables added', async () => {
    const db = getDB();
    assert.equal(db.verno, 3);
    assert.equal((await db.nodes.get('n_old'))?.label, 'Morwenna');
    assert.ok(!db.nodes.schema.indexes.some((i) => String(i.keyPath).includes('normalised')));
    assert.equal(await db.promptTemplates.count(), 0);
    await db.nodes.clear();
  });

  await raw.open();
  await initLock();
  await seedDatabase();
  await saveSettings({ userName: 'Callum', provider: { ...(await loadSettings()).provider, anthropicKey: 'sk-ant-test-secret' } });

  let before: Record<string, unknown[]> = {};

  await check('the lock starts off and records are stored readable', async () => {
    assert.equal(getLockState(), 'off');
    const text = storedText((await storedRows()).flatMap(([, rows]) => rows));
    assert.ok(text.includes('Review meeting'));
    before = await dumpAll();
    assert.equal(before.entries.length, 4);
  });

  await check('turning encryption on leaves every record identical when read back', async () => {
    await enableLock(PASS);
    assert.equal(getLockState(), 'unlocked');
    assert.deepStrictEqual(await dumpAll(), before);
  });

  await check('nothing personal is readable in storage once encrypted', async () => {
    const rows = await storedRows();
    const text = storedText(rows.flatMap(([, r]) => r));
    for (const s of SECRETS) assert.ok(!text.includes(s), `found "${s}" in storage`);
    for (const [name, list] of rows) {
      for (const r of list) {
        if (name === 'settings' && r.key === 'lock') continue;
        assert.ok('$sealed' in r, `${name} row stored without an envelope`);
      }
    }
    const entry = rows.find(([n]) => n === 'entries')![1][0];
    assert.deepEqual(Object.keys(entry).sort(), ['$sealed', 'id', 'localDay', 'status', 'updatedAt']);
    const meta = await readLockMeta();
    assert.equal(meta?.kdf.iterations, 600000);
  });

  await check('locking refuses reads and writes; a wrong passphrase is refused', async () => {
    await lockNow();
    assert.equal(getLockState(), 'locked');
    await assert.rejects(getDB().entries.toArray(), LockedError);
    await assert.rejects(getDB().coreValues.put({ id: 'v_x', label: 'Courage', description: '', order: 9 }), LockedError);
    assert.equal(await unlock('not the passphrase'), false);
    assert.equal(getLockState(), 'locked');
    assert.equal(await unlock(PASS), true);
    assert.deepStrictEqual(await dumpAll(), before);
  });

  await check('update() and modify() keep records sealed and complete', async () => {
    const db = getDB();
    const first = (await db.entries.toArray())[0];
    await db.entries.update(first.id, { title: 'Edited title' });
    await db.entries.where('localDay').equals(first.localDay).modify((e) => {
      e.activeSeconds = 4321;
    });
    const back = await db.entries.get(first.id);
    assert.equal(back?.title, 'Edited title');
    assert.equal(back?.activeSeconds, 4321);
    assert.deepEqual(back?.blocks, first.blocks);
    const stored = await raw.table('entries').get(first.id);
    assert.ok(!storedText([stored]).includes('Edited title'));
    await db.entries.put(first);
  });

  await check('a record stored plain behind the lock is sealed at the next unlock', async () => {
    await raw.table('entries').put({ id: 'e_stray', localDay: '2026-01-02', status: 'draft', updatedAt: '2026-01-02T10:00:00.000Z', title: 'Stray plain text', blocks: [], wordCount: 0, activeSeconds: 0, inputSources: ['typed'], createdAt: '2026-01-02T10:00:00.000Z' });
    assert.equal((await getDB().entries.get('e_stray'))?.title, 'Stray plain text');
    await lockNow();
    assert.equal(await unlock(PASS), true);
    const stored = await raw.table('entries').get('e_stray');
    assert.ok('$sealed' in stored && !storedText([stored]).includes('Stray plain text'));
    assert.equal(await sealStragglers(), 0, 'already-sealed records were counted as plain');
    await getDB().entries.delete('e_stray');
  });

  await check('an envelope copied onto another record fails its integrity check', async () => {
    const [a, b] = (await raw.table('entries').toArray()) as Record<string, unknown>[];
    await raw.table('entries').put({ ...b, $sealed: a.$sealed });
    await assert.rejects(getDB().entries.get(b.id as string), SealError);
    await raw.table('entries').put(b);
    assert.ok(await getDB().entries.get(b.id as string));
  });

  await check('changing the passphrase re-seals everything under the new one', async () => {
    await assert.rejects(changePassphrase('wrong passphrase', PASS2), WrongPassphraseError);
    await changePassphrase(PASS, PASS2);
    await lockNow();
    assert.equal(await unlock(PASS), false);
    assert.equal(await unlock(PASS2), true);
    assert.deepStrictEqual(await dumpAll(), before);
  });

  await check('exports are readable and never carry the lock; import keeps it', async () => {
    const exp = await buildExport(true);
    assert.ok(!(exp.tables.settings as { key: string }[]).some((r) => r.key === 'lock'));
    assert.ok(storedText(exp.tables.entries ?? []).includes('Review meeting'));
    await restoreExport(exp);
    assert.ok(await readLockMeta(), 'import removed the lock');
    const text = storedText((await storedRows()).flatMap(([, r]) => r));
    assert.ok(!text.includes('Review meeting'), 'imported rows were stored readable');
    const after = await dumpAll();
    assert.deepStrictEqual(withoutDerived(after), withoutDerived(before));
    for (const name of DERIVED_TABLES) assert.ok(after[name].length > 0, `${name} was not rebuilt after import`);
  });

  await check('exports leave out the search index, moments and threads, which are rebuilt', async () => {
    const exp = await buildExport(false);
    for (const name of DERIVED_TABLES) assert.equal(exp.tables[name], undefined, `${name} was exported`);
    assert.ok((exp.tables.entries ?? []).length > 0);
  });

  await check('the sample-journal reset keeps the lock and re-seals', async () => {
    await eraseAll({ keepLock: true, markSeeded: false });
    assert.equal(getLockState(), 'unlocked');
    await seedDatabase();
    assert.ok(await readLockMeta());
    const text = storedText((await storedRows()).flatMap(([, r]) => r));
    assert.ok(!text.includes('Review meeting'));
    assert.equal((await getDB().entries.count()), 4);
  });

  await check('turning encryption off restores readable records', async () => {
    await assert.rejects(disableLock('wrong passphrase'), WrongPassphraseError);
    const snapshot = await dumpAll();
    await disableLock(PASS2);
    assert.equal(getLockState(), 'off');
    assert.equal(await readLockMeta(), null);
    const rows = await storedRows();
    assert.ok(rows.every(([, list]) => list.every((r) => !('$sealed' in r))));
    assert.ok(storedText(rows.flatMap(([, r]) => r)).includes('Review meeting'));
    assert.deepStrictEqual(await dumpAll(), snapshot);
  });

  await check('erasing from the lock screen removes everything, the lock included', async () => {
    await enableLock(PASS);
    await lockNow();
    await eraseAll({ keepLock: false, markSeeded: true });
    assert.equal(getLockState(), 'off');
    assert.equal(await readLockMeta(), null);
    assert.equal(await getDB().entries.count(), 0);
    assert.equal((await loadSettings()).seeded, true);
    const app = await raw.table('settings').get('app');
    assert.ok(app && !('$sealed' in app));
  });

  await check('value nodes follow renamed values; unmentioned old values leave the graph', async () => {
    const db = getDB();
    await seedDatabase();
    const health = (await db.coreValues.toArray()).find((v) => v.label === 'Health')!;
    await db.coreValues.update(health.id, { label: 'Wellbeing' });
    await syncValueNode('Health', 'Wellbeing');
    let values = await db.nodes.where('kind').equals('value').toArray();
    assert.ok(values.some((n) => n.label === 'Wellbeing') && !values.some((n) => n.label === 'Health'));
    await db.coreValues.add({ id: 'v_c', label: 'Courage', description: '', order: 4 });
    await syncValueNode(null, 'Courage');
    await rebuildGraph();
    values = await db.nodes.where('kind').equals('value').toArray();
    assert.ok(values.some((n) => n.label === 'Courage' && n.mentionCount === 0), 'unmentioned current value was dropped');
    await db.coreValues.delete('v_c');
    await rebuildGraph();
    values = await db.nodes.where('kind').equals('value').toArray();
    assert.ok(!values.some((n) => n.label === 'Courage'), 'removed value stayed in the graph');
  });

  await check('merging another journal links its entries and keeps one of each value', async () => {
    const db = getDB();
    const other = await buildExport(false);
    const otherIds = new Set((other.tables.entries as { id: string }[]).map((e) => e.id));
    await eraseAll({ keepLock: false, markSeeded: true });
    await seedDatabase();
    const report = await mergeExport(other);
    const labels = (await db.coreValues.toArray()).map((v) => v.label);
    assert.equal(new Set(labels.map((l) => l.toLowerCase())).size, labels.length, `duplicate values: ${labels.join(', ')}`);
    assert.ok(labels.length <= 5 && labels.includes('Wellbeing'), labels.join(', '));
    assert.equal(await db.entries.count(), 8);
    assert.equal(report.linked, otherIds.size);
    const linked = (await db.mentions.toArray()).filter((m) => otherIds.has(m.entryId));
    assert.ok(linked.length > 0, 'merged entries have no people, themes or values');
    const people = (await db.nodes.where('kind').equals('person').toArray()).map((n) => n.normalised);
    assert.equal(new Set(people).size, people.length, 'a person appears twice in the graph');
    const valueIds = new Set((await db.coreValues.toArray()).map((v) => v.id));
    assert.ok((await db.valueAlignments.toArray()).every((a) => valueIds.has(a.valueId)), 'a value score points at a value that does not exist');
  });

  console.log(failures ? `\n${failures} storage check(s) failed` : '\nAll storage checks passed');
  raw.close();
  getDB().close();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
