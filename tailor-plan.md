# Tailor: A Browser That Fits You

Describe a change to your browser in plain English, and it appears on the page seconds later.

---

## 1. Pitch

### The problem
The web is one-size-fits-all. If you want YouTube without Shorts, an inbox that clears its own spam, or a news site without the clutter, you have three options: wait for the developer, hunt for an extension that almost does what you want, or write code yourself. Most people give up and live with the friction.

### The solution
Tailor is a browser extension where you describe the change you want and it appears on the page. No code, no store, no waiting. It reads the page you're on, writes a small script for it, tests it, and turns it on.

### See it in action
- "Hide Shorts and any video about gaming during work hours." Done on YouTube in one message.
- "Group my inbox by sender and add a one-click delete for newsletters."
- "Make this docs site dark, wider, and remove the sidebar."
- "Next week, also do that on my other news sites." The mod updates itself.

### How it works
You chat in a side panel. The extension sends a trimmed snapshot of the page to an agent. The agent writes JavaScript and CSS scoped to that site, runs it against the snapshot in a sandbox, fixes errors, then registers it live with Chrome's user scripts API. Your mods are saved and re-applied on every visit.

### Why it's different
Generating code is the easy part. The hard part is trust, so that is what the product is built around:
- **Test before inject:** scripts are checked against the real page structure and retried until they work.
- **Per-site scoping:** a bad mod can't break the rest of your browsing.
- **A "My Mods" panel:** see, toggle, edit, or delete anything the agent made.
- **Edit by talking:** change a mod by asking, instead of reinstalling anything.

### Who it's for
Students, researchers, and knowledge workers who live in a few sites all day and have specific annoyances. They would never learn to build an extension, but they know exactly what they want.

### Why now
Coding models can finally write small, reliable DOM scripts, and browsers are tightening what traditional extensions can do. Personal, generated software fits that gap.

---

## 2. Scope Decision

- **Solo build, browser only.** No Chromium fork, no desktop target in v1.
- The browser gives a sandbox, a standard API, hot reload, and clean DOM context for free.
- Edge comes from reliability and UX, not from the core idea.

---

## 3. Architecture

- **Chrome extension (MV3, TypeScript):** side panel chat, plus a content script that sends a trimmed DOM snapshot of the active tab.
- **Backend (FastAPI):** one agent loop with a single model, and a WebSocket for streaming output and page context.
- **Output:** the agent returns a JS/CSS snippet plus a URL match pattern. The extension saves it and re-injects it on matching URLs.
- **Live loading:** Chrome's `userScripts` API registers and updates code strings at runtime, so generated scripts go live with no extension reload. The user flips an "Allow User Scripts" toggle once. Check the Chrome docs for current requirements before committing.

---

## 4. Tech Stack (Windows)

### Extension
- **WXT** (Vite-based MV3 framework) with TypeScript: manifest handling, hot reload in development, builds.
- **React + Tailwind** for the side panel chat and "My Mods" list.
- **Chrome APIs:** `sidePanel`, `userScripts`, `storage.local` (mods saved here), `scripting`, `tabs`.

### Backend
- **Python 3.12, FastAPI, uvicorn**, with a WebSocket for streaming agent output.
- **Anthropic SDK** (Claude Sonnet) with tool use for structured tools such as `write_mod`, `get_page_snapshot`, and `run_test`.
- **Pydantic** for tool and message schemas.
- **Playwright (Python)** to load the saved page snapshot in headless Chromium, run the generated script, and report errors.
- **SQLite** only for logs and eval cases. Keep the mods themselves in the extension to stay simple.

### Dev tooling
- Node 20+, **pnpm**, **uv** for Python, Git, VS Code, Windows Terminal with PowerShell.
- **Vitest** and **pytest** for tests.
- A separate Chrome profile for development so your daily browser stays clean.

---

## 5. Build Plan

1. **Skeleton (day 1):** WXT project, side panel with chat UI, FastAPI server, WebSocket echo working end to end.
2. **Page context (day 2):** content script that captures a trimmed DOM (strip scripts, inline styles, hidden nodes, cap the size), sent through the service worker.
3. **Generate and inject (days 3 to 4):** agent returns a script plus a match pattern, and the extension registers it with `userScripts`. First demo: hide YouTube Shorts.
4. **Test and retry loop (days 5 to 6):** Playwright runs the script against the snapshot, feeds errors back to the model, retries up to 3 times.
5. **Mods management (day 7):** list, toggle, edit by chat, delete, version history per mod.
6. **Polish and demo (days 8 to 10):** error states, loading UX, three scripted demo flows, a short recorded video.

---

## 6. Gotchas

- Content scripts can't reliably call `localhost`, so route all backend calls through the service worker or side panel.
- Chrome needs the "Allow User Scripts" toggle on the extension's details page. Add a first-run guide for it.
- MV3 service workers sleep, so keep long-lived state in the side panel or reconnect the WebSocket on wake.
- Chrome Web Store policy is strict about remotely generated code, so distribute via a GitHub release (unpacked install) for the demo.

---

## 7. Keep Out of v1

- Graph RAG over a codebase
- Multi-model routing
- Memory extraction
- Accounts and sync
- Chromium forks

Where to spend time instead: the test-and-retry loop, the My Mods panel, per-site scoping, and a polished demo with 3 relatable examples.

---

## 8. v2 Scope (Future)

### Smarter agent
- **Graph RAG or pattern library:** retrieval over a curated set of working mods and DOM patterns, so the agent reuses what is proven instead of starting from scratch.
- **Memory:** extract per-site rules and preferences from past chats ("always hide sidebars on docs sites") and apply them to new mods.
- **Multi-model routing:** a cheaper, faster model for small edits and the strongest model for first-time generation.

### Reliability
- **Self-healing mods:** detect when a site redesign breaks a script, regenerate it automatically, and notify the user.
- **Visual verification:** screenshot before and after, and have a vision model confirm the change did what was asked.
- **Eval suite:** a growing set of site snapshots and prompts that run on every change to catch regressions.

### Product
- **Shareable mods:** export a mod as a link or file, with a community library of recipes.
- **Accounts and sync:** mods follow you across machines and browsers.
- **Cross-browser:** Edge and Firefox support.
- **Safety review:** a permissions summary per mod ("reads this site, changes styles, no network calls") and a flag on risky code.

### Platform
- **Desktop target:** the same agent and mod runtime reaching beyond the browser, starting with Windows UI Automation for a few flagship apps.
- **Web Store distribution:** once policy and sandboxing questions are settled.
