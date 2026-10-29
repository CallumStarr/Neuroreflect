// Engagement check in a real browser: the first session, the writing time and
// its nudge, the question for next time, the weekly rhythm, "Was this worth
// your time?", the figures and the tester summary. The clock is fixed to a
// Thursday at noon so the nudge times are predictable.
//   node tests/engagement.e2e.mjs [baseUrl]
import fs from 'node:fs';
import path from 'node:path';
import { startSuite, storedText } from './e2e-helpers.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const { page, context, check, shot, finish } = await startSuite({
  base: BASE,
  shots: path.join('tests', 'screenshots', 'engagement'),
  viewport: { width: 1440, height: 900 },
});

const NOON = new Date(2026, 9, 29, 12, 0); // Thursday 29 October 2026
const ENTRY = 'Work has been busy and I keep thinking about the presentation on Friday. I think I am more prepared than I feel, because I practised twice already. I would like to ask Sam for feedback.';
const text = async (testId) => ((await page.getByTestId(testId).innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
const visible = (locator) => locator.isVisible().catch(() => false);
/** Checks that a part of the page reads as expected, waiting for live data to arrive. */
async function reads(name, testId, expected, timeout = 5000) {
  const until = Date.now() + timeout;
  const ok = (t) => (typeof expected === 'string' ? t === expected : expected.test(t));
  let t = await text(testId);
  while (!ok(t) && Date.now() < until) {
    await page.waitForTimeout(150);
    t = await text(testId);
  }
  check(name, ok(t), t.length > 160 ? `${t.slice(0, 160)}...` : t);
  return t;
}
/** Polls the stored data until it matches, as entries save a moment after a change. */
async function storedMatches(re, timeout = 5000) {
  const until = Date.now() + timeout;
  for (;;) {
    if (re.test(await storedText(page))) return true;
    if (Date.now() > until) return false;
    await page.waitForTimeout(250);
  }
}

try {
  await context.clock.setFixedTime(NOON);
  await page.goto(BASE);

  // ---------- the first session ----------
  await page.getByTestId('welcome-dialog').waitFor({ timeout: 30000 });
  check('a new journal opens on the welcome', true);
  const sampleEntries = await page.getByRole('complementary', { name: 'Entries' }).getByText('Review meeting', { exact: true }).count();
  check('no sample entries unless asked for', sampleEntries === 0);
  await page.getByRole('button', { name: "Let's start" }).click();
  await page.getByRole('button', { name: /Understand myself better/ }).click();
  await page.getByLabel(/Your first name/).fill('Callum');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('radio', { name: 'After dinner' }).waitFor();
  check('after dinner is the suggested moment', (await page.getByRole('radio', { name: 'After dinner' }).getAttribute('aria-checked')) === 'true');
  await page.getByRole('radio', { name: '3 days' }).click();
  await page.getByLabel('Where you will write').fill('at the kitchen table');
  const preview = await page.getByTestId('writing-plan-editor').innerText();
  check('the plan previews the nudge time', /Around 8:30pm/.test(preview), preview.match(/Around[^.]*/)?.[0] ?? '');

  const icsDownload = page.waitForEvent('download', { timeout: 10000 });
  await page.getByRole('button', { name: 'Add my writing time to my calendar' }).click();
  const ics = fs.readFileSync(await (await icsDownload).path(), 'utf8');
  check('calendar file: a daily "Writing time" at 7:30pm', /SUMMARY:Writing time\r\n/.test(ics) && /DTSTART:20261029T193000\r\n/.test(ics) && /RRULE:FREQ=DAILY/.test(ics));
  check('calendar file: nothing personal in it', !/dinner|kitchen|Callum/i.test(ics));

  await shot('01-plan');
  await page.getByTestId('welcome-finish').click();
  await page.getByText("What's taking up the most room in your head this week?").waitFor({ timeout: 10000 });
  check('the first entry opens with its own prompt', true);
  await reads('this week starts at none of three', 'rhythm-line', '0 of 3 days this week');
  await reads('the nudge shows when it will come', 'nudge-status', 'Nudge at 8:30pm');
  const afterWelcome = await storedText(page);
  check('the plan is saved with when it was set', /"moment":"after dinner"/.test(afterWelcome) && /"setAt":"2026-10-29T/.test(afterWelcome));

  // ---------- the first entry ----------
  await page.getByRole('textbox', { name: 'Paragraph 1' }).click();
  await page.keyboard.type(ENTRY, { delay: 1 });
  await page.waitForTimeout(1200);
  await page.keyboard.press('Control+Shift+Enter');
  await page.getByText('Key takeaway').waitFor({ timeout: 20000 });
  await page.getByTestId('card-first-session').waitFor({ timeout: 10000 });
  check('finishing the first entry offers one more step', true);
  check('a question for next time is offered', await visible(page.getByTestId('next-question')));
  await page.getByTestId('next-question').getByRole('button', { name: 'How did my small plan go?' }).click();
  check('the question for next time is saved on the entry', await storedMatches(/"nextQuestion":"How did my small plan go\?"/));
  await reads('the week fills in', 'rhythm-line', '1 of 3 days this week');
  await reads('no nudge once written', 'nudge-status', 'Written today');
  await shot('02-finished');
  await page.getByTestId('card-first-session').getByRole('button', { name: 'Not now' }).click();
  await page.waitForTimeout(400);
  check('the card goes when waved away', !(await visible(page.getByTestId('card-first-session'))));

  // ---------- the next entry ----------
  await page.keyboard.press('Alt+n');
  await page.getByText('You left yourself this question earlier today.').waitFor({ timeout: 10000 });
  check('the next entry opens with the question left for it', await visible(page.getByText('How did my small plan go?').first()));

  // Not today, and pause for a week.
  await page.getByTestId('nudge-status').click();
  await page.getByRole('menuitem', { name: 'Not today' }).click();
  await page.waitForTimeout(400);
  await reads('Not today', 'nudge-status', 'No nudge today');
  await page.getByTestId('nudge-status').click();
  await page.getByRole('menuitem', { name: 'Nudge me today after all' }).click();
  await page.waitForTimeout(400);
  await page.getByTestId('nudge-status').click();
  await page.getByRole('menuitem', { name: 'Pause for a week' }).click();
  await page.waitForTimeout(400);
  await reads('Pause for a week', 'nudge-status', 'Nudge paused until Wed 4 Nov');
  await page.getByTestId('nudge-status').click();
  await page.getByRole('menuitem', { name: 'Resume the nudge' }).click();
  await page.waitForTimeout(400);
  await reads('Resume', 'nudge-status', 'Written today');

  // The week's chapter.
  await page.getByTestId('open-week').click();
  await page.getByTestId('week-chapter').waitFor({ timeout: 10000 });
  await reads("the week's chapter opens", 'week-chapter', /1 entry · 1 of 3 days this week/);
  await page.waitForTimeout(400);
  await shot('03-week');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ---------- a later visit ----------
  await context.clock.setFixedTime(new Date(2026, 9, 29, 16, 0));
  await page.keyboard.press('Alt+5');
  await page.keyboard.press('Alt+1');
  await page.keyboard.press('Alt+n');
  const worth = page.getByTestId('card-worth');
  await worth.waitFor({ timeout: 10000 });
  check('"Was this worth your time?" comes at a later visit', /earlier today: was it worth your time\?/.test(await worth.innerText()));
  await page.waitForTimeout(400);
  await shot('04-worth');
  await worth.getByRole('button', { name: '4 out of 5' }).click();
  const rated = await storedMatches(/"worth":\{"score":4/);
  await worth.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
  check('the rating is saved and the card goes', rated && !(await visible(worth)), `saved ${rated}, card ${(await visible(worth)) ? 'still shown' : 'gone'}`);

  // ---------- settings ----------
  await page.keyboard.press('Alt+5');
  await page.getByTestId('settings-writing-time').waitFor({ timeout: 10000 });
  await reads('settings: the plan in words', 'settings-writing-time', /You write after dinner, at the kitchen table, usually around 7:30pm\./);
  await reads('settings: the nudge time', 'settings-writing-time', /Nudge around 8:30pm, only on days you haven't written\. Weekly aim: 3 days\./);
  await page.getByTestId('edit-writing-time').click();
  await page.getByRole('radio', { name: 'Before bed' }).click();
  await page.getByTestId('writing-time-save').click();
  await page.waitForTimeout(500);
  await reads('a nudge that would fall in quiet hours comes just before them', 'settings-writing-time', /usually around 9:30pm\..*Nudge around 9:59pm/);

  await page.getByTestId('settings-figures').scrollIntoViewIfNeeded();
  await reads('figures: entries', 'settings-figures', /Entries 1 in the last four weeks 1 /);
  await reads('figures: weeks since the first entry, not before it', 'settings-figures', /Weeks with writing since your first entry 1 of 1/);
  await reads('figures: worth', 'settings-figures', /Entries you found worth your time 4 or 5 out of 5, of the 1 you rated 100%/);

  await page.getByTestId('tester-toggle').click();
  await page.getByRole('button', { name: 'Take the habit check' }).click();
  const habit = page.getByRole('dialog', { name: 'Habit check' });
  await habit.waitFor();
  const groups = await habit.getByRole('radiogroup').all();
  check('habit check: four statements', groups.length === 4);
  for (const group of groups) await group.getByRole('radio', { name: '5' }).click();
  await habit.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(500);
  await reads('figures: the habit check score', 'settings-figures', /Habit check 1 to 7, higher means more automatic 5\.0/);
  const summaryDownload = page.waitForEvent('download', { timeout: 10000 });
  await page.getByTestId('export-usage').click();
  const summary = fs.readFileSync(await (await summaryDownload).path(), 'utf8');
  const parsed = JSON.parse(summary);
  check('usage summary: counts', parsed.entries === 1 && parsed.ratedEntries === 1 && parsed.habitCheckScores?.[0] === 5);
  check('usage summary: no dates, names or words', !/\d{4}-\d{2}-\d{2}|Callum|presentation|Sam|dinner|kitchen|small plan/i.test(summary));
  await shot('05-figures');
} catch (err) {
  check('engagement checks completed without an exception', false, err.message.split('\n')[0]);
  await shot('error').catch(() => undefined);
}

process.exit((await finish()) ? 1 : 0);
