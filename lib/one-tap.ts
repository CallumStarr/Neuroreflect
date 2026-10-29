// One-tap add: spots finished lines that read like a task, such as "I need to
// ring Mum on Friday", and offers "Add to your to-do list?". Rules only, on
// this device. It never looks at the sentence still being written, and it
// stays quiet about wishes, regrets and statements like "I'll never get this".

import { parseWhen, stripWhen, type ParsedWhen } from './nl-date';
import type { Block } from './types';

export interface TaskSuggestion {
  /** Stable for the same paragraph and sentence, so a dismissal sticks. */
  key: string;
  blockId: string;
  sentence: string;
  title: string;
  when: ParsedWhen | null;
  /** Came from a written list ("Plan: ..."), so its siblings are offered together. */
  fromList?: boolean;
}

// Cues that commit to doing something. "want to", "'ll" and "going to" only
// count with a date, since without one they are usually wishes or musings.
const STRONG_CUES = [
  "i need to", "i've got to", 'i have got to', 'i have to', 'i must', 'i really must', 'i really need to',
  'remember to', "don't forget to", 'do not forget to', 'must remember to', 'need to remember to',
  'i should really', 'i plan to', "i'm planning to", 'i am planning to', 'note to self:', 'to do:', 'todo:',
];
const DATED_CUES = ["i'll", 'i will', "i'm going to", 'i am going to', 'i want to', "i'd like to", 'i hope to', 'i mean to'];
const LIST_CUES = ['plan:', 'to do:', 'todo:', 'tomorrow:'];

// Words straight after a cue that mean this isn't an action at all.
const NOT_ACTIONS = new Set([
  'always', 'never', 'ever', 'be', 'feel', 'stop', 'just', 'probably', 'still', 'really', 'try', 'think', 'accept', 'get', 'figure', 'work', 'change', 'learn', 'admit', 'remember', 'forget', 'deal', 'cope', 'keep',
]);
// "get" alone is vague, but "get milk" or "get the car fixed" is a task.
const GET_OBJECTS = /^get\s+(?:the|a|an|some|my|milk|bread|petrol|tickets?|it)\b/;

function normalise(s: string): string {
  return s.replace(/[’‘]/g, "'");
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** Sentences of a paragraph with their offsets; `complete` is false for a sentence still being typed. */
export function sentencesOf(text: string): { text: string; start: number; complete: boolean }[] {
  const out: { text: string; start: number; complete: boolean }[] = [];
  const re = /[^.!?]+(?:[.!?]+|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    out.push({ text: trimmed, start: m.index + lead, complete: /[.!?]$/.test(trimmed) });
  }
  return out;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function cleanTitle(s: string): string {
  return capitalise(
    s
      .replace(/^(?:and|then|also|to|finally|actually|maybe)\s+/i, '')
      .replace(/\s+(?:as well|too|again)$/i, '')
      .replace(/(^|\s)[@#$](?=[A-Za-z])/g, '$1')
      .replace(/[\s,;:.!?]+$/, '')
      .trim(),
  ).slice(0, 120);
}

function clauseAfter(sentence: string, cueEnd: number): string {
  return sentence.slice(cueEnd).replace(/^\s+/, '');
}

function isNegatedOrPast(lowerSentence: string, cueIndex: number): boolean {
  const before = lowerSentence.slice(Math.max(0, cueIndex - 14), cueIndex);
  return /\b(?:don't|do not|didn't|did not|never|not)\s*$/.test(before);
}

function suggestionFrom(blockId: string, sentence: string, clause: string, ref: Date, needsDate: boolean): TaskSuggestion | null {
  const firstWord = clause.toLowerCase().match(/^[a-z']+/)?.[0] ?? '';
  if (!firstWord || (NOT_ACTIONS.has(firstWord) && !(firstWord === 'get' && GET_OBJECTS.test(clause.toLowerCase())))) return null;
  // Past or conditional: "I should have", "I had to", "I would".
  if (/^(?:have|had|been)\b/.test(clause.toLowerCase())) return null;
  const when = parseWhen(clause, ref);
  if (needsDate && !when?.day) return null;
  const title = cleanTitle(when ? stripWhen(clause, when) : clause);
  if (title.split(/\s+/).length < 2 && !/^(?:ring|call|email|text|pay|book|buy|post|clean|tidy|cook|shop)$/i.test(title)) return null;
  if (title.length < 3) return null;
  return { key: `${blockId}:${hash(normalise(sentence).toLowerCase())}`, blockId, sentence, title, when };
}

/**
 * Task suggestions in finished sentences only. `activeBlockId` is the paragraph
 * the caret is in: its last sentence counts only once it has its full stop.
 */
export function findTaskSuggestions(blocks: Block[], ref: Date = new Date()): TaskSuggestion[] {
  const out: TaskSuggestion[] = [];
  for (const block of blocks) {
    for (const s of sentencesOf(block.text)) {
      if (!s.complete) continue;
      const sentence = normalise(s.text);
      const lower = sentence.toLowerCase();
      if (lower.endsWith('?')) continue;

      // "Plan: draft the slides tomorrow, run them past Sam on Sunday, and book the dentist."
      const list = LIST_CUES.find((c) => lower.startsWith(c));
      if (list) {
        const items = sentence
          .slice(list.length)
          .split(/,\s*(?:and\s+)?|\s+and\s+(?=[a-z]+\s)/i)
          .map((p) => p.trim())
          .filter(Boolean);
        for (const item of items) {
          const sug = suggestionFrom(block.id, `${s.text}#${item}`, item, ref, false);
          if (sug) out.push({ ...sug, sentence: s.text, fromList: true });
        }
        continue;
      }

      let found: TaskSuggestion | null = null;
      for (const cue of STRONG_CUES) {
        const i = lower.indexOf(cue);
        if (i < 0 || (i > 0 && /[a-z]/.test(lower[i - 1]))) continue;
        if (isNegatedOrPast(lower, i)) continue;
        found = suggestionFrom(block.id, s.text, clauseAfter(sentence, i + cue.length), ref, false);
        if (found) break;
      }
      if (!found) {
        for (const cue of DATED_CUES) {
          const i = lower.indexOf(cue);
          if (i < 0 || (i > 0 && /[a-z]/.test(lower[i - 1]))) continue;
          if (isNegatedOrPast(lower, i)) continue;
          found = suggestionFrom(block.id, s.text, clauseAfter(sentence, i + cue.length), ref, true);
          if (found) break;
        }
      }
      // "Need to book the dentist." with no "I".
      if (!found && /^(?:need to|have to|must)\s/.test(lower)) {
        found = suggestionFrom(block.id, s.text, sentence.replace(/^(?:need to|have to|must)\s+/i, ''), ref, false);
      }
      if (found) out.push(found);
    }
  }
  // One suggestion per paragraph is enough, the most recent finished one,
  // except for a written list, whose items are offered together (up to five).
  const byBlock = new Map<string, TaskSuggestion[]>();
  for (const sug of out) {
    const list = byBlock.get(sug.blockId) ?? [];
    if (sug.fromList && list.every((x) => x.fromList)) byBlock.set(sug.blockId, [...list, sug].slice(0, 5));
    else byBlock.set(sug.blockId, [sug]);
  }
  return [...byBlock.values()].flat();
}
