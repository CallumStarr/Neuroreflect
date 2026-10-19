// Offline check: after one online visit the service worker serves the app shell
// with the network cut, and journal data is still there. Needs `npm start` (production build).
//   node tests/offline.e2e.mjs [baseUrl]
import path from 'node:path';
import { startSuite, waitForJournal } from './e2e-helpers.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const { page, context, check, finish } = await startSuite({
  base: BASE,
  shots: path.join('tests', 'screenshots', 'offline'),
  viewport: { width: 1400, height: 900 },
});

try {
  await page.goto(BASE);
  await waitForJournal(page);

  // The worker only registers in a production build, so give up after a while
  // instead of waiting for ever against `npm run dev`.
  const ready = await page.evaluate(() =>
    Promise.race([navigator.serviceWorker.ready.then((reg) => Boolean(reg.active)), new Promise((r) => setTimeout(() => r(false), 15000))]),
  );
  check('service worker active', ready, ready ? '' : 'none registered: it only runs in a production build (npm run build, then npm start)');

  if (ready) {
    // Reload once so the page itself is controlled and its assets are cached.
    await page.reload();
    await waitForJournal(page);
    const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
    check('page controlled by service worker', controlled);

    await context.setOffline(true);
    await page.reload();
    await waitForJournal(page);
    check('app shell loads with the network off', true);
    const entries = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const open = indexedDB.databases ? indexedDB.databases() : Promise.resolve([]);
          open.then((dbs) => resolve(dbs.length));
        }),
    );
    check('local database still present offline', entries > 0);
    await context.setOffline(false);
  }
} catch (err) {
  check('offline checks completed without an exception', false, err.message.split('\n')[0]);
}

process.exit((await finish()) ? 1 : 0);
