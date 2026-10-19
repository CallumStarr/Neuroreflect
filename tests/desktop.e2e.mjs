// Checks the desktop app itself (the Tauri build), driven through WebDriver.
//
// Needs tauri-driver (cargo install tauri-driver --locked) and the platform's
// native driver: WebKitWebDriver on Linux, or msedgedriver matching the
// installed WebView2 on Windows (point TAURI_NATIVE_DRIVER at it). On Linux,
// run it inside a display and a D-Bus session, for example:
//   dbus-run-session -- xvfb-run -a node tests/desktop.e2e.mjs src-tauri/target/release/neuroreflect
// The save-dialog checks drive the dialog with xdotool, so they run on Linux only.
// The run starts from a fresh journal: it deletes the app's data folders first.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Builder, By, Capabilities, Key, until } from 'selenium-webdriver';

const APP = path.resolve(process.argv[2] ?? process.env.NEUROREFLECT_APP ?? 'src-tauri/target/release/neuroreflect');
const DRIVER = process.env.TAURI_DRIVER ?? 'tauri-driver';
const IDENTIFIER = JSON.parse(fs.readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')).identifier;
const LINUX = process.platform === 'linux';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

// Where a fresh journal starts. Linux: XDG folders; Windows: AppData.
function dataFolders() {
  if (LINUX) {
    const home = os.homedir();
    return [path.join(process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share'), IDENTIFIER), path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), IDENTIFIER)];
  }
  return [process.env.LOCALAPPDATA, process.env.APPDATA].filter(Boolean).map((p) => path.join(p, IDENTIFIER));
}

// A stand-in for Ollama on this computer that streams its answer word by word.
const ollamaRequests = [];
const ollama = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    ollamaRequests.push({ url: req.url, origin: req.headers.origin ?? null, body: body ? JSON.parse(body) : null });
    if (req.url !== '/api/chat') {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    const words = 'The presentation went better than you feared [1]. Waiting was the hard part [2]. '.match(/\S+\s*/g);
    let i = 0;
    const timer = setInterval(() => {
      if (i < words.length) res.write(`${JSON.stringify({ message: { role: 'assistant', content: words[i++] }, done: false })}\n`);
      else {
        clearInterval(timer);
        res.end(`${JSON.stringify({ done: true })}\n`);
      }
    }, 25);
  });
});
// Any page could read this one, if it were allowed to make requests at all.
const plain = http.createServer((_req, res) => {
  res.writeHead(200, { 'access-control-allow-origin': '*' });
  res.end('reachable');
});
await new Promise((r) => ollama.listen(0, '127.0.0.1', r));
await new Promise((r) => plain.listen(0, '127.0.0.1', r));
const OLLAMA_URL = `http://127.0.0.1:${ollama.address().port}`;
const PLAIN_URL = `http://127.0.0.1:${plain.address().port}/`;

for (const dir of dataFolders()) fs.rmSync(dir, { recursive: true, force: true });

const driverProc = spawn(DRIVER, process.env.TAURI_NATIVE_DRIVER ? ['--native-driver', process.env.TAURI_NATIVE_DRIVER] : [], { stdio: ['ignore', 'inherit', 'inherit'] });
for (let i = 0; i < 50; i++) {
  const up = await fetch('http://127.0.0.1:4444/status').then((r) => r.ok, () => false);
  if (up) break;
  await sleep(200);
}

async function openApp() {
  const caps = new Capabilities();
  caps.set('tauri:options', { application: APP });
  caps.setBrowserName('wry');
  const d = await new Builder().withCapabilities(caps).usingServer('http://127.0.0.1:4444/').build();
  await d.wait(until.elementLocated(By.xpath("//button[normalize-space()='Finish' or normalize-space()='Re-finish']")), 60000);
  return d;
}

// A copy that is still closing holds the single-instance lock, so a new launch
// in that moment hands over to it and exits. Wait until it has gone.
async function waitForAppExit() {
  const name = path.basename(APP);
  for (let i = 0; i < 75; i++) {
    const running = LINUX
      ? spawnSync('pgrep', ['-x', name.slice(0, 15)]).status === 0
      : spawnSync('tasklist', ['/FI', `IMAGENAME eq ${name}`], { encoding: 'utf8' }).stdout.includes(name);
    if (!running) return true;
    await sleep(200);
  }
  return false;
}

const byText = (tag, text) => By.xpath(`//${tag}[contains(normalize-space(.), ${JSON.stringify(text)})]`);
async function nav(d, label) {
  await d.findElement(By.css(`nav[aria-label="Main"] button[title^="${label} ("]`)).click();
  await sleep(500);
}
// Replaces a field's text by deleting it key by key, so React sees every change.
async function setField(d, id, value) {
  const el = await d.findElement(By.id(id));
  await el.click();
  const current = (await el.getAttribute('value')) ?? '';
  await el.sendKeys(Key.END, ...Array(current.length).fill(Key.BACK_SPACE), value, Key.TAB);
  await sleep(400);
  const now = await d.findElement(By.id(id)).getAttribute('value');
  if (now !== value) throw new Error(`could not set ${id}: it reads "${now}"`);
}
async function testConnection(d) {
  await d.findElement(byText('button', 'Test connection')).click();
  const result = await d.wait(until.elementLocated(By.xpath("//button[contains(., 'Test connection')]/following-sibling::p")), 30000);
  return result.getText();
}

// Answers the system save dialog by typing a path into it, or cancels it when no
// path is given (Linux, xdotool). The title comes from src-tauri/src/lib.rs.
const DIALOG_TITLE = 'Save your NeuroReflect export';
async function answerSaveDialog(filePath) {
  for (let i = 0; i < 40; i++) {
    const id = spawnSync('xdotool', ['search', '--onlyvisible', '--name', DIALOG_TITLE], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean)[0];
    if (id) {
      spawnSync('xdotool', ['windowfocus', '--sync', id]);
      await sleep(400);
      if (filePath) {
        spawnSync('xdotool', ['key', '--clearmodifiers', 'ctrl+a']);
        spawnSync('xdotool', ['type', '--delay', '15', filePath]);
        spawnSync('xdotool', ['key', 'Return']);
      } else {
        spawnSync('xdotool', ['key', 'Escape']);
      }
      return true;
    }
    await sleep(250);
  }
  return false;
}

let d;
try {
  d = await openApp();
  check('the desktop app opens the journal', true);

  const [secure, subtle, origin] = await d.executeScript('return [window.isSecureContext, !!(window.crypto && crypto.subtle), location.origin]');
  check('it runs in a secure context with WebCrypto, which the lock needs', secure && subtle, origin);

  const evalResult = await d.executeScript("try { eval('1'); return 'allowed'; } catch (e) { return 'blocked'; }");
  const direct = await d.executeAsyncScript(
    `const done = arguments[arguments.length - 1];
     fetch(${JSON.stringify(PLAIN_URL)}).then((r) => r.text()).then((t) => done('allowed: ' + t), (e) => done('blocked'));`,
  );
  check('the content security policy blocks eval and direct network requests', evalResult === 'blocked' && direct === 'blocked', `${evalResult}, ${direct}`);

  check('dictation is not offered in the desktop app', (await d.findElements(byText('button', 'Dictate'))).length === 0);

  // The browser build's offline service worker must stay out of the desktop app,
  // whose files are served by Tauri itself (this matters most on Windows).
  await sleep(1000);
  const workers = await d.executeAsyncScript(
    `const done = arguments[arguments.length - 1];
     if (!('serviceWorker' in navigator)) return done(0);
     navigator.serviceWorker.getRegistrations().then((r) => done(r.length), () => done(0));`,
  );
  check('the desktop app registers no service worker', workers === 0, `${workers} registered`);

  const outside = await d.executeAsyncScript(
    `const done = arguments[arguments.length - 1];
     window.__TAURI_INTERNALS__.invoke('plugin:http|fetch', { clientConfig: { method: 'GET', url: 'https://example.com/', headers: [], data: null } })
       .then(() => done('allowed'), (e) => done('refused: ' + String(e)));`,
  );
  check('the HTTP plugin refuses addresses outside its allowed list', outside.startsWith('refused'), outside.slice(0, 120));

  // Ollama on this computer, through the plugin.
  await nav(d, 'Vault');
  await d.findElement(By.xpath("//input[@type='radio' and @name='provider']/ancestor::label[contains(., 'Ollama')]")).click();
  await sleep(300);
  await setField(d, 's-ourl', OLLAMA_URL);
  const ok = await testConnection(d);
  check('Test connection streams a reply from Ollama on this computer', ok.startsWith('Responded'), ok);
  check('requests go out without a browser Origin header, so Ollama needs no OLLAMA_ORIGINS', ollamaRequests.length > 0 && ollamaRequests.every((r) => r.origin === null));
  const note = await d.findElement(byText('p', 'connects to Ollama on this computer only')).isDisplayed();
  check('the Ollama settings explain it must run on this computer', note);

  await setField(d, 's-ourl', 'http://192.168.1.50:11434');
  const away = await testConnection(d);
  check('Ollama on another machine is refused with a clear message', away.includes('this computer only'), away);
  await setField(d, 's-ourl', OLLAMA_URL);

  // Recall with Ollama: the answer streams in through the plugin.
  await nav(d, 'Memory');
  await d.findElement(By.xpath("//button[@role='radio' and normalize-space()='Recall']")).click();
  await sleep(500);
  const before = ollamaRequests.length;
  await d.findElement(By.css('input[aria-label="Ask your journal"]')).sendKeys('What happened with the presentation?', Key.ENTER);
  const answerNote = await d.wait(until.elementLocated(byText('p', 'Written by Ollama')), 30000);
  const article = await answerNote.findElement(By.xpath('ancestor::article'));
  const text = await article.getText();
  const sent = ollamaRequests.slice(before).find((r) => r.url === '/api/chat');
  const system = sent?.body?.messages?.find((m) => m.role === 'system')?.content ?? '';
  check('Recall shows an Ollama answer streamed through the plugin, with its citations', text.includes('went better than you feared [1]'), (await answerNote.getText()).slice(0, 80));
  check('the request carried the shared safety rules', system.includes('Samaritans'));

  if (LINUX) {
    await nav(d, 'Vault');
    const target = path.join(os.tmpdir(), `neuroreflect-desktop-${Date.now()}.json`);
    await d.findElement(byText('button', 'Readable JSON')).click();
    const dialog = await answerSaveDialog(target);
    await d.wait(until.elementLocated(byText('p', 'Exported as readable JSON')), 15000).catch(() => null);
    let saved = null;
    try {
      saved = JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch {
      /* not written */
    }
    check('an export is written where the save dialog says', saved?.app === 'neuroreflect' && Array.isArray(saved?.tables?.entries) && saved.tables.entries.length > 0, dialog ? target : 'no save dialog appeared');

    await d.findElement(byText('button', 'Readable JSON')).click();
    await answerSaveDialog(null);
    await sleep(800);
    check('cancelling the save dialog saves nothing and shows no message', (await d.findElements(byText('p', 'Exported as readable JSON'))).length === 0);
  }

  // Settings survive closing and reopening the app.
  await nav(d, 'Vault');
  await setField(d, 's-name', 'Desktop check');
  await sleep(600);
  await d.quit();
  if (!(await waitForAppExit())) throw new Error('the app did not close');
  d = await openApp();
  await nav(d, 'Vault');
  const name = await d.findElement(By.id('s-name')).getAttribute('value');
  check('the journal and settings survive closing and reopening the app', name === 'Desktop check', name);

  // A second launch hands over to the open window and exits.
  const second = spawnSync(APP, [], { timeout: 15000 });
  const stillThere = await d.executeScript('return document.title').then(() => true, () => false);
  check('opening the app again does not start a second copy', second.status === 0 && !second.error && stillThere, second.error ? second.error.message : `exit ${second.status}`);

  for (const dir of dataFolders()) {
    if (fs.existsSync(dir)) console.log(`  info data folder: ${dir}`);
  }
} catch (err) {
  check('desktop checks completed without an exception', false, String(err.message ?? err).split('\n')[0]);
} finally {
  await d?.quit().catch(() => undefined);
  driverProc.kill();
  ollama.close();
  plain.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} of ${results.length} checks failed` : `\nAll ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
