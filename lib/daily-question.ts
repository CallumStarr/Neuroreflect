// Today's question: one light question a day, the same for everyone using
// NeuroReflect on the same date, as with a daily puzzle. The list is part of
// the app, so no server is needed: the date picks the question.
//
// The questions are written for NeuroReflect in plain wellbeing language. None
// asks about symptoms or conditions, and none digs into the past. If one
// touches a topic the person asked to leave alone, or their last entry
// circled, a gentler question takes its place.

import type { LocalDay } from './types';

export interface DailyQuestion {
  id: string;
  text: string;
  /** Extra words for matching topics to leave alone, beyond the question's own words. */
  about?: string[];
}

export const DAILY_QUESTIONS: DailyQuestion[] = [
  { id: 'dq01', text: 'What is something small that went right today?' },
  { id: 'dq02', text: 'Who made your day a little easier lately, and how?', about: ['people', 'friends', 'family'] },
  { id: 'dq03', text: 'What are you looking forward to this week?' },
  { id: 'dq04', text: 'What did you do today that your past self would be glad to see?' },
  { id: 'dq05', text: 'What is taking up the most room in your head right now?' },
  { id: 'dq06', text: 'Where did you feel most at ease today?' },
  { id: 'dq07', text: 'What is one thing you would like to remember about this week?' },
  { id: 'dq08', text: 'What did you learn recently that surprised you?' },
  { id: 'dq09', text: 'What is a conversation you have been meaning to have?', about: ['people', 'relationships'] },
  { id: 'dq10', text: 'What would make tomorrow a good day?' },
  { id: 'dq11', text: 'What are you proud of that nobody else noticed?' },
  { id: 'dq12', text: 'What did you spend most of your energy on today?' },
  { id: 'dq13', text: 'What is a place that always lifts you a little?' },
  { id: 'dq14', text: 'What is something you are curious about at the moment?' },
  { id: 'dq15', text: 'What would you do with a free afternoon this week?' },
  { id: 'dq16', text: 'What habit is quietly helping you lately?' },
  { id: 'dq17', text: 'Who would you like to thank, and for what?', about: ['people', 'gratitude'] },
  { id: 'dq18', text: 'What did you notice outside today?' },
  { id: 'dq19', text: 'What is one thing you could let go of this week?' },
  { id: 'dq20', text: 'What is a decision you are glad you made?', about: ['decisions'] },
  { id: 'dq21', text: 'What made you laugh recently?' },
  { id: 'dq22', text: 'What does a good evening look like for you?' },
  { id: 'dq23', text: 'What is something you are getting better at?' },
  { id: 'dq24', text: 'What would you like more of in your week?' },
  { id: 'dq25', text: 'What is a kind thing someone did for you recently?', about: ['people'] },
  { id: 'dq26', text: 'What is on your mind about work or study this week?', about: ['work', 'job', 'study', 'school', 'university'] },
  { id: 'dq27', text: 'What is a meal or a taste that felt like a treat lately?', about: ['food', 'eating'] },
  { id: 'dq28', text: 'What is something you are waiting for, and how does the waiting feel?' },
  { id: 'dq29', text: 'What helped you get through a busy moment today?' },
  { id: 'dq30', text: 'What would you tell a friend who had the week you are having?' },
  { id: 'dq31', text: 'What is a song, book or show that has stayed with you lately?' },
  { id: 'dq32', text: 'What is one thing you did today just for you?' },
  { id: 'dq33', text: 'What is something you are carrying that you could put down for tonight?' },
  { id: 'dq34', text: 'What is a small plan you could make for the weekend?' },
  { id: 'dq35', text: 'What has been easier than you expected recently?' },
  { id: 'dq36', text: 'Who do you feel most like yourself around?', about: ['people', 'relationships'] },
  { id: 'dq37', text: 'What is a question you would like answered this month?' },
  { id: 'dq38', text: 'What part of your routine would you keep exactly as it is?' },
  { id: 'dq39', text: 'What is something you noticed about yourself this week?' },
  { id: 'dq40', text: 'What is a moment from today you would like to replay?' },
  { id: 'dq41', text: 'What would make your space at home feel a little better?', about: ['home'] },
  { id: 'dq42', text: 'What is something you are looking forward to learning?' },
  { id: 'dq43', text: 'What did you say yes to recently, and are you glad you did?' },
  { id: 'dq44', text: 'What did you say no to recently, and how did it feel?' },
  { id: 'dq45', text: 'What gave you a bit of energy today?' },
  { id: 'dq46', text: 'What is a skill you would like to have a year from now?' },
  { id: 'dq47', text: 'What is something ordinary you would miss if it changed?' },
  { id: 'dq48', text: 'What did you get done today, however small?' },
  { id: 'dq49', text: 'What is a worry you could set a time for, rather than carry all day?' },
  { id: 'dq50', text: 'What is one thing that went better than you thought it would?' },
  { id: 'dq51', text: 'What is a walk, a view or a window you enjoyed lately?' },
  { id: 'dq52', text: 'Who have you not heard from in a while that you would like to?', about: ['people', 'friends', 'family'] },
  { id: 'dq53', text: 'What do you need more of this week: rest, people, or quiet?' },
  { id: 'dq54', text: 'What is a recent choice that matched what matters to you?', about: ['values'] },
  { id: 'dq55', text: 'What would make the next hour a good one?' },
  { id: 'dq56', text: 'What is one thing you are looking forward to tomorrow?' },
  { id: 'dq57', text: 'What surprised you about today?' },
  { id: 'dq58', text: 'What is something you made or fixed recently?' },
  { id: 'dq59', text: 'What is the best advice you have been given?' },
  { id: 'dq60', text: 'What would you like to say to yourself at the end of this week?' },
  { id: 'dq61', text: 'What is a little ritual that makes your day better?' },
  { id: 'dq62', text: 'What is something you are grateful to your body for today?', about: ['body', 'health'] },
  { id: 'dq63', text: 'What is a goal that feels within reach at the moment?', about: ['goals'] },
  { id: 'dq64', text: 'What is on your list that could wait until next week?' },
  { id: 'dq65', text: 'What did you notice someone else doing well?', about: ['people'] },
  { id: 'dq66', text: 'What is something you changed your mind about?' },
  { id: 'dq67', text: 'When did time fly today?' },
  { id: 'dq68', text: 'What is a small comfort you could give yourself tonight?' },
  { id: 'dq69', text: 'What is a memory from this month you would like to keep?' },
  { id: 'dq70', text: 'What is one thing you would like to try this season?' },
  { id: 'dq71', text: 'What is something that is going on in the background of your week?' },
  { id: 'dq72', text: 'Who taught you something useful, and what was it?', about: ['people'] },
  { id: 'dq73', text: 'What is a word that sums up today?' },
  { id: 'dq74', text: 'What did you handle well recently?' },
  { id: 'dq75', text: 'What is a hobby or interest you would like more time for?' },
  { id: 'dq76', text: 'What is one thing you could make simpler this week?' },
  { id: 'dq77', text: 'What do you want to remember about the people around you right now?', about: ['people', 'family', 'friends'] },
  { id: 'dq78', text: 'What is a small risk you are glad you took?' },
  { id: 'dq79', text: 'What made today different from yesterday?' },
  { id: 'dq80', text: 'What is something you would like to celebrate, however small?' },
  { id: 'dq81', text: 'What is a sound you enjoyed today?' },
  { id: 'dq82', text: 'What would you like to stop doing, and what would you do instead?' },
  { id: 'dq83', text: 'What is the next small step on something you care about?' },
  { id: 'dq84', text: 'What did you do today that took some courage?' },
  { id: 'dq85', text: 'What is a place you would like to go back to?' },
  { id: 'dq86', text: 'What is a compliment you remember?' },
  { id: 'dq87', text: 'What is a plan for this week you feel good about?' },
  { id: 'dq88', text: 'What is one thing that made today feel like yours?' },
  { id: 'dq89', text: 'What did you notice when you slowed down today?' },
  { id: 'dq90', text: 'What is something you are looking forward to this month?' },
];

/** Used after an entry that circled, or when the day's question touches a topic to leave alone. */
export const GENTLE_QUESTIONS: DailyQuestion[] = [
  { id: 'dqg01', text: 'What is one small thing that is going all right?' },
  { id: 'dqg02', text: 'What is something you can see from where you are sitting?' },
  { id: 'dqg03', text: 'What would be kind to yourself tonight?' },
  { id: 'dqg04', text: 'What is a simple thing you enjoyed today?' },
  { id: 'dqg05', text: 'What is one thing you could do in the next hour to feel a little more comfortable?' },
  { id: 'dqg06', text: 'What is a place or a thing that feels calm to you?' },
  { id: 'dqg07', text: 'What is something you are looking forward to, however small?' },
  { id: 'dqg08', text: 'What has gone well enough today?' },
  { id: 'dqg09', text: 'What is a smell, a taste or a sound you like?' },
  { id: 'dqg10', text: 'What is something you managed today?' },
  { id: 'dqg11', text: 'What would make tonight a little easier?' },
  { id: 'dqg12', text: 'What is one thing you are glad of right now?' },
];

const EPOCH = Date.UTC(2026, 0, 1);

function dayNumber(day: LocalDay): number {
  const [y, m, d] = day.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / 86400000);
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function touches(q: DailyQuestion, avoid: string[]): boolean {
  const hay = `${q.text} ${(q.about ?? []).join(' ')}`.toLowerCase();
  return avoid.some((topic) => {
    const t = topic.trim().toLowerCase();
    if (t.length < 2) return false;
    return new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(hay);
  });
}

export interface QuestionPick {
  question: DailyQuestion;
  /** True when a gentler question replaced the day's question. */
  gentle: boolean;
}

/**
 * The question for a date. Everyone gets the same one unless a gentler one is
 * needed. Null when every candidate touches a topic to leave alone.
 */
export function questionFor(day: LocalDay, avoid: string[] = [], gentle = false): QuestionPick | null {
  const n = dayNumber(day);
  const usual = DAILY_QUESTIONS[mod(n, DAILY_QUESTIONS.length)];
  if (!gentle && !touches(usual, avoid)) return { question: usual, gentle: false };
  // Walk the gentle list from the same point until one avoids every topic.
  for (let i = 0; i < GENTLE_QUESTIONS.length; i++) {
    const q = GENTLE_QUESTIONS[mod(n + i, GENTLE_QUESTIONS.length)];
    if (!touches(q, avoid)) return { question: q, gentle: true };
  }
  return null;
}

/** The prompt id that marks an entry as an answer to that day's question. */
export function questionPromptId(day: LocalDay): string {
  return `today:${day}`;
}
