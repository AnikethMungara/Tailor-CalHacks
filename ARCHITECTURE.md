# Tailor — Architecture

How Tailor turns a plain-English request into a live, per-site browser change — every
component and request path.

## Stack & topology

**Extension** — WXT + React + Tailwind + TypeScript, Manifest V3. Three execution contexts:

- **Side panel** (`entrypoints/sidepanel/App.tsx`) — React UI; **owns the WebSocket** to the
  backend. (Content scripts can't reach `localhost`; MV3 service workers sleep — the panel is
  a persistent page while open.)
- **Background service worker** (`entrypoints/background.ts`) — the only context allowed to
  call `chrome.userScripts`; also captures screenshots.
- **Content script** (`entrypoints/content.ts`) — injected on `<all_urls>` at
  `document_idle`; captures the DOM snapshot and relays widget data fetches.

**Backend** — FastAPI + uvicorn (Python 3.12):

- `app/main.py` — `/ws` WebSocket, `/widget/fetch`, `/health`
- `app/agent.py` — Claude generation loop + the vision-assist path
- `app/tools.py` — tool schemas, Playwright smoke tests, widget data fetch
- `app/vision.py` — Gemini screen analysis
- `app/models.py` — Pydantic schemas · `app/db.py` — SQLite run logs

**Convex** (optional) — `extension/convex/{schema,mods}.ts` + `lib/sync.ts` for cross-device
sync and the community library.

**Permissions:** `userScripts, sidePanel, storage, scripting, tabs, activeTab` +
`host_permissions: ["<all_urls>"]`. Requires Chrome 138+ with the per-extension
**"Allow User Scripts"** toggle enabled.

**Models:** Claude `claude-haiku-4-5-20251001` (agent, strict tool schemas, `max_tokens` 8000);
Gemini `gemini-3.8-flash` (vision).

## Flow 1 — Generate & apply a mod

1. **Snapshot.** `getActiveTabSnapshot()` messages the content script, which runs
   `captureSnapshot()`: clones `<body>`, strips scripts/styles/hidden/comments, keeps
   structural tags + `id/class/role/aria/data-*` + visible text, caps ~60k chars.
2. **Send.** The side panel opens a WebSocket (`ws://localhost:8000/ws` or `WXT_WS_URL`) and
   sends `{type:'generate', prompt, url, snapshot}`. One socket per request.
3. **Agent loop** (`generate_mod`). Up to 3 attempts of `messages.create(tools=[write_mod,
   write_widget])`. The `tool_use` result becomes a `GeneratedMod`.
4. **Test-before-inject** (`run_test`). Playwright loads the snapshot, injects the CSS/JS, and
   captures `pageerror`/`console.error`. On failure, the errors are fed back as a
   `tool_result` and the model retries (≤3). Status lines stream over the socket throughout.
5. **Persist + register.** The side panel saves the mod to `chrome.storage.local`, then asks
   the background worker to `chrome.userScripts.register(...)` in the `USER_SCRIPT` world at
   `document_idle`. Registrations persist across restarts and auto-run on matching URLs.

**Trust model:** test-before-inject, per-site `matches` scoping, and every injected mod wrapped
in `try/catch` so a bad script can't break the page.

## Flow 2 — Live widget runtime

A widget's injected code builds a draggable **shadow-DOM** card and polls every `refreshSec`.

- **CSP problem:** the `USER_SCRIPT` world's `fetch()` is subject to the page's CSP, so a
  direct call to the backend is blocked on strict sites.
- **Relay:** the widget `window.postMessage`s a request to the **content script** (isolated
  world — privileged fetch, not CSP-bound), which calls `POST /widget/fetch` and posts the
  result back. 45s timeout.

**Backend `/widget/fetch`** caches by data-source hash for `refreshSec`, then `fetch_widget_data`:
`kind:'apify'` → Apify `run-sync-get-dataset-items`; `kind:'http'` → `httpx`. A small
`jsonPath` walker selects the useful field; anything with filter/expression syntax falls back
to the whole response (selection happens in the widget's render JS). Widgets prefer a known
fast JSON API for low-latency polling and use Apify scraping only when no API exists.

## Flow 3 — Context-aware "Help with this screen"

1. Side panel captures a screenshot (`chrome.tabs.captureVisibleTab`) + DOM, sends
   `{type:'assist', ...}`.
2. **Gemini** (`analyze_screen`) describes the screen from the JPEG (runs in a thread, retries
   transient 503s). Degrades to DOM-only if no key.
3. **Claude** receives `prompt + Gemini's description + DOM` and either replies with a Markdown
   **answer** (shown in the panel) or calls a tool to make a **mod/widget**.

Deliberate split: **Claude = agent/codegen, Gemini = perception.** This is why PDFs work — the
DOM is empty but vision reads the rendered page.

## Flow 4 — Management & sync

- **My Mods** (from `storage.local`): toggle (register/unregister), edit-by-chat (prior code
  sent as context; old version pushed to `history[]`), delete, publish.
- **Convex** (optional, gated on `WXT_CONVEX_URL`): mods mirror to the cloud via an untyped
  `anyApi` client keyed by an anonymous `deviceId`; the **Community** tab is a realtime
  `onUpdate` subscription with one-click install.

## Storage model

- **`chrome.storage.local`** — source of truth for what gets injected.
- **SQLite** (`backend/tailor.db`) — generation run logs only.
- **Convex** (cloud) — optional sync + shared community library.
