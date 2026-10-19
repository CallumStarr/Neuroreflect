// Live provider checks through the app's own streaming adapters
// (lib/ai-provider.ts), so a pass means the code the app runs works against
// the real service, not just that the key is valid. Opt-in: a provider is
// skipped unless its key or endpoint is configured.
//
//   ANTHROPIC_API_KEY=... OPENAI_API_KEY=... npm run test:providers:live
//   OLLAMA_URL=http://localhost:11434 OLLAMA_MODEL=llama3.1 npm run test:providers:live
//
// Optional: ANTHROPIC_MODEL, OPENAI_MODEL to override the app's defaults.

import { testProvider } from '../lib/ai-provider';
import { DEFAULT_SETTINGS } from '../lib/db';
import type { ProviderId, ProviderSettings } from '../lib/types';

const env = process.env;
const cfg: ProviderSettings = {
  ...DEFAULT_SETTINGS.provider,
  anthropicKey: env.ANTHROPIC_API_KEY ?? '',
  anthropicModel: env.ANTHROPIC_MODEL || DEFAULT_SETTINGS.provider.anthropicModel,
  openaiKey: env.OPENAI_API_KEY ?? '',
  openaiModel: env.OPENAI_MODEL || DEFAULT_SETTINGS.provider.openaiModel,
  ollamaUrl: env.OLLAMA_URL || DEFAULT_SETTINGS.provider.ollamaUrl,
  ollamaModel: env.OLLAMA_MODEL || DEFAULT_SETTINGS.provider.ollamaModel,
};

async function ollamaReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${cfg.ollamaUrl.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  const plan: [ProviderId, string, boolean, string][] = [
    ['anthropic', `Anthropic (${cfg.anthropicModel})`, !!cfg.anthropicKey, 'ANTHROPIC_API_KEY not set'],
    ['openai', `OpenAI (${cfg.openaiModel})`, !!cfg.openaiKey, 'OPENAI_API_KEY not set'],
    ['ollama', `Ollama (${cfg.ollamaModel} at ${cfg.ollamaUrl})`, await ollamaReachable(), `nothing answering at ${cfg.ollamaUrl}`],
  ];
  let failed = 0;
  let ran = 0;
  for (const [id, label, configured, why] of plan) {
    if (!configured) {
      console.log(`  skip ${label}: ${why}`);
      continue;
    }
    ran++;
    const result = await testProvider(id, cfg);
    console.log(`${result.ok ? '  ok  ' : '  FAIL'} ${label}: ${result.detail}`);
    if (!result.ok) failed++;
  }
  console.log(ran ? (failed ? `\n${failed} of ${ran} live checks failed` : `\nAll ${ran} live checks passed`) : '\nNo provider configured, nothing checked');
  process.exit(failed ? 1 : 0);
}

main();
