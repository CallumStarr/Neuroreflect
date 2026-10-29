// One-tap feeling checks and "What works for me". The checks are plain words,
// never a score of any condition, and how a technique went is judged over days:
// some feel worse straight after and better later.

import { getDB } from './db';
import type { FeelingCheck, FeelingValue, TechniqueId } from './types';
import { localDayOf, uid } from './util';

export const FEELINGS: { value: FeelingValue; label: string }[] = [
  { value: 1, label: 'Rough' },
  { value: 2, label: 'Not great' },
  { value: 3, label: 'Okay' },
  { value: 4, label: 'Good' },
  { value: 5, label: 'Great' },
];

export async function recordFeeling(args: { entryId: string | null; technique: TechniqueId | null; phase: FeelingCheck['phase']; value: FeelingValue }): Promise<void> {
  const now = new Date();
  await getDB().feelingChecks.add({ id: uid('fc'), entryId: args.entryId, technique: args.technique, phase: args.phase, value: args.value, at: now.toISOString(), localDay: localDayOf(now) });
}

export interface TechniqueEffect {
  technique: TechniqueId;
  /** Sessions with a before and an after check. */
  uses: number;
  /** Mean change straight after, on the 1 to 5 scale. */
  after: number | null;
  /** Mean change by the next check, a day or so later. */
  next: number | null;
  verdict: string;
}

export const MIN_USES_FOR_A_VIEW = 3;

/** Per technique, how the person's own checks moved. Shown only with enough data, with the count. */
export function techniqueEffects(checks: FeelingCheck[]): TechniqueEffect[] {
  const byEntry = new Map<string, FeelingCheck[]>();
  for (const c of checks) {
    if (!c.entryId || !c.technique) continue;
    byEntry.set(c.entryId, [...(byEntry.get(c.entryId) ?? []), c]);
  }
  const per = new Map<TechniqueId, { after: number[]; next: number[] }>();
  for (const list of byEntry.values()) {
    const before = list.find((c) => c.phase === 'before');
    if (!before || !before.technique) continue;
    const after = list.find((c) => c.phase === 'after');
    const next = list.find((c) => c.phase === 'next');
    const row = per.get(before.technique) ?? { after: [], next: [] };
    if (after) row.after.push(after.value - before.value);
    if (next) row.next.push(next.value - before.value);
    per.set(before.technique, row);
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return [...per.entries()].map(([technique, row]) => {
    const after = mean(row.after);
    const next = mean(row.next);
    const uses = row.after.length;
    let verdict: string;
    if (uses < MIN_USES_FOR_A_VIEW) verdict = 'Too early to tell';
    else if (after !== null && after <= -0.4 && next !== null && next >= 0.4) verdict = 'A little harder straight after, better by next time';
    else if (after !== null && after >= 0.4) verdict = 'You tend to feel a little better straight after';
    else if (after !== null && after <= -0.4) verdict = 'You tend to feel a bit worse straight after';
    else verdict = 'No clear change so far';
    return { technique, uses, after, next, verdict };
  });
}
