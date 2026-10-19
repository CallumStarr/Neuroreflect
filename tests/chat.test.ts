import assert from 'node:assert/strict';
import { buildChatPrompt, sanitizeCitations } from '../lib/chat';
import type { ChatMessage, Citation } from '../lib/types';

const cite = (n: number, snippet: string): Citation => ({ n, entryId: `e${n}`, localDay: '2026-01-0' + n, blockId: null, snippet, title: `Entry ${n}` });

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}: ${e instanceof Error ? e.message : e}`);
  }
}

check('sanitizeCitations keeps valid numbers and strips invented ones', () => {
  const r = sanitizeCitations('Work stress recurs [1] and [3]. Also [9] and [0].', 3);
  assert.deepEqual(r.used, [1, 3]);
  assert.ok(!r.text.includes('[9]') && !r.text.includes('[0]'));
});

check('sanitizeCitations reports no citations for an uncited answer', () => {
  assert.deepEqual(sanitizeCitations('You felt tired.', 3).used, []);
});

check('prompt contains only supplied passages and grounding rule', () => {
  const msgs = buildChatPrompt('Why tired?', [cite(1, 'I slept badly'), cite(2, 'Long meeting')], []);
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[0].content, /ONLY the numbered passages/);
  const last = msgs[msgs.length - 1].content;
  assert.match(last, /\[1\].*I slept badly/);
  assert.match(last, /\[2\].*Long meeting/);
});

check('prompt caps passage text for context compaction', () => {
  const many = Array.from({ length: 8 }, (_, i) => cite(i + 1, 'x'.repeat(3000)));
  const msgs = buildChatPrompt('q', many, []);
  assert.ok(msgs[msgs.length - 1].content.length < 7000);
});

check('prompt keeps only the most recent history turns', () => {
  const history: ChatMessage[] = Array.from({ length: 12 }, (_, i) => ({
    id: `m${i}`, chatId: 'c', role: i % 2 ? 'assistant' : 'user', text: `turn ${i}`, citations: [], steps: [],
    provider: null, model: '', fallbackUsed: false, incomplete: false, createdAt: '',
  }));
  const msgs = buildChatPrompt('q', [cite(1, 'a')], history);
  assert.equal(msgs.length, 1 + 6 + 1);
  assert.equal(msgs[1].content, 'turn 6');
});

if (failures) {
  console.log(`\n${failures} chat check(s) failed`);
  process.exit(1);
}
console.log('\nAll chat checks passed');
