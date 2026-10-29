// Content migrations: changes to stored records that need the journal readable.
// Dexie's own upgrades run when the database opens, which can be while the
// passphrase lock is on and every record is sealed, so anything that reads or
// rewrites record contents runs here instead, once the journal is unlocked.
// Each migration runs once; the ids of those applied are kept in settings.

import { getDB, loadSettings, saveSettings } from './db';
import { AVOIDANCE_LABEL, CIRCLING_LABEL } from './psych-engine';
import { normaliseLabel, rebuildGraph } from './pipeline';

interface Migration {
  id: string;
  run: () => Promise<void>;
}

// v0.2 renamed two pattern nodes to plain words ("Rumination loop" became
// "Circling", "Experiential avoidance" became "Avoidance"). Mentions point at
// node ids, so renaming the node keeps every link. If both old and new nodes
// exist, the old one's mentions move to the new one.
async function renamePatternNodes(): Promise<void> {
  const db = getDB();
  const renames: [string, string][] = [
    ['rumination loop', CIRCLING_LABEL],
    ['experiential avoidance', AVOIDANCE_LABEL],
  ];
  let changed = false;
  await db.transaction('rw', db.nodes, db.mentions, async () => {
    const patterns = await db.nodes.where('kind').equals('pattern').toArray();
    for (const [oldName, label] of renames) {
      const old = patterns.find((n) => n.normalised === oldName);
      if (!old) continue;
      changed = true;
      const existing = patterns.find((n) => n.normalised === normaliseLabel(label));
      if (existing) {
        const moved = await db.mentions.where('nodeId').equals(old.id).toArray();
        await db.mentions.bulkPut(moved.map((m) => ({ ...m, nodeId: existing.id })));
        await db.nodes.delete(old.id);
      } else {
        await db.nodes.put({ ...old, label, normalised: normaliseLabel(label) });
      }
    }
  });
  if (changed) await rebuildGraph();
}

export const MIGRATIONS: Migration[] = [{ id: 'pattern-names-v2', run: renamePatternNodes }];

/** Applies any migration not yet recorded. Call only while the journal is readable. */
export async function runContentMigrations(): Promise<string[]> {
  const settings = await loadSettings();
  const done = new Set(settings.migrations);
  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await m.run();
    applied.push(m.id);
  }
  if (applied.length) await saveSettings({ migrations: [...settings.migrations, ...applied] });
  return applied;
}

/** Marks every migration as applied, for a journal created fresh with current names. */
export async function markAllMigrated(): Promise<void> {
  await saveSettings({ migrations: MIGRATIONS.map((m) => m.id) });
}
