// Recall checks run with `npm test`: what a provider is sent, what the trace
// records, and what the local tools find, on the sample journal. Provider
// calls go to a stand-in fetch; nothing leaves this machine.
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { getDB, loadSettings } from '../lib/db';
import { askJournal, buildChatPrompt } from '../lib/chat';
import { initLock } from '../lib/lock';
import { searchMemory, summarizeThread } from '../lib/memory';
import { seedDatabase } from '../lib/seed';
import { saveTemplateBody } from '../lib/templates';
import type { AppSettings } from '../lib/types';

let failures = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${(e as Error).message}`);
  }
}

type Captured = { url: string; body: { system?: string; messages: { role: string; content: string }[] } };
const requests: Captured[] = [];
let reply: (body: Captured['body']) => Response = () => new Response('{}', { status: 500 });

globalThis.fetch = (async (url: unknown, init?: { body?: unknown }) => {
  const body = JSON.parse(String(init?.body ?? '{}'));
  requests.push({ url: String(url), body });
  return reply(body);
}) as typeof fetch;

function anthropicStream(text: string): Response {
  const events = [
    { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', content: [] } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ...(text.match(/\S+\s*/g) ?? []).map((t) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } })),
    { type: 'content_block_stop', index: 0 },
    { type: 'message_stop' },
  ];
  return new Response(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const passagesIn = (c: Captured) => (c.body.messages.at(-1)?.content.match(/^\[\d+\]/gm) ?? []).length;

async function main() {
  console.log('Recall checks:');
  await getDB().open();
  await initLock();
  await seedDatabase();
  const base = await loadSettings();
  const cloud = (key = 'sk-test'): AppSettings => ({ ...base, provider: { ...base.provider, primary: 'anthropic', anthropicKey: key } });

  await check('the Recall prompt starts with the shared safety and style rules', () => {
    const system = buildChatPrompt('q', [], [])[0].content;
    assert.ok(system.startsWith('You are a reflective-writing companion'));
    assert.ok(system.includes('Samaritans on 116 123'));
    assert.ok(system.includes('ONLY the numbered passages'));
  });

  await check('a provider that fails is still recorded as having been sent the passages', async () => {
    requests.length = 0;
    reply = () => new Response(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }), { status: 529 });
    const { assistant } = await askJournal({ chatId: null, question: 'What happened with the presentation?', settings: cloud() });
    assert.equal(requests.length, 1);
    const sent = passagesIn(requests[0]);
    assert.ok(sent > 0, 'no passages in the request');
    const step = assistant.steps.find((s) => s.tool === 'answer_with_provider');
    assert.equal(step?.sentToProvider, sent);
    assert.match(step?.resultSummary ?? '', /did not answer/);
    assert.equal(assistant.fallbackUsed, true);
    assert.equal(assistant.provider, 'heuristic');
  });

  await check('without an API key nothing is sent and the trace says so', async () => {
    requests.length = 0;
    const { assistant } = await askJournal({ chatId: null, question: 'What happened with the presentation?', settings: cloud('') });
    assert.equal(requests.length, 0);
    const step = assistant.steps.find((s) => s.tool === 'answer_with_provider');
    assert.equal(step?.sentToProvider, 0);
    assert.match(step?.resultSummary ?? '', /no API key/);
  });

  await check('a provider answer keeps only the citations it used and drops invented numbers', async () => {
    requests.length = 0;
    reply = () => anthropicStream('It went better than you feared [1], and the dread was the hard part [2]. See also [12].');
    const { assistant } = await askJournal({ chatId: null, question: 'What happened with the presentation?', settings: cloud() });
    assert.equal(assistant.provider, 'anthropic');
    assert.ok(assistant.text.includes('[1]') && assistant.text.includes('[2]') && !assistant.text.includes('[12]'));
    assert.deepEqual(assistant.citations.map((c) => c.n), [1, 2]);
    assert.equal(assistant.steps.find((s) => s.tool === 'answer_with_provider')?.sentToProvider, passagesIn(requests[0]));
  });

  await check('an edited Recall template is sent, still after the shared rules', async () => {
    requests.length = 0;
    await saveTemplateBody('recall', 'Task: answer ONLY from the numbered passages, citing them like [1]. Speak plainly about the harbour.');
    await askJournal({ chatId: null, question: 'What happened with the presentation?', settings: cloud() });
    const system = requests[0].body.system ?? '';
    assert.ok(system.startsWith('You are a reflective-writing companion') && system.includes('about the harbour'));
    await saveTemplateBody('recall', '');
  });

  await check('an ordinary question about a person cites passages about them and names their thread', async () => {
    const { assistant } = await askJournal({ chatId: null, question: 'How are things with Priya?', settings: base });
    const entries = new Set(assistant.citations.filter((c) => c.snippet.includes('Priya')).map((c) => c.entryId));
    assert.ok(entries.size >= 3, `passages about Priya from only ${entries.size} entries`);
    assert.match(assistant.steps.find((s) => s.tool === 'find_threads')?.resultSummary ?? '', /named in the question/);
  });

  await check('moments never repeat a paragraph the passage search already cited', async () => {
    for (const question of ['What did I learn about presentations?', 'When did I feel relief?', 'sleep']) {
      const { assistant } = await askJournal({ chatId: null, question, settings: base });
      const found = Number(assistant.steps.find((s) => s.tool === 'find_moments')?.resultSummary.match(/^Found (\d+)/)?.[1] ?? 0);
      const moments = assistant.citations.slice(assistant.citations.length - found);
      const searched = new Set(assistant.citations.slice(0, assistant.citations.length - found).map((c) => `${c.entryId}|${c.blockId}`));
      for (const m of moments) assert.ok(!searched.has(`${m.entryId}|${m.blockId}`), `"${question}": paragraph cited twice`);
    }
  });

  await check('no trend is claimed for a thread with fewer than four entries', async () => {
    const priya = (await getDB().threads.toArray()).find((t) => t.title === 'Priya');
    assert.ok(priya, 'no Priya thread');
    assert.equal(priya!.entryIds.length, 3);
    assert.match(summarizeThread(priya!), /most recently on/);
    assert.doesNotMatch(summarizeThread(priya!), /calmer|negative feeling|intensifying/);
  });

  await check('a trend, once claimed, compares the latest entry with the earlier ones', async () => {
    const work = (await getDB().threads.toArray()).find((t) => t.title === 'Work');
    assert.ok(work && work.entryIds.length >= 4, 'no Work thread with four entries');
    const summary = summarizeThread(work!);
    assert.match(summary, /the latest entry about it/);
    const expected = work!.negLate < work!.negEarly - 0.01 ? /calmer/ : work!.negLate > work!.negEarly + 0.01 ? /more negative/ : /much like/;
    assert.match(summary, expected);
  });

  await check('a chapter carries forward only a micro-action written for that period', async () => {
    const chapters = await getDB().chapters.toArray();
    const actions = new Set((await getDB().syntheses.toArray()).map((s) => s.microAction));
    assert.ok(chapters.length > 0);
    for (const c of chapters) assert.ok(c.carryForward === '' || actions.has(c.carryForward), `invented carry-forward: ${c.carryForward}`);
  });

  // A regression check on the sample journal, not a measure of retrieval
  // quality: several cases were chosen because an earlier version missed them.
  const CASES: [string, string, number][] = [
    ['How are things with Priya?', 'Priya said my report', 1],
    ['When did I feel relief?', 'I felt real relief', 3],
    ['sleep', 'slept properly', 3],
    ['Where does my stress show up most?', 'stressed all evening', 1],
    ['What did I learn about presentations?', 'The presentation happened', 2],
    ['the dentist', 'dentist appointment', 1],
    ['Christmas with Mum', 'about Christmas', 1],
    ['boundaries at work', 'boundary resentment', 3],
    ['running', 'run along the river', 3],
    ['celebrate', 'made pasta to celebrate', 1],
    ['Why do I freeze?', 'freeze', 3],
  ];
  await check(`sample-journal retrieval finds the expected passage for all ${CASES.length} questions`, async () => {
    const misses: string[] = [];
    for (const [q, want, k] of CASES) {
      const rank = (await searchMemory(q, 8)).findIndex((h) => h.snippet.includes(want)) + 1;
      if (!rank || rank > k) misses.push(`${q} (rank ${rank || 'none'}, needed ${k})`);
    }
    assert.deepEqual(misses, []);
  });

  console.log(failures ? `\n${failures} recall check(s) failed` : '\nAll recall checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
