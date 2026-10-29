// Shared set-up for the browser checks: a real Chromium, console capture and a
// tally of results.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

export function launchOptions() {
  const opts = { headless: true };
  const bundled = '/opt/pw-browsers/chromium';
  if (fs.existsSync(bundled) && fs.statSync(bundled).isFile()) opts.executablePath = bundled;
  else if (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')) opts.executablePath = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  return opts;
}

export async function startSuite({ base, shots, viewport = { width: 1600, height: 1000 }, contextOptions = {} }) {
  fs.mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ viewport, acceptDownloads: true, ...contextOptions });
  const page = await context.newPage();
  const consoleErrors = [];
  const consoleWarnings = [];
  const attach = (p) => {
    p.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
      if (msg.type() === 'warning') consoleWarnings.push(msg.text());
    });
    p.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
  };
  attach(page);
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  };
  const shot = (name, p = page) => p.screenshot({ path: path.join(shots, `${name}.png`) });

  async function finish({ allowConsole = [] } = {}) {
    const relevant = consoleErrors.filter((e) => !/Download the React DevTools/.test(e) && !allowConsole.some((re) => re.test(e)));
    check('zero console errors', relevant.length === 0, relevant.slice(0, 5).join(' | '));
    check('zero hydration warnings', ![...consoleErrors, ...consoleWarnings].some((e) => /hydrat/i.test(e)));
    if (consoleWarnings.length) console.log(`\nConsole warnings (${consoleWarnings.length}):\n  ${[...new Set(consoleWarnings)].slice(0, 8).join('\n  ')}`);
    await browser.close();
    const failed = results.filter((r) => !r.ok);
    console.log(failed.length ? `\n${failed.length} of ${results.length} checks failed` : `\nAll ${results.length} checks passed`);
    return failed.length;
  }

  return { browser, context, page, check, shot, finish, attach, consoleErrors };
}

/** Everything IndexedDB holds for the app, as text, read with the raw API (no app code). */
export async function storedText(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('neuroreflect');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const names = [...db.objectStoreNames];
          const tx = db.transaction(names, 'readonly');
          const out = {};
          let pending = names.length;
          for (const n of names) {
            const r = tx.objectStore(n).getAll();
            r.onsuccess = () => {
              out[n] = r.result;
              if (--pending === 0) {
                db.close();
                resolve(JSON.stringify(out, (_k, v) => (v instanceof Uint8Array ? `<${v.length} bytes>` : v)));
              }
            };
          }
        };
      }),
  );
}

/** True once an entry with this title is in storage, read with the raw API. */
export async function hasStoredEntry(page, title) {
  return page.evaluate(
    (wanted) =>
      new Promise((resolve) => {
        const req = indexedDB.open('neuroreflect');
        req.onerror = () => resolve(false);
        req.onsuccess = () => {
          const db = req.result;
          try {
            const all = db.transaction('entries', 'readonly').objectStore('entries').getAll();
            all.onsuccess = () => {
              db.close();
              resolve(all.result.some((e) => e.title === wanted));
            };
            all.onerror = () => {
              db.close();
              resolve(false);
            };
          } catch {
            db.close();
            resolve(false);
          }
        };
      }),
    title,
  );
}

/**
 * Waits for the journal. A brand-new journal opens on the first session; these
 * checks explore with the sample entries instead, as a new person can.
 */
export async function waitForJournal(page, timeout = 30000) {
  const welcome = page.getByRole('button', { name: 'Explore with sample entries first' });
  const finish = page.getByRole('button', { name: /^Finish$|^Re-finish$/ });
  await welcome.or(finish).first().waitFor({ timeout });
  // The welcome can appear a moment after the journal does.
  await page.waitForTimeout(300);
  if (await welcome.isVisible()) {
    await welcome.click();
    // The welcome closes once the samples are saved. The entries list is folded
    // away on a phone, so check storage rather than the list. waitForFunction
    // would not wait for a promise, so poll.
    await page.getByTestId('welcome-dialog').waitFor({ state: 'hidden', timeout });
    const until = Date.now() + timeout;
    while (!(await hasStoredEntry(page, 'Review meeting'))) {
      if (Date.now() > until) throw new Error('the sample entries were not saved');
      await page.waitForTimeout(250);
    }
  }
  await finish.waitFor({ timeout });
}
