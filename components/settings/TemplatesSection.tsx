'use client';

import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown } from 'lucide-react';
import { getDB } from '@/lib/db';
import { PROMPT_TEMPLATES, SHARED_RULES } from '@/lib/prompts';
import { resetTemplate, saveTemplateBody } from '@/lib/templates';
import type { PromptOverride, PromptTemplate } from '@/lib/types';
import { Message, Section, primaryButton, quietButton } from './ui';

function TemplateEditor({ template, override }: { template: PromptTemplate; override: PromptOverride | undefined }) {
  const stored = override?.body ?? template.body;
  const [text, setText] = useState(stored);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setText(stored), [stored]);
  const changed = text.trim() !== stored.trim();

  const save = async () => {
    await saveTemplateBody(template.id, text);
    setMessage({ ok: true, text: text.trim() === template.body.trim() || !text.trim() ? 'Saved. This matches the built-in version.' : 'Saved. The next prompt uses your version.' });
  };
  const reset = async () => {
    await resetTemplate(template.id);
    setText(template.body);
    setMessage({ ok: true, text: 'Back to the built-in version.' });
  };

  return (
    <details className="group rounded-xl border border-ink-800 bg-ink-900">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-[14px] text-paper-50">
            {template.title}
            {override && <span className="rounded-full border border-ember-500/50 px-2 py-px text-[11px] text-ember-300">Edited</span>}
          </span>
          <span className="block text-[12.5px] text-paper-500">{template.description}</span>
        </span>
        <ChevronDown size={16} className="shrink-0 text-paper-500 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-ink-800 px-4 py-3">
        <label htmlFor={`tpl-${template.id}`} className="sr-only">
          Instructions for {template.title}
        </label>
        <textarea
          id={`tpl-${template.id}`}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setMessage(null);
          }}
          rows={Math.min(12, Math.max(4, text.split('\n').length + 1))}
          spellCheck
          className="w-full resize-y rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-[12.5px] leading-5 text-paper-100 focus:border-ember-400 focus:outline-none"
        />
        {(template.caution || template.structured) && (
          <p className="mt-1.5 text-[12px] leading-5 text-ember-300">
            {template.caution ?? 'The app reads this reply as JSON. Keep the field names, or finishing an entry falls back to the built-in engine.'}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={save} disabled={!changed} className={`${primaryButton} py-1.5`}>
            Save
          </button>
          {override && (
            <button type="button" onClick={reset} className={`${quietButton} py-1.5`}>
              Reset to built-in
            </button>
          )}
          {changed && (
            <button type="button" onClick={() => setText(stored)} className="px-2 py-1.5 text-[12.5px] text-paper-500 hover:text-paper-100">
              Discard changes
            </button>
          )}
          <Message value={message} />
        </div>
      </div>
    </details>
  );
}

export default function TemplatesSection() {
  const overrides = useLiveQuery(() => getDB().promptTemplates.toArray(), []);
  const byId = new Map((overrides ?? []).map((o) => [o.id, o]));
  return (
    <Section
      title="Prompt templates"
      description="The instructions sent to an AI provider for each co-pilot mode. Edit them to change tone or focus. The built-in engine does not use them."
    >
      <div className="space-y-2">
        <div className="rounded-xl border border-ink-800 px-4 py-3">
          <p className="text-[13px] text-paper-100">Shared rules, always sent first</p>
          <p className="text-[12px] text-paper-500">Not editable, so the safety and style rules hold whatever you change below.</p>
          <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-5 text-paper-300">{SHARED_RULES}</p>
        </div>
        {overrides === undefined
          ? null
          : PROMPT_TEMPLATES.map((t) => <TemplateEditor key={t.id} template={t} override={byId.get(t.id)} />)}
      </div>
    </Section>
  );
}
