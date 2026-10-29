'use client';

import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDown, ArrowUp, Download, Lock, Plus, Trash2, Upload } from 'lucide-react';
import { testProvider } from '@/lib/ai-provider';
import { DEFAULT_SETTINGS, getDB, loadSettings, saveSettings } from '@/lib/db';
import { rebuildMemoryArtifacts } from '@/lib/memory';
import { rebuildGraph, syncValueNode } from '@/lib/pipeline';
import { seedDatabase } from '@/lib/seed';
import { useUI } from '@/lib/store';
import type { AppSettings, ProviderId } from '@/lib/types';
import { localDayOf, uid } from '@/lib/util';
import { mergeExport } from '@/lib/sync';
import { isDesktop } from '@/lib/platform';
import { EXPORT_ITERATIONS, buildExport, decryptExport, downloadJSON, encryptExport, parseImportFile, restoreExport, wipeAll, type ParsedImport } from '@/lib/vault';
import { useLockState } from '../useLockState';
import FiguresSection from './FiguresSection';
import GuidanceSection from './GuidanceSection';
import LockSection from './LockSection';
import PlannerSection from './PlannerSection';
import TemplatesSection from './TemplatesSection';
import WritingTimeSection from './WritingTimeSection';
import { Section, fieldCls, inputCls } from './ui';

const PROVIDERS: { id: ProviderId; label: string; blurb: string }[] = [
  { id: 'heuristic', label: 'Built-in engine', blurb: 'No AI model. Questions and syntheses come from your own sentences and the writing measures. Fully offline.' },
  { id: 'ollama', label: 'Ollama on this computer', blurb: 'A local model. Nothing leaves your machine.' },
  { id: 'anthropic', label: 'Anthropic (Claude)', blurb: 'Your own API key. Entry text is sent to Anthropic when you ask for a prompt, ask your journal a question in Recall, or finish an entry.' },
  { id: 'openai', label: 'OpenAI', blurb: 'Your own API key. Entry text is sent to OpenAI when you ask for a prompt, ask your journal a question in Recall, or finish an entry.' },
];

export default function Settings() {
  const { settings, setSettings, openEntry, setTab } = useUI();
  const lock = useLockState();
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [test, setTest] = useState<{ running: boolean; result: { ok: boolean; detail: string } | null }>({ running: false, result: null });
  const [desktop, setDesktop] = useState(false);
  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => setDesktop(isDesktop()), []);

  const persist = async (patch: Partial<AppSettings>) => {
    const next = await saveSettings(patch);
    setSettings(next);
    setSavedAt(Date.now());
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[980px] px-4 pb-20 pt-8 sm:px-10">
        <div className="flex items-end justify-between">
          <h1 className="font-serif text-[1.9rem] text-paper-50" style={{ fontVariationSettings: "'opsz' 36" }}>
            Settings and vault
          </h1>
          {savedAt && <p className="text-[12.5px] text-paper-500">Saved</p>}
        </div>
        <p className="mt-2 max-w-[66ch] text-[13.5px] leading-6 text-paper-300">
          Everything in NeuroReflect is stored on this device. Nothing is uploaded unless you choose a cloud AI provider below, and then only when you ask for a prompt, ask a question in Recall, or finish an entry.
        </p>

        <div className="mt-8">
          <Section title="You" description="Used by self-distancing prompts, which can address you in the third person.">
            <label htmlFor="s-name" className="block text-[13px] text-paper-100">
              First name
            </label>
            <input
              id="s-name"
              value={draft.userName}
              onChange={(e) => setDraft({ ...draft, userName: e.target.value })}
              onBlur={() => persist({ userName: draft.userName.trim() })}
              placeholder="Optional"
              className={`${fieldCls} mt-1 max-w-xs`}
            />
          </Section>

          <WritingTimeSection />

          <GuidanceSection />

          <Section title="AI co-pilot" description="Every feature works with the built-in engine. A model adds more natural questions and syntheses.">
            <div className="grid gap-2" role="radiogroup" aria-label="AI provider">
              {PROVIDERS.map((p) => (
                <label
                  key={p.id}
                  className={`flex cursor-pointer gap-3 rounded-xl border px-4 py-3 ${draft.provider.primary === p.id ? 'border-ember-400/70 bg-ember-400/[0.06]' : 'border-ink-700 hover:border-ink-600'}`}
                >
                  <input
                    type="radio"
                    name="provider"
                    checked={draft.provider.primary === p.id}
                    onChange={() => {
                      const next = { ...draft, provider: { ...draft.provider, primary: p.id } };
                      setDraft(next);
                      setTest({ running: false, result: null });
                      void persist({ provider: next.provider });
                    }}
                    className="mt-1 accent-[#e0aa4a]"
                  />
                  <span>
                    <span className="block text-[14px] text-paper-50">{p.label}</span>
                    <span className="block text-[12.5px] leading-5 text-paper-500">{p.blurb}</span>
                  </span>
                </label>
              ))}
            </div>

            {draft.provider.primary === 'ollama' && (
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="s-ourl" className="text-[13px] text-paper-100">
                    Ollama address
                  </label>
                  <input id="s-ourl" className={`${fieldCls} mt-1`} value={draft.provider.ollamaUrl} onChange={(e) => setDraft({ ...draft, provider: { ...draft.provider, ollamaUrl: e.target.value } })} onBlur={() => persist({ provider: draft.provider })} />
                </div>
                <div>
                  <label htmlFor="s-omodel" className="text-[13px] text-paper-100">
                    Model
                  </label>
                  <input id="s-omodel" className={`${fieldCls} mt-1`} value={draft.provider.ollamaModel} onChange={(e) => setDraft({ ...draft, provider: { ...draft.provider, ollamaModel: e.target.value } })} onBlur={() => persist({ provider: draft.provider })} />
                </div>
                <p className="col-span-2 text-[12px] leading-5 text-paper-500">
                  {desktop
                    ? 'NeuroReflect connects to Ollama on this computer only, at a localhost or 127.0.0.1 address.'
                    : 'Ollama accepts requests from localhost pages by default. If you serve NeuroReflect from another address, add it to OLLAMA_ORIGINS.'}
                </p>
              </div>
            )}
            {draft.provider.primary === 'anthropic' && (
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="s-akey" className="text-[13px] text-paper-100">
                    API key
                  </label>
                  <input id="s-akey" type="password" autoComplete="off" className={`${fieldCls} mt-1`} value={draft.provider.anthropicKey} onChange={(e) => setDraft({ ...draft, provider: { ...draft.provider, anthropicKey: e.target.value } })} onBlur={() => persist({ provider: draft.provider })} />
                </div>
                <div>
                  <label htmlFor="s-amodel" className="text-[13px] text-paper-100">
                    Model
                  </label>
                  <input id="s-amodel" className={`${fieldCls} mt-1`} value={draft.provider.anthropicModel} onChange={(e) => setDraft({ ...draft, provider: { ...draft.provider, anthropicModel: e.target.value } })} onBlur={() => persist({ provider: draft.provider })} />
                </div>
              </div>
            )}
            {draft.provider.primary === 'openai' && (
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="s-okey" className="text-[13px] text-paper-100">
                    API key
                  </label>
                  <input id="s-okey" type="password" autoComplete="off" className={`${fieldCls} mt-1`} value={draft.provider.openaiKey} onChange={(e) => setDraft({ ...draft, provider: { ...draft.provider, openaiKey: e.target.value } })} onBlur={() => persist({ provider: draft.provider })} />
                </div>
                <div>
                  <label htmlFor="s-omodel2" className="text-[13px] text-paper-100">
                    Model
                  </label>
                  <input id="s-omodel2" className={`${fieldCls} mt-1`} value={draft.provider.openaiModel} onChange={(e) => setDraft({ ...draft, provider: { ...draft.provider, openaiModel: e.target.value } })} onBlur={() => persist({ provider: draft.provider })} />
                </div>
              </div>
            )}
            {(draft.provider.primary === 'anthropic' || draft.provider.primary === 'openai') && (
              <p className="mt-2 text-[12px] leading-5 text-paper-500">
                {lock === 'off'
                  ? 'Keys are kept on this device, unencrypted unless you turn on the passphrase lock below, and are left out of exports unless you include them.'
                  : 'Keys are kept on this device, encrypted with your passphrase, and are left out of exports unless you include them.'}
              </p>
            )}
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                disabled={test.running}
                onClick={async () => {
                  setTest({ running: true, result: null });
                  await persist({ provider: draft.provider });
                  const result = await testProvider(draft.provider.primary, draft.provider);
                  setTest({ running: false, result });
                }}
                className="rounded-lg border border-ink-700 px-3 py-1.5 text-[13px] text-paper-100 hover:bg-ink-900 disabled:opacity-50"
              >
                {test.running ? 'Testing...' : 'Test connection'}
              </button>
              {test.result && <p className={`text-[12.5px] ${test.result.ok ? 'text-sage-300' : 'text-rose-300'}`}>{test.result.detail}</p>}
            </div>
            <p className="mt-3 text-[12px] leading-5 text-paper-500">If the provider fails or takes longer than 20 seconds to start answering, the built-in engine answers instead and says so.</p>
          </Section>

          <ValuesSection />

          <Section title="Step-back suggestion" description="A guess from word counts, not a validated measure. When all four conditions hold at once, Guided and Deep offer a step-back prompt you can ignore, and any question you ask for steps back rather than digging deeper. It never sends anything anywhere.">
            <Thresholds draft={draft} setDraft={setDraft} persist={persist} />
          </Section>

          <PlannerSection />

          <FiguresSection />

          <LockSection />

          <VaultSection
            lockOn={lock !== 'off'}
            onRestored={async () => {
              await rebuildGraph();
              await rebuildMemoryArtifacts();
              setSettings(await loadSettings());
              openEntry(null);
              setTab('studio');
            }}
          />

          <TemplatesSection />
        </div>
      </div>
    </div>
  );
}

function Thresholds({ draft, setDraft, persist }: { draft: AppSettings; setDraft: (s: AppSettings) => void; persist: (p: Partial<AppSettings>) => Promise<void> }) {
  const t = draft.thresholds;
  const rows: { key: keyof AppSettings['thresholds']; label: string; min: number; max: number; step: number; fmt: (v: number) => string }[] = [
    { key: 'minWords', label: 'Entry longer than', min: 50, max: 300, step: 10, fmt: (v) => `${v} words` },
    { key: 'iTalk', label: 'Self-focus above', min: 0.05, max: 0.2, step: 0.005, fmt: (v) => `${(v * 100).toFixed(1)}%` },
    { key: 'negAffect', label: 'Negative feeling above', min: 0.01, max: 0.1, step: 0.005, fmt: (v) => `${(v * 100).toFixed(1)}%` },
    { key: 'cogProcMax', label: 'Sense-making below', min: 0.005, max: 0.06, step: 0.005, fmt: (v) => `${(v * 100).toFixed(1)}%` },
  ];
  return (
    <div className="space-y-5">
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[minmax(0,1fr)_76px] items-center gap-x-4 gap-y-1.5 sm:grid-cols-[180px_1fr_90px] sm:gap-y-4">
          <label htmlFor={`th-${r.key}`} className="col-span-2 text-[13px] text-paper-100 sm:col-span-1">
            {r.label}
          </label>
          <input
            id={`th-${r.key}`}
            type="range"
            min={r.min}
            max={r.max}
            step={r.step}
            value={t[r.key]}
            onChange={(e) => setDraft({ ...draft, thresholds: { ...t, [r.key]: Number(e.target.value) } })}
            onPointerUp={() => persist({ thresholds: draft.thresholds })}
            onKeyUp={() => persist({ thresholds: draft.thresholds })}
            className="nr-range"
          />
          <span className="nr-num text-right text-[13px] text-paper-50">{r.fmt(t[r.key])}</span>
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          setDraft({ ...draft, thresholds: DEFAULT_SETTINGS.thresholds });
          void persist({ thresholds: DEFAULT_SETTINGS.thresholds });
        }}
        className="text-[12.5px] text-paper-500 underline decoration-ink-600 underline-offset-2 hover:text-paper-100"
      >
        Reset to defaults
      </button>
      <p className="text-[12px] leading-5 text-paper-500">Defaults were calibrated on the sample entries: only the circling one trips the breaker. Expect to tune them to your own writing.</p>
    </div>
  );
}

function ValuesSection() {
  const values = useLiveQuery(() => getDB().coreValues.orderBy('order').toArray(), []) ?? [];
  const [label, setLabel] = useState('');
  const [desc, setDesc] = useState('');
  const db = getDB();

  const add = async () => {
    if (!label.trim() || values.length >= 5) return;
    const v = { id: uid('v'), label: label.trim(), description: desc.trim(), order: values.length };
    await db.coreValues.add(v);
    await syncValueNode(null, v.label);
    setLabel('');
    setDesc('');
  };
  const rename = async (id: string, previous: string, next: string) => {
    const trimmed = next.trim();
    if (!trimmed || trimmed === previous) return;
    await db.coreValues.update(id, { label: trimmed });
    await syncValueNode(previous, trimmed);
  };
  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= values.length) return;
    await db.transaction('rw', db.coreValues, async () => {
      await db.coreValues.update(values[i].id, { order: j });
      await db.coreValues.update(values[j].id, { order: i });
    });
  };
  const remove = async (id: string) => {
    await db.coreValues.delete(id);
    await db.valueAlignments.where('valueId').equals(id).delete();
    const rest = await db.coreValues.orderBy('order').toArray();
    await Promise.all(rest.map((v, i) => db.coreValues.update(v.id, { order: i })));
    await rebuildGraph();
  };

  return (
    <Section title="Core values" description="Three to five. Each finished entry is scored on whether the day moved toward or away from them.">
      <ul className="space-y-2">
        {values.map((v, i) => (
          <li key={v.id} className="flex items-center gap-3 rounded-xl border border-ink-800 bg-ink-900 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <input
                aria-label="Value name"
                defaultValue={v.label}
                onBlur={(e) => void rename(v.id, v.label, e.target.value)}
                className="w-full bg-transparent text-[14px] text-paper-50 focus:outline-none"
              />
              <input
                aria-label="What it means to you"
                defaultValue={v.description}
                placeholder="What it means to you"
                onBlur={(e) => db.coreValues.update(v.id, { description: e.target.value.trim() })}
                className="w-full bg-transparent text-[12.5px] text-paper-500 placeholder:text-ink-600 focus:outline-none"
              />
            </div>
            <button type="button" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 text-paper-500 hover:text-paper-100 disabled:opacity-30">
              <ArrowUp size={14} />
            </button>
            <button type="button" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === values.length - 1} className="rounded p-1 text-paper-500 hover:text-paper-100 disabled:opacity-30">
              <ArrowDown size={14} />
            </button>
            <button type="button" aria-label={`Remove ${v.label}`} onClick={() => remove(v.id)} className="rounded p-1 text-paper-500 hover:text-rose-300">
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
      {values.length < 5 ? (
        <div className="mt-3 grid grid-cols-[1fr_1.4fr_auto] gap-2">
          <input aria-label="New value" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Value, e.g. Courage" className={fieldCls} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <input aria-label="New value meaning" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What it means to you" className={fieldCls} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button type="button" onClick={add} disabled={!label.trim()} className="inline-flex items-center gap-1 rounded-lg border border-ink-700 px-3 text-[13px] text-paper-100 hover:bg-ink-900 disabled:opacity-40">
            <Plus size={14} /> Add
          </button>
        </div>
      ) : (
        <p className="mt-3 text-[12.5px] text-paper-500">Five is the limit. Fewer values make the scoring sharper.</p>
      )}
      {values.length < 3 && <p className="mt-2 text-[12.5px] text-ember-300">Add at least three for a useful alignment picture.</p>}
    </Section>
  );
}

function VaultSection({ onRestored, lockOn }: { onRestored: () => Promise<void>; lockOn: boolean }) {
  const [passphrase, setPassphrase] = useState('');
  const [includeKeys, setIncludeKeys] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState<ParsedImport | null>(null);
  const [importPass, setImportPass] = useState('');
  const [confirm, setConfirm] = useState<'reset' | 'wipe' | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const stamp = () => localDayOf();

  // The desktop app asks where to save; cancelling leaves no message.
  const saveExport = async (filename: string, data: unknown, done: string) => {
    try {
      const saved = await downloadJSON(filename, data);
      setMessage(saved ? { ok: true, text: done } : null);
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };
  const exportRaw = async () => {
    setBusy('raw');
    const data = await buildExport(includeKeys);
    await saveExport(`neuroreflect-${stamp()}.json`, data, 'Exported as readable JSON. Anyone with the file can read your journal.');
    setBusy(null);
  };
  const exportEncrypted = async () => {
    if (passphrase.length < 8) {
      setMessage({ ok: false, text: 'Use a passphrase of at least 8 characters.' });
      return;
    }
    setBusy('enc');
    const enc = await encryptExport(await buildExport(includeKeys), passphrase);
    await saveExport(`neuroreflect-${stamp()}-encrypted.json`, enc, 'Exported encrypted. Without the passphrase the file cannot be opened, including by you.');
    setBusy(null);
  };
  const onFile = async (file: File) => {
    try {
      const parsed = parseImportFile(await file.text());
      setPending(parsed);
      setMessage(null);
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };
  const doImport = async (mode: 'replace' | 'merge' = 'replace') => {
    if (!pending) return;
    setBusy('import');
    try {
      const raw = pending.kind === 'encrypted' ? await decryptExport(pending.data, importPass) : pending.data;
      let text = 'Import complete. Your journal has been replaced with the file contents.';
      if (mode === 'merge') {
        const r = await mergeExport(raw);
        text = `Merge complete: ${r.added} added, ${r.replaced} updated, ${r.kept} already up to date.`;
      } else {
        await restoreExport(raw);
      }
      setPending(null);
      setImportPass('');
      setMessage({ ok: true, text });
      await onRestored();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  const runConfirmed = async () => {
    setBusy(confirm);
    try {
      if (confirm === 'reset') {
        await wipeAll({ keepLock: true });
        await seedDatabase();
      } else {
        await wipeAll({ keepLock: false, markSeeded: true });
      }
      setMessage({ ok: true, text: confirm === 'reset' ? 'Sample journal restored.' : 'Everything was erased from this device.' });
      setConfirm(null);
      setConfirmText('');
      await onRestored();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section title="Local data vault" description="Back up, move or erase your journal. Exports include every entry, metric, forecast and graph link.">
      <div className="space-y-6">
        <div>
          <p className="text-[13px] text-paper-100">Export</p>
          <label className="mt-2 inline-flex items-center gap-2 text-[12.5px] text-paper-300">
            <input type="checkbox" checked={includeKeys} onChange={(e) => setIncludeKeys(e.target.checked)} className="accent-[#e0aa4a]" /> Include API keys
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={exportRaw} disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-2 text-[13px] text-paper-100 hover:bg-ink-900 disabled:opacity-50">
              <Download size={14} /> Readable JSON
            </button>
            <span className="text-paper-500">or</span>
            <input type="password" aria-label="Export passphrase" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder="Passphrase" className={`${inputCls} w-48`} />
            <button type="button" onClick={exportEncrypted} disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-lg bg-ember-400 px-3 py-2 text-[13px] font-medium text-ink-950 hover:bg-ember-300 disabled:opacity-50">
              <Lock size={14} /> {busy === 'enc' ? 'Encrypting...' : 'Encrypted export'}
            </button>
          </div>
          <p className="mt-2 text-[12px] leading-5 text-paper-500">
            Encryption uses AES-256-GCM with a key derived from your passphrase (PBKDF2, {EXPORT_ITERATIONS.toLocaleString('en-GB')} rounds), entirely on this device.
            {lockOn ? ' Exports contain your decrypted journal, so a readable export can be read by anyone with the file.' : ''}
          </p>
        </div>

        <div>
          <p className="text-[13px] text-paper-100">Import</p>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} data-testid="vault-import-input" />
          <button type="button" onClick={() => fileRef.current?.click()} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-2 text-[13px] text-paper-100 hover:bg-ink-900">
            <Upload size={14} /> Choose a NeuroReflect export
          </button>
          {pending && (
            <div className="mt-3 rounded-xl border border-ember-500/40 bg-ember-500/[0.07] p-4">
              <p className="text-[13px] text-paper-100">
                {pending.kind === 'encrypted' ? 'Encrypted export' : 'Readable export'} from {new Date(pending.data.exportedAt).toLocaleString('en-GB')}. Importing replaces everything currently in this journal.
              </p>
              <div className="mt-3 flex items-center gap-2">
                {pending.kind === 'encrypted' && <input type="password" aria-label="Import passphrase" value={importPass} onChange={(e) => setImportPass(e.target.value)} placeholder="Passphrase" className={`${inputCls} w-52`} />}
                <button type="button" onClick={() => doImport('replace')} disabled={busy !== null} className="rounded-lg bg-ember-400 px-3 py-2 text-[13px] font-medium text-ink-950 hover:bg-ember-300 disabled:opacity-50">
                  {busy === 'import' ? 'Importing...' : 'Replace my journal'}
                </button>
                <button type="button" onClick={() => doImport('merge')} disabled={busy !== null} className="rounded-lg border border-ink-700 px-3 py-2 text-[13px] text-paper-100 hover:bg-ink-800 disabled:opacity-50">
                  Merge into my journal
                </button>
                <button type="button" onClick={() => setPending(null)} className="rounded-lg px-3 py-2 text-[13px] text-paper-300 hover:bg-ink-800">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div>
          <p className="text-[13px] text-paper-100">Start over</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setConfirm('reset')} className="rounded-lg border border-ink-700 px-3 py-2 text-[13px] text-paper-100 hover:bg-ink-900">
              Restore sample journal
            </button>
            <button type="button" onClick={() => setConfirm('wipe')} className="rounded-lg border border-rose-400/50 px-3 py-2 text-[13px] text-rose-300 hover:bg-rose-400/10">
              Erase everything
            </button>
          </div>
          {confirm && (
            <div className="mt-3 rounded-xl border border-rose-400/40 bg-rose-400/[0.07] p-4">
              <p className="text-[13px] text-paper-100">
                {confirm === 'reset'
                  ? `This replaces your journal with the four sample entries${lockOn ? ', still encrypted with your passphrase' : ''}.`
                  : `This permanently deletes every entry, metric and setting on this device${lockOn ? ', and turns off the passphrase lock' : ''}.`}{' '}
                It cannot be undone. Type <span className="font-medium">erase</span> to confirm.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <input aria-label="Type erase to confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className={`${inputCls} w-40`} />
                <button type="button" disabled={confirmText.trim().toLowerCase() !== 'erase' || busy !== null} onClick={runConfirmed} className="rounded-lg bg-rose-400 px-3 py-2 text-[13px] font-medium text-ink-950 hover:bg-rose-300 disabled:opacity-40">
                  {confirm === 'reset' ? 'Replace with samples' : 'Erase everything'}
                </button>
                <button type="button" onClick={() => setConfirm(null)} className="rounded-lg px-3 py-2 text-[13px] text-paper-300 hover:bg-ink-800">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
        {message && <p className={`text-[12.5px] ${message.ok ? 'text-sage-300' : 'text-rose-300'}`}>{message.text}</p>}
      </div>
    </Section>
  );
}
