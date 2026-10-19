// End-to-end check in a real Chromium. Usage:
//   npm run dev   (in another terminal)
//   node tests/e2e.mjs [baseUrl] [screenshotDir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const SHOTS = process.argv[3] ?? path.resolve('tests/screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const RUMINATION_TEXT =
  'I feel awful. I hate myself today. I messed up again at work and I feel so stupid. I am useless and everyone thinks I am pathetic. I keep replaying it. I feel sick and tired and stuck. My head hurts. I am angry at myself. I feel worthless. I cried in the car. I hate that I am like this. I feel like a failure and I am exhausted. I am scared it will happen again tomorrow. I feel hopeless. I just feel bad and miserable and alone tonight and I hate it. I keep going over the same moment in my head again and again. I feel so tense and upset and I am sick of feeling like this every single night.';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

const launchOpts = { headless: true };
const bundled = '/opt/pw-browsers/chromium';
if (fs.existsSync(bundled) && fs.statSync(bundled).isFile()) launchOpts.executablePath = bundled;
else if (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')) launchOpts.executablePath = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const browser = await chromium.launch(launchOpts);
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const consoleErrors = [];
const consoleWarnings = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
  if (msg.type() === 'warning') consoleWarnings.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
const status = () => page.locator('[data-testid="rumination-status"]').getAttribute('data-state');

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^Finish$|^Re-finish$/ }).waitFor({ timeout: 30000 });
  check('app boots and opens the journal', true);

  // Seed data present.
  const rail = page.getByRole('complementary', { name: 'Entries' });
  for (const title of ['Before the leadership presentation', 'It went better than my brain said it would', 'Review meeting', 'Stepping back']) {
    check(`seed entry present: ${title}`, (await rail.getByText(title, { exact: true }).count()) === 1);
  }
  check('seeded exactly once (no duplicates)', (await rail.getByText('Review meeting', { exact: true }).count()) === 1);
  await shot('01-studio-blank');

  // The seeded high-rumination entry shows the breaker active and inline highlights.
  await rail.getByText('Review meeting', { exact: true }).click();
  await page.waitForTimeout(800);
  check('seeded rumination entry shows breaker active', (await status()) === 'active', `state=${await status()}`);
  check('fused phrases are highlighted', (await page.locator('.nr-mark-fused').count()) >= 3, `${await page.locator('.nr-mark-fused').count()} marks`);
  await shot('02-review-meeting-rumination');

  // Reality check banner for the past-due forecast.
  const banner = page.getByTestId('calibration-banner');
  check('reality-check banner shown for past-due forecast', await banner.isVisible());
  await banner.getByRole('button', { name: 'Log how it went' }).click();
  await shot('03-reality-check-open');
  await page.getByRole('button', { name: 'Save reality check' }).click();
  await page.getByText(/overestimated the impact by 20 points/).waitFor({ timeout: 5000 });
  check('reality check computes prediction error', true, 'predicted 60, actual 40');

  // New entry: type a high I-talk negative entry and watch the breaker arm and fire.
  await page.keyboard.press('Alt+n');
  await page.waitForTimeout(400);
  const first = page.getByRole('textbox', { name: 'Paragraph 1' });
  await first.click();
  const words = RUMINATION_TEXT.split(' ');
  await page.keyboard.type(words.slice(0, 60).join(' ') + ' ', { delay: 2 });
  await page.waitForTimeout(700);
  check('breaker stays unarmed under 100 words', (await status()) === 'unarmed', `state=${await status()}`);
  await page.keyboard.type(words.slice(60).join(' '), { delay: 2 });
  await page.waitForTimeout(900);
  check('breaker fires in real time once past 100 words', (await status()) === 'active', `state=${await status()}`);
  check('co-pilot switches to step-back strategy', await page.getByText('Your writing is circling').isVisible());
  await shot('04-live-rumination-detected');

  // Ctrl+Enter now asks for a distancing prompt, inline, with an answer paragraph.
  await page.keyboard.press('Control+Enter');
  const anchored = page.locator('[data-anchored-question]');
  await anchored.first().waitFor({ timeout: 10000 });
  await page.waitForFunction(() => !document.querySelector('[data-anchored-question] .nr-caret'), null, { timeout: 15000 });
  const qText = await anchored.first().innerText();
  check('Ctrl+Enter produces a step-back prompt inline', /A step back/.test(qText), qText.split('\n')[1]?.slice(0, 70));
  const answer = 'Looking back, I realise it was one bad moment, and because I was exhausted it felt bigger. Perhaps I could ask for feedback tomorrow, although it might feel awkward.';
  await page.keyboard.type(answer, { delay: 2 });
  await page.waitForTimeout(600);
  await shot('05-step-back-prompt-answered');

  // Hover-to-reframe on a fused phrase.
  const mark = page.locator('.nr-mark-fused').first();
  const box = await mark.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const reframe = page.getByRole('dialog', { name: 'Reframe suggestion' });
  await reframe.waitFor({ timeout: 4000 });
  check('hovering a fused phrase opens the reframe card', true);
  await page.waitForTimeout(450); // let the fade-in finish before capturing
  await shot('06-reframe-card');
  const before = await page.locator('[data-testid="rumination-status"]').evaluate(() => document.body.innerText.match(/Defusion\s+(\d+)/)?.[1]);
  await reframe.getByRole('button', { name: 'Rewrite as a noticed thought' }).click();
  await page.waitForTimeout(700);
  const allText = await page.locator('textarea').evaluateAll((els) => els.map((e) => e.value).join(' '));
  check('reframe rewrites the sentence as a noticed thought', allText.includes("I'm noticing the thought that"));
  const after = await page.evaluate(() => document.body.innerText.match(/Defusion\s+(\d+)/)?.[1]);
  check('defusion score rises after reframing', Number(after) > Number(before), `${before} -> ${after}`);

  // Ctrl+K lens picker, CBT thought record.
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog', { name: 'Mental model lenses and actions' }).waitFor();
  await page.keyboard.type('CBT');
  await page.keyboard.press('Enter');
  await page.getByText('Automatic thought:', { exact: false }).first().waitFor({ timeout: 15000 });
  check('Ctrl+K lens picker runs the CBT thought record', true);
  await page.waitForTimeout(1200);
  await shot('07-cbt-lens');

  // Forecast an upcoming event.
  await page.getByRole('button', { name: 'Forecast', exact: true }).click();
  await page.getByLabel('Event', { exact: true }).fill('Feedback conversation');
  await page.getByRole('button', { name: 'Save forecast' }).click();
  await page.getByText(/Feedback conversation, /).waitFor({ timeout: 5000 });
  check('forecast saved and linked to the entry', true);

  // Finish the entry: synthesis, values, remembered entities.
  await page.keyboard.press('Control+Shift+Enter');
  await page.getByText('Key takeaway').waitFor({ timeout: 20000 });
  check('finishing produces a synthesis', await page.getByText('One micro-action').isVisible());
  check('finishing extracts entities for the graph', (await page.getByText('Remembered from this entry').count()) === 1);
  await shot('08-synthesis');

  // Name-it tab with the emotion wheel.
  await page.getByRole('tab', { name: 'Name it' }).click();
  await page.getByRole('group', { name: 'Emotion families' }).waitFor();
  check('emotion wheel renders', true);
  await shot('09-name-it');

  // Dashboard.
  await page.getByTitle('Telemetry (Alt+2)').click();
  await page.getByTestId('hero-error').waitFor({ timeout: 10000 });
  const hero = await page.getByTestId('hero-error').innerText();
  check('dashboard hero shows average forecast error', /^[+-]?\d+$/.test(hero.trim()), hero.trim());
  check('dashboard draws line charts', (await page.locator('.recharts-line').count()) >= 3, `${await page.locator('.recharts-line').count()} series`);
  check('dashboard draws error columns', (await page.locator('.recharts-bar-rectangle').count()) >= 3);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, '10-dashboard.png') });
  // The dashboard scrolls inside its own container; capture the lower charts too.
  await page.getByText('Self-focus and sense-making').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot('10b-dashboard-lower');
  await page.getByRole('heading', { name: 'Psychological telemetry' }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Show table' }).first().click();
  check('chart table view available', (await page.locator('table').count()) >= 1);

  // Memory graph.
  await page.getByTitle('Memory (Alt+3)').click();
  await page.getByTestId('graph-canvas').locator('canvas').first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(3500);
  check('memory graph renders a canvas', true);
  await shot('11-graph');
  // Find a node by name (the keyboard route into the canvas); the graph
  // centres it in the visible area and opens its panel.
  const panel = page.getByRole('complementary', { name: 'Selected item' });
  await page.getByRole('combobox', { name: 'Find in graph' }).fill('pri');
  await page.getByRole('option', { name: /Priya/ }).click();
  await panel.waitFor({ timeout: 5000 });
  check('finding a node by name opens its linked entries', (await panel.getByRole('heading', { name: 'Priya' }).count()) === 1);
  await page.waitForTimeout(900);
  await shot('12-graph-node-panel');
  // Close the panel, then click the node itself on the canvas.
  await panel.getByRole('button', { name: 'Close' }).click();
  const canvasBox = await page.getByTestId('graph-canvas').boundingBox();
  await page.mouse.click(canvasBox.x + (canvasBox.width - 360) / 2, canvasBox.y + canvasBox.height / 2);
  const clicked = await panel.waitFor({ timeout: 3000 }).then(
    () => true,
    () => false,
  );
  check('clicking a node on the canvas opens its panel', clicked && (await panel.getByRole('heading', { name: 'Priya' }).count()) === 1);

  // Timeline explorer.
  await page.getByRole('radio', { name: 'Timeline' }).click();
  const lanes = page.getByTestId('timeline-lanes');
  await lanes.waitFor({ timeout: 10000 });
  const laneCount = await lanes.locator('svg[role="img"]').count();
  check('timeline draws a lane per person, theme, value and pattern', laneCount >= 10, `${laneCount} lanes`);
  const timelineList = page.getByTestId('timeline-entries');
  check('timeline lists every entry in range', (await timelineList.locator('li button').count()) === 5);
  await shot('12b-timeline');
  const priyaMark = lanes.locator('svg[aria-label^="Person Priya"] g.cursor-pointer').first();
  const pm = await priyaMark.boundingBox();
  await page.mouse.move(pm.x + pm.width / 2, pm.y + pm.height / 2);
  await page.getByRole('tooltip').waitFor({ timeout: 3000 });
  check('hovering a timeline mark shows where the person appears', (await page.getByRole('tooltip').innerText()).includes('Person: Priya'));
  await shot('12c-timeline-hover');
  await page.mouse.move(10, 500);
  await lanes.getByRole('button', { name: /^Priya/ }).click();
  const priyaEntries = await timelineList.locator('li button').count();
  check('selecting a lane filters the entries to that person', priyaEntries === 3, `${priyaEntries} entries`);
  await page.getByLabel('Search entries').fill('freeze');
  await page.waitForTimeout(200);
  check('timeline search narrows the list and highlights the match', (await timelineList.locator('li button').count()) === 1 && (await timelineList.locator('mark').first().innerText()).toLowerCase() === 'freeze');
  await shot('12d-timeline-search');
  await timelineList.locator('li button').first().click();
  await page.getByRole('button', { name: /^Finish$|^Re-finish$/ }).waitFor({ timeout: 10000 });
  check('choosing an entry on the timeline opens it in the journal', (await page.locator('textarea').evaluateAll((els) => els.map((e) => e.value).join(' '))).includes('Everyone thinks I am useless'));
  await page.getByTitle('Memory (Alt+3)').click();
  await page.getByRole('radio', { name: 'Graph' }).click();

  // Settings and vault: export raw, export encrypted, re-import encrypted.
  await page.getByTitle('Vault (Alt+4)').click();
  await page.getByRole('heading', { name: 'Settings and vault' }).waitFor();
  await shot('13-settings');
  const [rawDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Readable JSON' }).click()]);
  const rawPath = path.join(SHOTS, 'export-raw.json');
  await rawDl.saveAs(rawPath);
  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  check('readable export contains all entries', raw.tables.entries.length === 5, `${raw.tables.entries.length} entries`);
  check('export leaves API keys out by default', raw.tables.settings[0].value.provider.anthropicKey === '');
  await page.getByLabel('Export passphrase').fill('correct horse battery');
  const [encDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Encrypted export/ }).click()]);
  const encPath = path.join(SHOTS, 'export-encrypted.json');
  await encDl.saveAs(encPath);
  const enc = JSON.parse(fs.readFileSync(encPath, 'utf8'));
  check('encrypted export hides content', enc.format === 'encrypted' && !fs.readFileSync(encPath, 'utf8').includes('Review meeting'));
  await page.locator('input[type=file]').setInputFiles(encPath);
  await page.getByLabel('Import passphrase').fill('wrong passphrase');
  await page.getByRole('button', { name: 'Replace my journal' }).click();
  await page.getByText('That passphrase does not unlock this file.').waitFor({ timeout: 15000 });
  check('wrong passphrase is rejected', true);
  await page.getByLabel('Import passphrase').fill('correct horse battery');
  await page.getByRole('button', { name: 'Replace my journal' }).click();
  await page.getByRole('button', { name: /^Finish$|^Re-finish$/ }).waitFor({ timeout: 20000 });
  check('encrypted import restores and returns to the journal', true);

  // Persistence across reload.
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^Finish$|^Re-finish$/ }).waitFor({ timeout: 30000 });
  const railAfter = page.getByRole('complementary', { name: 'Entries' });
  check('entries persist across reload', (await railAfter.getByText(/I feel awful/).count()) >= 1 && (await railAfter.getByText('Review meeting', { exact: true }).count()) === 1);
} catch (err) {
  check('test run completed without an exception', false, err.message.split('\n')[0]);
  await shot('99-failure').catch(() => undefined);
}

const relevantErrors = consoleErrors.filter((e) => !/Download the React DevTools/.test(e));
check('zero console errors', relevantErrors.length === 0, relevantErrors.slice(0, 5).join(' | '));
check('zero hydration warnings', ![...consoleErrors, ...consoleWarnings].some((e) => /hydrat/i.test(e)));
if (consoleWarnings.length) console.log(`\nConsole warnings (${consoleWarnings.length}):\n  ${[...new Set(consoleWarnings)].slice(0, 8).join('\n  ')}`);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} of ${results.length} checks failed` : `\nAll ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
