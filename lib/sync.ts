// Merging an export from another device into this journal without replacing it.
// Rows are matched by primary key. Where both sides have a row, the one with the
// later updatedAt (or computedAt/createdAt) wins; rows with no timestamp keep the
// local copy. Merging never deletes: a record removed on one device comes back
// from the other until deletions are tracked.
//
// Two kinds of record need more than that:
// - People, themes and other graph links use ids that differ between devices,
//   so they are not copied. Every merged entry is linked into this journal's
//   own graph instead, exactly as if it had been finished here.
// - Core values are matched by name, so two journals that both value "Growth"
//   keep one Growth. New names are added while there is room for five.

import { DERIVED_TABLES, DEVICE_TABLES, TABLE_NAMES, getDB, loadSettings, type TableName } from './db';
import { rebuildMemoryArtifacts } from './memory';
import { extractAndStoreMentions, normaliseLabel, rebuildGraph, syncValueNode } from './pipeline';
import { computeTelemetry } from './psych-engine';
import type { CoreValue, Entry, ValueAlignment } from './types';
import type { RawExport } from './vault';

const MAX_VALUES = 5;
const NEVER_MERGED: readonly TableName[] = ['settings', 'promptTemplates', 'nodes', 'mentions', 'edges', ...DERIVED_TABLES, ...DEVICE_TABLES];
const MERGED_BY_RULE: readonly TableName[] = ['coreValues', 'valueAlignments'];

type Row = Record<string, unknown>;

function stamp(row: Row): string {
  for (const k of ['updatedAt', 'computedAt', 'calibratedAt', 'createdAt', 'at']) {
    const v = row[k];
    if (typeof v === 'string' && v) return v;
  }
  return '';
}

export interface MergeReport {
  added: number;
  replaced: number;
  kept: number;
  /** Merged entries linked into this journal's people, themes and values. */
  linked: number;
  perTable: Partial<Record<TableName, { added: number; replaced: number }>>;
}

export async function mergeExport(raw: RawExport): Promise<MergeReport> {
  const db = getDB();
  const report: MergeReport = { added: 0, replaced: 0, kept: 0, linked: 0, perTable: {} };
  const generic = TABLE_NAMES.filter((n) => !NEVER_MERGED.includes(n) && !MERGED_BY_RULE.includes(n));
  const takenEntries = new Set<string>();
  const newValueLabels: string[] = [];

  await db.transaction('rw', [...generic, ...MERGED_BY_RULE].map((n) => db.table(n)), async () => {
    for (const name of generic) {
      const incoming = raw.tables[name];
      if (!Array.isArray(incoming) || !incoming.length) continue;
      const table = db.table(name);
      const keyPath = table.schema.primKey.keyPath as string;
      const local = new Map<unknown, Row>((await table.toArray()).map((r: Row) => [r[keyPath], r]));
      const write: Row[] = [];
      let added = 0;
      let replaced = 0;
      for (const row of incoming as Row[]) {
        const key = row[keyPath];
        if (key === undefined) continue;
        const mine = local.get(key);
        if (!mine) {
          write.push(row);
          added++;
        } else if (stamp(row) > stamp(mine)) {
          write.push(row);
          replaced++;
        } else {
          report.kept++;
          continue;
        }
        if (name === 'entries') takenEntries.add(String(key));
      }
      if (write.length) await table.bulkPut(write);
      report.added += added;
      report.replaced += replaced;
      if (added || replaced) report.perTable[name] = { added, replaced };
    }

    // Core values by name.
    const localValues = await db.coreValues.orderBy('order').toArray();
    const byLabel = new Map(localValues.map((v) => [normaliseLabel(v.label), v]));
    const byId = new Map(localValues.map((v) => [v.id, v]));
    const valueIdMap = new Map<string, string>();
    let count = localValues.length;
    let addedValues = 0;
    for (const v of ((raw.tables.coreValues ?? []) as CoreValue[]).slice().sort((a, b) => a.order - b.order)) {
      const match = byId.get(v.id) ?? byLabel.get(normaliseLabel(v.label));
      if (match) {
        valueIdMap.set(v.id, match.id);
      } else if (count < MAX_VALUES) {
        const added: CoreValue = { ...v, order: count++ };
        await db.coreValues.add(added);
        byLabel.set(normaliseLabel(added.label), added);
        valueIdMap.set(v.id, added.id);
        newValueLabels.push(added.label);
        addedValues++;
      }
    }
    if (addedValues) {
      report.added += addedValues;
      report.perTable.coreValues = { added: addedValues, replaced: 0 };
    }

    // Value scores travel with the version of the entry that was kept.
    const incomingAlignments = ((raw.tables.valueAlignments ?? []) as ValueAlignment[]).filter((a) => takenEntries.has(a.entryId) && valueIdMap.has(a.valueId));
    if (takenEntries.size) {
      const stale = await db.valueAlignments.where('entryId').anyOf([...takenEntries]).primaryKeys();
      await db.valueAlignments.bulkDelete(stale);
    }
    if (incomingAlignments.length) {
      await db.valueAlignments.bulkPut(incomingAlignments.map((a) => ({ ...a, valueId: valueIdMap.get(a.valueId)! })));
      report.perTable.valueAlignments = { added: incomingAlignments.length, replaced: 0 };
    }
  });

  for (const label of newValueLabels) await syncValueNode(null, label);

  // Link every merged, finished entry into this journal's graph.
  const settings = await loadSettings();
  const merged = (await db.entries.bulkGet([...takenEntries])).filter((e): e is Entry => !!e && e.status === 'complete');
  for (const entry of merged) {
    const telemetry = (await db.telemetry.get(entry.id)) ?? computeTelemetry(entry.blocks, settings.thresholds);
    await extractAndStoreMentions(entry, telemetry, settings);
    report.linked++;
  }

  await rebuildGraph();
  await rebuildMemoryArtifacts();
  return report;
}
