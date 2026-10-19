// Browser checks at phone widths, with touch. The Journal view does not fit a
// phone yet, so it is left out; everything else should. Usage:
//   npm run dev   (in another terminal)
//   node tests/mobile.e2e.mjs [baseUrl] [screenshotDir]
import path from 'node:path';
import { startSuite, waitForJournal } from './e2e-helpers.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const SHOTS = process.argv[3] ?? path.join('tests', 'screenshots', 'mobile');
const PHONE = { width: 390, height: 844 };

const { page, context, check, shot, finish } = await startSuite({
  base: BASE,
  shots: SHOTS,
  viewport: PHONE,
  contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
});

// Visible content past the right edge, unless it sits inside something that is
// meant to scroll sideways and actually can.
const pastTheEdge = () =>
  page.evaluate(() => {
    const W = window.innerWidth;
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.right <= W + 1) continue;
      let p = el.parentElement;
      let scrolls = false;
      while (p && p !== document.documentElement) {
        const cs = getComputedStyle(p);
        if (['auto', 'scroll'].includes(cs.overflowX) && p.scrollWidth > p.clientWidth && p.getBoundingClientRect().right <= W + 1) {
          scrolls = true;
          break;
        }
        p = p.parentElement;
      }
      if (!scrolls && !out.some((o) => o.contains(el))) out.push(el);
    }
    // Containers that scroll sideways count too: on a phone that is a layout bug.
    const sideways = [...document.querySelectorAll('body *')].filter((el) => {
      const cs = getComputedStyle(el);
      return ['auto', 'scroll'].includes(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > W * 0.6;
    });
    return [...out, ...sideways].slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')}`);
  });

// The bottom bar: every part on screen, nothing overlapping, labels inside their buttons.
const barProblems = () =>
  page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Main"]');
    const W = window.innerWidth;
    const parts = [...nav.querySelectorAll('li > button, :scope > button, :scope > p')]
      .filter((el) => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0)
      .map((el) => ({ name: (el.getAttribute('aria-label') || el.textContent).trim(), r: el.getBoundingClientRect() }));
    const problems = [];
    for (const p of parts) if (p.r.right > W + 0.5 || p.r.left < -0.5) problems.push(`${p.name} off screen`);
    for (let i = 0; i < parts.length; i++)
      for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i].r;
        const b = parts[j].r;
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5) problems.push(`${parts[i].name} overlaps ${parts[j].name}`);
      }
    for (const btn of nav.querySelectorAll('li > button')) {
      const s = btn.querySelector('span');
      const rb = btn.getBoundingClientRect();
      const rs = s.getBoundingClientRect();
      if (rs.left < rb.left - 0.5 || rs.right > rb.right + 0.5) problems.push(`"${s.textContent}" spills out of its button`);
    }
    return problems;
  });

async function barAt(widths, label) {
  const problems = [];
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: PHONE.height });
    await page.waitForTimeout(200);
    for (const p of await barProblems()) problems.push(`${w}px: ${p}`);
  }
  await page.setViewportSize(PHONE);
  check(`the bottom bar fits from 320 to 414 px ${label}`, problems.length === 0, problems.slice(0, 3).join('; '));
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await waitForJournal(page);
  await barAt([320, 360, 390, 414], 'with the lock off');

  for (const [name, go] of [
    ['Telemetry', () => page.keyboard.press('Alt+2')],
    ['Memory graph', () => page.keyboard.press('Alt+3')],
    ['Memory timeline', () => page.getByRole('radio', { name: 'Timeline' }).click()],
    ['Recall', () => page.getByRole('radio', { name: 'Recall' }).click()],
    ['Vault', () => page.keyboard.press('Alt+4')],
  ]) {
    await go();
    const past = [];
    for (const w of [360, 390]) {
      await page.setViewportSize({ width: w, height: PHONE.height });
      await page.waitForTimeout(600);
      for (const p of await pastTheEdge()) past.push(`${w}px: ${p}`);
    }
    await page.setViewportSize(PHONE);
    check(`${name} fits a 360 and a 390 px screen`, past.length === 0, past.join(', '));
  }
  const sliderProblems = [];
  for (const w of [360, 390]) {
    await page.setViewportSize({ width: w, height: PHONE.height });
    await page.waitForTimeout(300);
    const found = await page.evaluate(() => {
      const W = window.innerWidth;
      return [...document.querySelectorAll('input[type=range]')].flatMap((range) => {
        const a = range.getBoundingClientRect();
        const b = range.nextElementSibling.getBoundingClientRect();
        const out = [];
        if (a.right > W + 0.5 || b.right > W + 0.5) out.push(`${range.id} runs off the screen`);
        if (a.right > b.left + 0.5 && a.bottom > b.top && b.bottom > a.top) out.push(`${range.id} covers its value`);
        return out;
      });
    });
    for (const p of found) sliderProblems.push(`${w}px: ${p}`);
  }
  await page.setViewportSize(PHONE);
  check('each threshold value is visible beside its slider', sliderProblems.length === 0, sliderProblems.slice(0, 3).join('; '));
  await page.locator('#th-minWords').scrollIntoViewIfNeeded();
  await shot('01-vault-sliders');

  // Recall on a phone: one column that switches between the answer and the threads.
  await page.keyboard.press('Alt+3');
  await page.getByRole('radio', { name: 'Recall' }).click();
  await page.getByRole('textbox', { name: 'Ask your journal' }).fill('When did I feel relief?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.getByTestId('answer-note').first().waitFor({ timeout: 20000 });
  check('Recall answers on a phone with its passages', (await page.getByText('From your entries').isVisible()) && (await pastTheEdge()).length === 0);
  await shot('02-recall-answer');
  await page.getByRole('radio', { name: 'Threads and chapters' }).click();
  check(
    'the threads and chapters open in place of the answer',
    (await page.getByRole('heading', { name: 'Threads' }).isVisible()) &&
      (await page.getByRole('heading', { name: 'Chapters' }).isVisible()) &&
      !(await page.getByRole('textbox', { name: 'Ask your journal' }).isVisible()),
  );
  await shot('03-recall-threads');
  await page.getByRole('button', { name: 'New chat' }).click();
  const cleared = await page
    .waitForFunction(() => !document.querySelector('[data-testid="answer-note"]') && !!document.querySelector('input[aria-label="Ask your journal"]')?.offsetParent, null, { timeout: 5000 })
    .then(() => true, () => false);
  await page.getByLabel('Earlier recall chats').selectOption({ label: 'When did I feel relief?' });
  await page.getByTestId('answer-note').first().waitFor({ timeout: 5000 });
  check('New chat clears the conversation and the earlier one can be reopened', cleared);

  // A threshold slider dragged by touch is saved.
  await page.keyboard.press('Alt+4');
  const slider = page.locator('#th-minWords');
  await slider.scrollIntoViewIfNeeded();
  const before = await slider.inputValue();
  const box = await slider.boundingBox();
  const min = Number(await slider.getAttribute('min'));
  const max = Number(await slider.getAttribute('max'));
  const x0 = box.x + 8 + ((Number(before) - min) / (max - min)) * (box.width - 16);
  const y = box.y + box.height / 2;
  const cdp = await context.newCDPSession(page);
  const touch = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', x0);
  for (let i = 1; i <= 8; i++) {
    await touch('touchMove', x0 + i * 6);
    await page.waitForTimeout(30);
  }
  await touch('touchEnd', x0 + 48);
  await page.waitForTimeout(600);
  const dragged = await slider.inputValue();
  await page.reload({ waitUntil: 'networkidle' });
  await waitForJournal(page);
  await page.keyboard.press('Alt+4');
  const saved = await page.locator('#th-minWords').inputValue();
  check('a threshold slider dragged by touch is saved', dragged !== before && saved === dragged, `${before} -> ${dragged}, after reload ${saved}`);
  await page.getByRole('button', { name: 'Reset to defaults' }).click();

  // With the lock on, the bar gains a Lock button; it still has to fit.
  await page.getByLabel('New passphrase').fill('correct horse battery staple');
  await page.getByLabel('Type it again').fill('correct horse battery staple');
  await page.getByText('I understand that nobody can recover').click();
  await page.getByRole('button', { name: 'Turn on encryption' }).click();
  await page.getByTestId('lock-on').waitFor({ timeout: 30000 });
  await barAt([320, 360, 390, 414], 'with the Lock button');
  await shot('04-bar-locked');

  // On a wide screen Recall goes back to three columns.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.keyboard.press('Alt+3');
  await page.getByRole('radio', { name: 'Recall' }).click();
  const cols = await page.evaluate(() => getComputedStyle(document.querySelector('[class*="lg:grid-cols"]')).gridTemplateColumns.split(' ').length);
  check('Recall shows three columns on a wide screen', cols === 3 && (await page.getByRole('button', { name: 'New recall chat' }).isVisible()), `${cols} columns`);
} catch (err) {
  check('mobile checks completed without an exception', false, err.message.split('\n')[0]);
  await shot('99-mobile-failure').catch(() => undefined);
}

process.exit((await finish()) ? 1 : 0);
