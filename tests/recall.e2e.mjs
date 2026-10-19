// Browser checks for Recall (ask your journal). The cloud provider is a mock
// that answers in Anthropic's documented streaming format; nothing leaves the
// machine. Usage:
//   npm run dev   (in another terminal)
//   node tests/recall.e2e.mjs [baseUrl] [screenshotDir]
import path from 'node:path';
import { startSuite, waitForJournal } from './e2e-helpers.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const SHOTS = process.argv[3] ?? path.join('tests', 'screenshots', 'recall');
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };

const { page, check, shot, finish } = await startSuite({ base: BASE, shots: SHOTS });

let mode = 'answer';
const requests = [];
function anthropicSSE(text) {
  const events = [
    { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', content: [] } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ...text.match(/\S+\s*/g).map((t) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } })),
    { type: 'content_block_stop', index: 0 },
    { type: 'message_stop' },
  ];
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}
await page.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  requests.push(req.postDataJSON());
  if (mode === 'fail') return route.fulfill({ status: 529, headers: { ...CORS, 'content-type': 'application/json' }, body: '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' });
  return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: anthropicSSE('The presentation went better than you feared [1]. Waiting was the hard part [2]. See [14].') });
});

const passagesIn = (body) => (body?.messages?.at(-1)?.content.match(/^\[\d+\]/gm) ?? []).length;
const answers = () => page.locator('article').filter({ hasText: 'Journal recall assistant' });

async function ask(question) {
  const before = await answers().count();
  await page.getByRole('textbox', { name: 'Ask your journal' }).fill(question);
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.waitForFunction((n) => document.querySelectorAll('article').length >= 0 && [...document.querySelectorAll('article')].filter((a) => a.textContent.includes('Journal recall assistant')).length > n, before, { timeout: 20000 });
  return answers().last();
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await waitForJournal(page);
  await page.getByTitle('Memory (Alt+3)').click();
  await page.getByRole('radio', { name: 'Recall' }).click();
  await page.getByText('Ask your journal', { exact: false }).first().waitFor({ timeout: 10000 });
  check('recall view opens', true);

  // Built-in engine.
  let a = await ask('Where does my stress show up most?');
  check('the built-in engine answers with passages from the entries', (await a.getByText('From your entries').count()) === 1);
  check('the answer says nothing left the device', (await a.getByTestId('answer-note').innerText()).includes('Nothing left this device'));
  check('threads list is visible', (await page.getByRole('heading', { name: 'Threads' }).count()) === 1);
  check('chapters list is visible', (await page.getByRole('heading', { name: 'Chapters' }).count()) === 1);
  check('no dash characters in the answer', !/[\u2013\u2014]/.test(await a.innerText()));
  await shot('recall-main');

  // Mocked Anthropic answers, citing two passages and inventing a third.
  await page.getByTitle('Vault (Alt+4)').click();
  await page.getByRole('radio', { name: /Anthropic \(Claude\)/ }).check();
  await page.getByLabel('API key', { exact: true }).fill('sk-ant-test-key');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  await page.getByTitle('Memory (Alt+3)').click();
  await page.getByRole('radio', { name: 'Recall' }).click();
  a = await ask('What happened with the presentation?');
  const text = await a.innerText();
  const sent = passagesIn(requests.at(-1));
  check('a provider answer is shown with its own citations only', text.includes('went better than you feared [1]') && !text.includes('[14]'));
  check('the request opens with the shared safety rules', (requests.at(-1)?.system ?? '').startsWith('You are a reflective-writing companion') && requests.at(-1).system.includes('Samaritans'));
  check('the note names the provider and the number of passages sent', (await a.getByTestId('answer-note').innerText()).includes(`Written by Anthropic (claude-sonnet-5-5) from ${sent} passage`), `${sent} passages`);
  await shot('recall-provider');

  // The provider fails: built-in summary, and the note still counts what was sent.
  mode = 'fail';
  a = await ask('When did I feel relief?');
  const failedSent = passagesIn(requests.at(-1));
  const note = await a.getByTestId('answer-note').innerText();
  check('a failing provider falls back and still reports the passages sent', note.includes('did not answer') && note.includes(`${failedSent} passage`), note);

  // No API key: nothing is sent, and the note says so.
  await page.getByTitle('Vault (Alt+4)').click();
  await page.getByLabel('API key', { exact: true }).fill('');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  await page.getByTitle('Memory (Alt+3)').click();
  await page.getByRole('radio', { name: 'Recall' }).click();
  const before = requests.length;
  a = await ask('What happened with the presentation?');
  const keyless = await a.getByTestId('answer-note').innerText();
  check('without an API key nothing is sent and the note says so', requests.length === before && keyless.includes('Nothing left this device'), keyless);

  // Back to the built-in engine.
  await page.getByTitle('Vault (Alt+4)').click();
  await page.getByRole('radio', { name: /Built-in engine/ }).check();
  await page.waitForTimeout(300);
} catch (err) {
  check('recall checks completed without an exception', false, err.message.split('\n')[0]);
  await shot('99-recall-failure').catch(() => undefined);
}

// The intentional 529 is logged by the browser as a failed resource load.
process.exit((await finish({ allowConsole: [/status of 529/] })) ? 1 : 0);
