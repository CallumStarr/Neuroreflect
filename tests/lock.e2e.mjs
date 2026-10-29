// Browser checks for the passphrase lock. Usage:
//   npm run dev   (in another terminal)
//   node tests/lock.e2e.mjs [baseUrl] [screenshotDir]
import path from 'node:path';
import { startSuite, storedText, waitForJournal } from './e2e-helpers.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const SHOTS = process.argv[3] ?? path.resolve('tests/screenshots');
const PASS = 'tin mine harbour lantern';
const PASS2 = 'gull slate tide kettle';

const { page, context, check, shot, finish, attach } = await startSuite({ base: BASE, shots: SHOTS });
const rail = () => page.getByRole('complementary', { name: 'Entries' });
const lockHeading = (p = page) => p.getByRole('heading', { name: 'Your journal is locked' });
// The storage note in the sidebar; the Vault's own copy also mentions the device.
const storageNote = (text) => page.getByRole('navigation', { name: 'Main' }).getByText(text, { exact: true });

async function unlockWith(p, passphrase) {
  await p.getByLabel('Passphrase', { exact: true }).fill(passphrase);
  await p.getByRole('button', { name: 'Unlock' }).click();
}

async function openVault() {
  await page.getByTitle('Vault (Alt+5)').click();
  await page.getByRole('heading', { name: 'Settings and vault' }).waitFor();
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await waitForJournal(page);
  check('app boots with the lock off', (await storageNote('Stored on this device').count()) === 1);
  check('records are readable in storage before encryption', (await storedText(page)).includes('Review meeting'));

  // Turn encryption on.
  await openVault();
  await page.getByLabel('New passphrase').fill(PASS);
  await page.getByLabel('Type it again').fill(PASS);
  await page.getByText('I understand that nobody can recover').click();
  await shot('20-lock-setup');
  await page.getByRole('button', { name: 'Turn on encryption' }).click();
  await page.getByTestId('lock-on').waitFor({ timeout: 20000 });
  const sealed = await storedText(page);
  const leaks = ['Review meeting', 'Priya', 'useless', 'Dentist appointment', 'Showing up for Sam'].filter((s) => sealed.includes(s));
  check('turning encryption on seals every record in storage', leaks.length === 0 && sealed.includes('$sealed'), leaks.join(', '));
  check('sidebar reports encryption and offers Lock', (await storageNote('Encrypted on this device').count()) === 1 && (await page.getByTitle('Lock now (Alt+L)').count()) === 1);
  await shot('21-lock-on');

  // A fresh page load starts locked.
  await page.reload({ waitUntil: 'networkidle' });
  await lockHeading().waitFor({ timeout: 15000 });
  check('reloading shows the lock screen', true);
  check('nothing from the journal is on the lock screen', !(await page.locator('body').innerText()).includes('Review meeting'));
  await page.waitForTimeout(1500);
  await shot('22-lock-screen');
  await unlockWith(page, 'not my passphrase');
  await page.getByText('That passphrase does not unlock this journal.').waitFor({ timeout: 15000 });
  check('a wrong passphrase is refused', true);
  await shot('23-lock-wrong');
  await unlockWith(page, PASS);
  await waitForJournal(page);
  await rail().getByText('Review meeting', { exact: true }).waitFor({ timeout: 10000 }).then(
    () => check('the right passphrase opens the journal', true),
    () => check('the right passphrase opens the journal', false),
  );

  // Writing while encrypted.
  await page.keyboard.press('Alt+n');
  await page.waitForTimeout(400);
  await page.getByRole('textbox', { name: 'Paragraph 1' }).click();
  await page.keyboard.type('Walked to the harbour with Morwenna and talked about the boat.', { delay: 4 });
  await page.waitForTimeout(1500);
  check('new writing is sealed when autosaved', !(await storedText(page)).includes('Morwenna'));

  // Lock straight after typing: unsaved words must survive.
  await page.keyboard.type(' Then the rain came in sideways.', { delay: 2 });
  await page.keyboard.press('Alt+l');
  await lockHeading().waitFor({ timeout: 10000 });
  check('Alt+L locks the journal', true);
  await unlockWith(page, PASS);
  await waitForJournal(page);
  await page.waitForTimeout(500);
  const text = await page.locator('textarea').evaluateAll((els) => els.map((e) => e.value).join(' '));
  check('words typed just before locking were saved', text.includes('Morwenna') && text.includes('rain came in sideways'), text.slice(0, 90));
  check('the stored copy of those words is sealed', !(await storedText(page)).includes('sideways'));

  // Only one tab is unlocked at a time.
  const second = await context.newPage();
  attach(second);
  await second.goto(BASE, { waitUntil: 'networkidle' });
  await lockHeading(second).waitFor({ timeout: 15000 });
  check('a second tab opens locked', true);
  await unlockWith(second, PASS);
  await waitForJournal(second);
  await lockHeading(page).waitFor({ timeout: 10000 });
  check('unlocking the second tab locks the first', true);
  await second.close();
  await unlockWith(page, PASS);
  await waitForJournal(page);

  // Auto-lock after the chosen idle time. A simulated clock, installed before
  // the setting changes so the idle timer runs on it, skips the wait.
  await page.clock.install();
  await openVault();
  await page.getByLabel('Lock after').selectOption('5');
  await page.waitForTimeout(400);
  check('auto-lock time is saved', (await storedText(page)).includes('"autoLockMinutes":5'));
  await page.clock.fastForward('04:00');
  await page.waitForTimeout(300);
  check('the journal stays open before the idle time is up', (await lockHeading().count()) === 0);
  await page.clock.fastForward('02:00');
  await lockHeading().waitFor({ timeout: 20000 }).then(
    () => check('the journal locks itself after 5 idle minutes', true),
    () => check('the journal locks itself after 5 idle minutes', false),
  );
  if (await lockHeading().count()) {
    await unlockWith(page, PASS);
    // Unlocking returns to the view that was open, here the vault.
    await page.getByRole('heading', { name: 'Settings and vault' }).waitFor({ timeout: 15000 });
    check('unlocking returns to the view that was open', true);
  }

  // Change the passphrase.
  await openVault();
  await page.getByText('Change passphrase', { exact: true }).first().click();
  await page.getByLabel('Current', { exact: true }).fill(PASS);
  await page.getByLabel('New', { exact: true }).fill(PASS2);
  await page.getByLabel('New, again').fill(PASS2);
  await page.getByRole('button', { name: 'Change passphrase' }).click();
  await page.getByText('Passphrase changed.', { exact: false }).waitFor({ timeout: 20000 });
  await page.keyboard.press('Alt+l');
  await lockHeading().waitFor();
  await unlockWith(page, PASS);
  await page.getByText('That passphrase does not unlock this journal.').waitFor({ timeout: 15000 });
  await unlockWith(page, PASS2);
  await page.getByRole('heading', { name: 'Settings and vault' }).waitFor({ timeout: 15000 });
  check('after a change only the new passphrase unlocks', true);

  // Turn encryption off.
  await openVault();
  await page.getByText('Turn off encryption', { exact: true }).first().click();
  await page.getByLabel('Current passphrase').fill(PASS2);
  await page.getByRole('button', { name: 'Turn off encryption' }).click();
  await page.getByText('Encryption is off.', { exact: false }).waitFor({ timeout: 20000 });
  const plain = await storedText(page);
  check('turning encryption off stores records readable again', plain.includes('Review meeting') && plain.includes('Morwenna') && !plain.includes('$sealed'));
  check('sidebar reports plain storage again', (await storageNote('Stored on this device').count()) === 1);
  await shot('24-lock-off-again');

  // Forgotten passphrase: erase from the lock screen.
  await page.getByLabel('New passphrase').fill(PASS);
  await page.getByLabel('Type it again').fill(PASS);
  await page.getByText('I understand that nobody can recover').click();
  await page.getByRole('button', { name: 'Turn on encryption' }).click();
  await page.getByTestId('lock-on').waitFor({ timeout: 20000 });
  await page.reload({ waitUntil: 'networkidle' });
  await lockHeading().waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Forgotten your passphrase?' }).click();
  await page.getByLabel('Type erase to confirm').fill('erase');
  await shot('25-lock-forgotten');
  await page.getByRole('button', { name: 'Erase this journal' }).click();
  await waitForJournal(page);
  await page.waitForTimeout(600);
  check('erasing from the lock screen opens an empty journal without the lock', (await rail().getByText('Review meeting', { exact: true }).count()) === 0 && (await storageNote('Stored on this device').count()) === 1);
} catch (err) {
  check('lock checks completed without an exception', false, err.message.split('\n')[0]);
  await shot('99-lock-failure').catch(() => undefined);
}

process.exit((await finish()) ? 1 : 0);
