// Browser checks for the AI provider adapters, against mocked endpoints that
// speak each API's documented streaming format: Anthropic and OpenAI through
// intercepted requests, Ollama through a local server that streams NDJSON.
// No real keys or network are involved. Usage:
//   npm run dev   (in another terminal)
//   node tests/providers.e2e.mjs [baseUrl] [screenshotDir]
import http from 'node:http';
import path from 'node:path';
import { startSuite, waitForJournal } from './e2e-helpers.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const SHOTS = process.argv[3] ?? path.resolve('tests/screenshots');
const OLLAMA_PORT = 11535;

const SOCRATIC_REPLY = 'What would asking for more time protect for you? And what might it cost?';
const SYNTHESIS = {
  keyTakeaway: 'Asking early protects both the work and the relationship.',
  hiddenAssumption: 'You may be assuming that needing more time means you are not coping.',
  microAction: 'Send Priya two lines tomorrow proposing a realistic date.',
};

// ---------- mocked wire formats ----------

function anthropicSSE(text) {
  const events = [
    ['message_start', { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', content: [], model: 'claude-sonnet-5-5', stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['ping', { type: 'ping' }],
    ...text.match(/\S+\s*/g).map((piece) => ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } }]),
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 15 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
}

function openaiSSE(text) {
  const chunk = (delta, finish = null) => `data: ${JSON.stringify({ id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'gpt-6-luna', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  return [chunk({ role: 'assistant', content: '' }), ...text.match(/.{1,3}/g).map((p) => chunk({ content: p })), chunk({}, 'stop'), 'data: [DONE]\n\n'].join('');
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };

function replyFor(body) {
  const system = body.messages?.find((m) => m.role === 'system')?.content ?? body.system ?? '';
  if (system.includes('single word: ready')) return 'ready';
  if (system.includes('"keyTakeaway"')) return JSON.stringify(SYNTHESIS);
  if (system.includes('"value"')) return JSON.stringify([{ value: 'Growth', score: 1, evidence: 'Asking for a realistic timeline' }]);
  return SOCRATIC_REPLY;
}

// ---------- local Ollama stand-in ----------

const ollamaRequests = [];
const ollama = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  if (req.method !== 'POST' || req.url !== '/api/chat') {
    res.writeHead(404, CORS);
    res.end();
    return;
  }
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw);
    ollamaRequests.push(body);
    res.writeHead(200, { ...CORS, 'content-type': 'application/x-ndjson' });
    const pieces = replyFor(body).match(/.{1,6}/gs);
    let i = 0;
    const tick = () => {
      if (i < pieces.length) {
        res.write(`${JSON.stringify({ model: body.model, created_at: new Date().toISOString(), message: { role: 'assistant', content: pieces[i++] }, done: false })}\n`);
        setTimeout(tick, 25);
      } else {
        res.end(`${JSON.stringify({ model: body.model, created_at: new Date().toISOString(), message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' })}\n`);
      }
    };
    tick();
  });
});
await new Promise((resolve) => ollama.listen(OLLAMA_PORT, '127.0.0.1', resolve));

// ---------- browser ----------

const { page, check, shot, finish } = await startSuite({ base: BASE, shots: SHOTS });
const anthropicRequests = [];
const openaiRequests = [];
let anthropicMode = 'ok';

await page.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  const body = req.postDataJSON();
  anthropicRequests.push({ headers: req.headers(), body });
  if (anthropicMode === 'overloaded') {
    return route.fulfill({ status: 529, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }) });
  }
  return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: anthropicSSE(replyFor(body)) });
});
await page.route('https://api.openai.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  const body = req.postDataJSON();
  openaiRequests.push({ headers: req.headers(), body });
  return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: openaiSSE(replyFor(body)) });
});

async function openVault() {
  await page.getByTitle('Vault (Alt+5)').click();
  await page.getByRole('heading', { name: 'Settings and vault' }).waitFor();
}
async function testConnection() {
  await page.getByRole('button', { name: 'Test connection' }).click();
  return page
    .getByText(/^Responded: "ready"$/)
    .waitFor({ timeout: 15000 })
    .then(
      () => true,
      () => false,
    );
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await waitForJournal(page);

  // ----- Anthropic -----
  await openVault();
  await page.getByRole('radio', { name: /Anthropic \(Claude\)/ }).check();
  await page.getByLabel('API key', { exact: true }).fill('sk-ant-test-key');
  await page.keyboard.press('Tab');
  check('Anthropic: test connection reads the streamed reply', await testConnection());
  const a0 = anthropicRequests.at(-1);
  check(
    'Anthropic: request carries the documented headers',
    a0?.headers['x-api-key'] === 'sk-ant-test-key' && a0?.headers['anthropic-version'] === '2023-06-01' && a0?.headers['anthropic-dangerous-direct-browser-access'] === 'true',
  );
  check('Anthropic: body has model, stream, max_tokens and a top-level system prompt', a0?.body.model === 'claude-sonnet-5-5' && a0?.body.stream === true && a0?.body.max_tokens === 10 && a0?.body.system.includes('single word') && a0?.body.messages.every((m) => m.role !== 'system'));

  // Edit the Socratic template; the next request must use it.
  await page.getByText('Socratic inquiry', { exact: true }).click();
  const tpl = page.getByLabel('Instructions for Socratic inquiry');
  await tpl.fill('Task: ask exactly ONE open question about what is within their control. Mention the harbour if it fits.\nRules: one sentence, ending in a question mark.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Saved. The next prompt uses your version.').waitFor({ timeout: 5000 });
  check('edited template is saved and marked as edited', (await page.getByText('Edited', { exact: true }).count()) === 1);
  await shot('30-template-edited');

  // Ask for a Socratic question in a new entry.
  await page.getByTitle('Journal (Alt+1)').click();
  await waitForJournal(page);
  await page.keyboard.press('Alt+n');
  await page.waitForTimeout(300);
  await page.getByRole('textbox', { name: 'Paragraph 1' }).click();
  await page.keyboard.type('Walked along the harbour after work thinking about the project deadline. I want to ask Priya for more time because the plan feels rushed, and I think asking early would help.', { delay: 2 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Control+Enter');
  const anchored = page.locator('[data-anchored-question]');
  await anchored.first().waitFor({ timeout: 10000 });
  await page.waitForFunction(() => !document.querySelector('[data-anchored-question] .nr-caret'), null, { timeout: 15000 });
  const q = await anchored.first().innerText();
  check('Anthropic: streamed question appears inline, trimmed to one question', q.includes('What would asking for more time protect for you?') && !q.includes('what might it cost'), q.replace(/\n/g, ' ').slice(0, 80));
  check('co-pilot names the provider that answered', (await page.getByText('From Anthropic (claude-sonnet-5-5)').count()) >= 1);
  const a1 = anthropicRequests.at(-1);
  check(
    'request uses the edited template after the fixed shared rules',
    a1?.body.system.startsWith('You are a reflective-writing companion') && a1?.body.system.includes('Mention the harbour') && !a1?.body.system.includes('look one level beneath'),
  );
  check('request carries the writing signals and the entry text', a1?.body.messages[0].content.includes('Measured writing signals for this entry') && a1?.body.messages[0].content.includes('ask Priya for more time'));
  await shot('31-anthropic-question');

  // Provider failure falls back to the built-in engine and says so.
  anthropicMode = 'overloaded';
  await page.keyboard.type(' I could send her a short note tomorrow morning before the stand-up meeting starts.', { delay: 2 });
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+Enter');
  await page.getByText('Your AI provider did not respond, so the built-in engine answered').first().waitFor({ timeout: 15000 }).then(
    () => check('a failing provider falls back to the built-in engine, labelled', true),
    () => check('a failing provider falls back to the built-in engine, labelled', false),
  );
  anthropicMode = 'ok';

  // ----- OpenAI -----
  await openVault();
  await page.getByRole('radio', { name: /^OpenAI/ }).check();
  await page.getByLabel('API key', { exact: true }).fill('sk-openai-test');
  await page.keyboard.press('Tab');
  check('OpenAI: test connection reads the streamed reply', await testConnection());
  const o0 = openaiRequests.at(-1);
  check('OpenAI: bearer auth, current model, max_completion_tokens', o0?.headers.authorization === 'Bearer sk-openai-test' && o0?.body.model === 'gpt-6-luna' && o0?.body.max_completion_tokens >= 2000 && !('max_tokens' in o0.body) && o0?.body.messages[0].role === 'system');

  // ----- Ollama -----
  await page.getByRole('radio', { name: /Ollama on this computer/ }).check();
  await page.getByLabel('Ollama address').fill(`http://localhost:${OLLAMA_PORT}`);
  await page.keyboard.press('Tab');
  check('Ollama: test connection reads the streamed NDJSON', await testConnection());
  const l0 = ollamaRequests.at(-1);
  check('Ollama: request has model, stream and num_predict', l0?.model === 'llama3.1' && l0?.stream === true && l0?.options?.num_predict === 10 && l0?.messages[0].role === 'system');

  // Finishing an entry with Ollama: structured JSON through the stream.
  await page.getByTitle('Journal (Alt+1)').click();
  await waitForJournal(page);
  await page.keyboard.press('Control+Shift+Enter');
  await page.getByText(SYNTHESIS.keyTakeaway).waitFor({ timeout: 30000 }).then(
    () => check('Ollama: synthesis JSON streamed and shown', true),
    () => check('Ollama: synthesis JSON streamed and shown', false),
  );
  check('synthesis names the provider', (await page.getByText('Distilled by Ollama (llama3.1).').count()) === 1);
  check('Ollama: values alignment requested as JSON', ollamaRequests.some((r) => r.messages[0].content.includes('"value"') && r.options?.num_predict === 600));
  await shot('32-ollama-synthesis');

  // Back to the built-in engine.
  await openVault();
  await page.getByRole('radio', { name: /Built-in engine/ }).check();
  await page.waitForTimeout(300);
} catch (err) {
  check('provider checks completed without an exception', false, err.message.split('\n')[0]);
  await shot('99-providers-failure').catch(() => undefined);
}

ollama.close();
// The intentional 529 above is logged by the browser as a failed resource load.
process.exit((await finish({ allowConsole: [/status of 529/] })) ? 1 : 0);
