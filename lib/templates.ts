// The person's edits to the built-in prompt templates. Only edited templates
// are stored; everything else falls back to the defaults in prompts.ts.

import { getDB } from './db';
import { composeSystem, getTemplate } from './prompts';

export async function systemPromptFor(templateId: string): Promise<string> {
  const override = await getDB().promptTemplates.get(templateId);
  return composeSystem(override?.body ?? getTemplate(templateId).body);
}

/** Saving the default text (or nothing) removes the override. */
export async function saveTemplateBody(templateId: string, body: string): Promise<void> {
  const db = getDB();
  const trimmed = body.trim();
  if (!trimmed || trimmed === getTemplate(templateId).body.trim()) {
    await db.promptTemplates.delete(templateId);
    return;
  }
  await db.promptTemplates.put({ id: templateId, body: trimmed, updatedAt: new Date().toISOString() });
}

export async function resetTemplate(templateId: string): Promise<void> {
  await getDB().promptTemplates.delete(templateId);
}
