# NeuroReflect

A private reflective journal for the desktop. As you write, it measures the language of the entry (self-focus, affect, sense-making, cognitive fusion, emotional granularity), notices rumination loops in real time and switches its prompts to self-distancing, and keeps a private map of the people, themes and values that recur. An AI co-pilot is optional: every feature works with the built-in engine, and Ollama, Anthropic or OpenAI can be added with your own key or local model.

The clean-room analysis and the design behind the build are in `ARCHITECTURE_SPEC.md`.

Everything is stored on the computer, in the app's own storage. Nothing is uploaded unless you choose a cloud AI provider, and then only when you ask for a prompt, ask a question in Recall, or finish an entry.

## Desktop app

NeuroReflect is built as a desktop app with [Tauri 2](https://v2.tauri.app): the screens in `app/`, `components/` and `lib/` open in their own window, and `src-tauri/` holds the small Rust shell around them.

### Build it on Windows

Install these once:

1. Microsoft C++ Build Tools, with the "Desktop development with C++" workload.
2. Rust, through rustup, with the default `stable-msvc` toolchain.
3. Node.js 20 or newer.

WebView2, which draws the window, is already part of Windows 10 (version 1803 and later) and Windows 11.

```
npm install
npm run desktop:dev      # opens the app, reloading as you edit
npm run desktop:build    # makes the installer
```

The installer lands in `src-tauri/target/release/bundle/nsis/`. It installs for the current user, so it needs no administrator rights.

### How it differs from a browser tab

- Requests to AI providers go through Tauri's HTTP plugin, which may only reach `api.anthropic.com`, `api.openai.com` and this computer (`localhost` and `127.0.0.1`). The window itself cannot make network requests: its content security policy allows only the app's own files.
- Ollama has to run on this computer, and needs no `OLLAMA_ORIGINS` setting.
- Exports open the system save dialog.
- Dictation is not offered yet. The webview's speech recognition is not dependable (it never worked in Electron, and stopped working in WebView2 runtime 153), so it will be replaced with on-device transcription.
- Only one copy runs at a time; opening it again brings the open window forward.
- The window remembers its size and position, and is never smaller than 1024 by 640.

### Where the journal is stored

On Windows the journal is in `%LOCALAPPDATA%\com.neuroreflect.journal`, inside the window's own storage. Two settings decide that location, so neither may change once people have journals: the identifier `com.neuroreflect.journal` in `src-tauri/tauri.conf.json`, and Tauri's `useHttpsScheme` (left at its default).

The uninstaller offers to "Delete the application data". Ticking it erases the journal, so export first.

### Releases

`.github/workflows/desktop.yml` builds the Windows installer on GitHub Actions when a tag such as `v0.1.0` is pushed, and attaches it to a draft release.

The publisher is NOAH Neurotech Ltd. The installer is not code-signed yet, so Windows SmartScreen warns people before they run it. As a UK company, NOAH Neurotech Ltd can sign with Azure Artifact Signing, which Microsoft opens to organisations in the UK but to individuals only in the US and Canada. Signing does not remove the warning at once either: reputation builds as consistently signed releases are downloaded.

## Develop in a browser

The same screens run in a browser tab, which is how the browser tests drive them.

```
npm run dev          # http://localhost:3000
```

The first launch seeds four sample entries over the past two weeks, including a resolved forecast, one awaiting a reality check, and a high-rumination entry. Replace or erase them under Vault.

Serve it over http or https (localhost is fine), not from `file://`: IndexedDB, WebCrypto and dictation need a proper origin. In a browser, journals live in the browser's IndexedDB for that address, separate from the desktop app's.

## Tests

```
npm test             # engine, storage, Recall and chat checks in Node, no browser
npm run test:e2e     # browser checks; run `npm run build` and then `npm start` first
npm run test:providers:live   # optional checks against the real services (keys or a running Ollama needed)
npm run test:desktop -- <path to the built app>   # the desktop build itself, through WebDriver
```

The browser checks drive a real Chromium through Playwright. If Playwright has no browser installed, run `npx playwright install chromium` once. Screenshots land in `tests/screenshots/`.

| Suite | What it covers |
|---|---|
| `tests/engine.test.ts` | Telemetry formulas on the sample entries, fusion and defusion, coarse emotion labels, values scoring, entity extraction, the built-in co-pilot |
| `tests/storage.test.ts` | Schema upgrade, the passphrase lock end to end (nothing personal readable in storage, integrity checks, passphrase change, turning it off), export and import, graph maintenance |
| `tests/recall.test.ts` | Recall: the shared safety rules lead the prompt, the trace counts passages sent even when a provider fails, invented citations are dropped, edited templates are used, no thread trend from fewer than four entries, and a retrieval regression check on the sample journal |
| `tests/chat.test.ts` | Recall prompt building and citation clean-up |
| `tests/validation.test.ts` | Measurement harness for rumination and fusion detection against labelled text. The corpus has five rows, so it checks the method, not accuracy: tuned thresholds are only scored on held-out rows, and text outside the lexicons' language is reported, not scored |
| `tests/e2e.mjs` | The main flows: live rumination detection, step-back prompts, reframing, lenses, forecasts, finishing, dashboard, graph, timeline, export and import, zero console errors |
| `tests/lock.e2e.mjs` | The lock in the browser: raw IndexedDB inspection, wrong passphrase, auto-lock, two tabs, forgotten passphrase |
| `tests/recall.e2e.mjs` | Recall in the browser: built-in answers, a mocked Anthropic answer with only its real citations, the note saying who answered and how many passages were sent, fallback when the provider fails, nothing sent without an API key |
| `tests/mobile.e2e.mjs` | Phone widths with touch: the bottom bar from 320 to 414 px with and without the Lock button, every view except the Journal fitting 360 and 390 px screens, Recall as one column, a threshold slider saved after a touch drag |
| `tests/offline.e2e.mjs` | The browser build's service worker (`public/sw.js`): after one visit the app opens with the network cut and the journal is still there. Needs the production build, since the worker is not registered under `npm run dev` or in the desktop app |
| `tests/providers.e2e.mjs` | Anthropic, OpenAI and Ollama adapters against mocked endpoints in each API's documented streaming format, edited prompt templates, fallback when a provider fails |
| `tests/providers.live.ts` | Optional: the app's own streaming adapters against the real services, for whichever keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) or Ollama endpoint (`OLLAMA_URL`, `OLLAMA_MODEL`) are set |
| `tests/desktop.e2e.mjs` | The desktop build, through tauri-driver: secure context for the lock, the content security policy, no service worker, the HTTP allowlist, Ollama answers streamed through the plugin, the save dialog (Linux), the journal surviving a restart, one running copy. Needs `tauri-driver` and the platform's WebDriver; the file explains how to run it |

## Keyboard

| Keys | Action |
|---|---|
| Ctrl/Cmd + Enter | Ask for a question (a step-back prompt while a rumination loop is detected) |
| Ctrl/Cmd + Shift + Enter | Finish the entry |
| Ctrl/Cmd + K | Lenses and actions |
| Alt + N | New entry |
| Alt + 1 to 4 | Journal, Telemetry, Memory, Vault |
| Alt + L | Lock now (when the passphrase lock is on) |

## AI providers

Choose one under Vault. If a provider fails or takes more than 20 seconds to start answering, the built-in engine answers instead and says so. Recall waits up to 45 seconds for a whole answer before doing the same.

- **Built-in engine** (default): no model, fully offline.
- **Ollama**: defaults to `http://localhost:11434` and `llama3.1`. The desktop app reaches Ollama on this computer only, with no extra setting. In a browser, Ollama accepts requests from localhost pages by default; if you serve NeuroReflect from another address, add it to `OLLAMA_ORIGINS`.
- **Anthropic**: your own key, sent straight from this device to Anthropic. Default model `claude-sonnet-5-5`.
- **OpenAI**: your own key, sent straight from this device to OpenAI. Default model `gpt-6-luna`, OpenAI's suggested replacement for `gpt-4o-mini` (which shuts down on 14 January 2027). Any model name can be entered.

The adapters were tested against mocked endpoints that follow each API's documented streaming format. To check them against the real services, run `npm run test:providers:live` with your key or Ollama running, or use Test connection in Settings.

The instructions sent for each mode can be edited under Vault, Prompt templates. A fixed preamble with the safety and style rules is always sent first.

## Privacy and encryption

- **Passphrase lock** (Vault, off by default). Encrypts the journal on this device. Every field that IndexedDB does not need for sorting or lookup is sealed per record with XSalsa20-Poly1305 (TweetNaCl), using a key derived from your passphrase with PBKDF2-SHA256 at 600,000 iterations. The key lives only in memory while unlocked. Still readable without the passphrase: dates, record counts and which records link together.
- The journal locks after 15 minutes without input by default (5, 30 or 60 minutes, or never), or with Alt+L. Only one window or tab is unlocked at a time.
- **A forgotten passphrase cannot be recovered.** The lock screen can erase the journal so you can start again or import an export.
- **Exports** (Vault) are readable JSON or AES-256-GCM encrypted with a passphrase of their own. Uninstalling with "Delete the application data" ticked deletes the journal (in a browser, so does clearing the site's data), so export regularly.
- **Recall** with a cloud provider sends up to eight passages from your finished entries with each question. Every answer says who wrote it and how many passages were sent, including when the provider failed to answer.
- **Dictation** is offered only in a browser, where it uses the browser's speech recognition. In Chrome and Edge, audio is sent to the browser maker's speech service.

## Layout

```
app/                    Next.js App Router shell (static export)
components/studio/      Journal: block editor, telemetry bar, co-pilot, forecasts
components/dashboard/   Telemetry dashboard and charts
components/graph/       Memory view: force graph and timeline explorer
components/graph/RecallView.tsx  Recall chat, thread list and chapter list
components/settings/    Settings, passphrase lock, data vault, prompt templates
lib/psych-engine.ts     Engines A to D: telemetry, fusion, granularity, forecasts
lib/ai-provider.ts      Anthropic, OpenAI and Ollama streaming adapters
lib/orchestrator.ts     Context assembly, fallback, one-question rule
lib/lock-core.ts        Encryption middleware for IndexedDB
lib/lock.ts             Turning the lock on and off, unlock, auto-lock support
lib/db.ts               Dexie schema and settings
lib/pipeline.ts         Saving, finishing an entry, knowledge graph upkeep
lib/memory.ts           Memory chunks, moments, threads, chapter synthesis
lib/chat.ts             Tool-style chat over local journal memory with citations
lib/embeddings.ts       Offline hybrid retrieval (BM25 + hashed concept vectors)
lib/vault.ts            Export, import and erase
lib/platform.ts         What differs between the desktop app and a browser tab
src-tauri/              Desktop shell (Rust): window, HTTP allowlist, save dialog, installer settings
tests/                  Node, browser and desktop checks
```

## Roadmap to beat the competitors (actionable)

Done now:
1. **Memory and context**
   - Added memory chunks, moments, threads and chapters in local IndexedDB.
   - Added **Recall** mode: chat-with-your-journal that runs explicit tools (`search_journal`, `find_moments`, `find_threads`, `get_chapter`) and returns citations. With a cloud or Ollama provider configured, the answer is written by the model from the numbered passages only, after the same fixed safety rules as every other prompt; invented citation numbers are stripped, an uncited answer falls back to the built-in one, and each answer says how many passages were sent, including when the provider failed. Tested against a mocked Anthropic endpoint; not yet verified against a live provider.
   - Added **Merge into my journal** on import: newest-timestamp-wins merge by primary key, no deletions. Merged entries are linked into this journal's own people, themes and values, and core values are matched by name.
2. **Validation**
   - Added a measurement harness (`tests/validation.test.ts`). Its corpus has five rows, so it checks the method, not accuracy. A real estimate needs a few hundred passages labelled by independent raters, kept apart from any tuning.
3. **Provider testing**
   - Added optional live checks (`npm run test:providers:live`) that run the app's own streaming adapters against Anthropic, OpenAI and Ollama.
4. **Desktop app**
   - A Tauri 2 desktop app for Windows: provider requests only through a scoped HTTP allowlist, exports through the system save dialog, one running copy. GitHub Actions builds the installer; it is not code-signed yet.
5. **Groundwork for a phone app**
   - Navigation moves to the bottom on narrow screens. Telemetry, Memory (graph, timeline and Recall) and the Vault fit phone screens from 360 px wide. The Journal view does not yet: the entry list and the co-pilot keep their desktop widths, so it needs about 730 px and on a phone the editor gets no room.

Next loops to keep pushing:
1. **Retriever quality**
   - Add neural embeddings as an optional local model path and compare against `hash-concept-v2` with an A/B scorecard. The hashed vectors match words and known emotion concepts, not synonyms: "what went well" does not find "it went better".
2. **Clinical validation depth**
   - Expand the labeled corpus to >500 entries, split by domains and language, and track drift over engine versions.
3. **Sync**
   - Add encrypted folder sync with conflict-free merge and tombstones.
4. **Attachments**
   - Add image/PDF/audio attachments with local OCR/transcript extraction into the same recall index.
5. **Accounts**
   - Optional passkey-gated profile switcher (still local-first), with per-profile key separation.

## Known limitations

- The default lexicons are still heuristic and mostly English-first. A validation harness now exists, but this is not yet a clinically validated instrument.
- JavaScript cannot guarantee that decrypted text is wiped from memory after locking; the key itself is dropped.
- `npm audit` reports advisories in build tooling (the PostCSS copy bundled with Next.js 15, and file-watching packages used by Tailwind 3). None of it ships in the static export. Upgrading to Next.js 16 and Tailwind 4 would clear them.
