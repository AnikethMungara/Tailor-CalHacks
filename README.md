# Tailor — a browser that fits you ✂️

**Describe a change to any website in plain English, and it appears on the page seconds later.**

No code, no extension store, no waiting for a developer. You chat in a side panel; a Claude
agent reads the page, writes per-site JavaScript/CSS (or a live widget), tests it in a
sandbox, and injects it live via Chrome's `userScripts` API. Your changes are saved,
re-applied on every visit, and can sync + be shared.

> Built at **Cal Hacks 13.0**.

---

## What it does

🎯 **Mods** — "hide Shorts on YouTube", "make this page dark and wider", "remove the cookie
banner". The agent writes the script, **tests it before injecting**, and scopes it to that
site only.

📊 **Live widgets** — "add a widget showing the top Hacker News stories" / "track this match's
score". A floating, self-refreshing card that pulls live data (a known JSON API, or an
**Apify** scrape when there's no API) and updates while you browse — even with the panel
closed.

👁 **Context-aware screen assist** — hit the eye button and Tailor **sees your screen**
(**Gemini** vision) plus the DOM, then either answers a question about it or makes the change
you ask for. Works even on PDFs, where the DOM is empty.

🧹 **Resource & agentic control** — "stop this page autoplaying and kill the animations", or
safe multi-step automations ("auto-dismiss cookie banners, keep clicking load-more").

🌐 **Community library** (optional, **Convex**) — publish a mod and it appears, in realtime,
for anyone to one-click install.

### Why it's different
Generating code is the easy part — **trust** is the product: scripts are tested against the
real page before they run, each mod is scoped to its own site, everything is listed in a "My
Mods" panel you can toggle/edit/delete, and a bad mod can't break the rest of your browsing.

---

## Demo

> 📹 **Demo video:** _add link_
>
> 🖼️ _Screenshots: side panel · a live widget · the 👁 screen-assist answer_

---

## How it works

```
Side panel (owns WebSocket)              FastAPI backend
  │ request + DOM snapshot ──── ws ────▶  Claude agent (write_mod / write_widget)
  │ (+ screenshot on assist)             ├─ Gemini vision (screen understanding)
  │                                      ├─ Playwright test → retry ≤3 on error
  ◀──── streamed status + result ────────┘
  ├─ save to storage.local
  └─ background worker → chrome.userScripts.register → live, per-site, persistent
```

Full breakdown in **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

### Powered by
| Sponsor | Role |
|---|---|
| **Claude** (`claude-haiku-4-5`) | the agent that writes & self-corrects every mod/widget |
| **Gemini** (`gemini-3.8-flash`) | the vision layer for "Help with this screen" |
| **Apify** | scrapes live data for widgets when no public API exists |
| **Convex** | realtime cross-device sync + the Community library |
| **Vultr** | backend deploy target (`backend/Dockerfile`) |

---

## Quick start

### Windows (one click)
Double-click **`Start-Tailor.bat`** (or the **Tailor** desktop shortcut) — it launches the
backend and the extension dev build in their own windows.

### Manual

**1. Backend**
```bash
cd backend
python -m venv .venv
# Windows:  .venv\Scripts\activate       macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium          # for the test/retry loop
cp .env.example .env                            # then add your keys (see below)
uvicorn app.main:app --reload --port 8000
```

**2. Extension**
```bash
cd extension
npm install
npm run dev            # or `npm run build`
```
Then in **Chrome 138+**: `chrome://extensions` → **Developer mode** → **Load unpacked** →
`extension/.output/chrome-mv3` → open **Details** → enable **"Allow User Scripts"** → click
the Tailor toolbar icon.

**3. Try it** — on youtube.com, type *"hide Shorts on YouTube"*. The agent writes it, tests
it, applies it live, and it persists on reload. Other sites stay untouched.

### Keys (`backend/.env`)
All optional — the app degrades gracefully without each one.
```
ANTHROPIC_API_KEY=      # Claude agent (without it: a visible placeholder mod)
APIFY_TOKEN=            # live widgets that scrape (apify.com)
GEMINI_API_KEY=         # 👁 screen assist vision (aistudio.google.com); else DOM-only
```
Convex sync is optional: run `npx convex dev` in `extension/`, then set `WXT_CONVEX_URL` in
`extension/.env`.

---

## Tests
```bash
cd backend && PYTHONPATH=. .venv/Scripts/python -m pytest -q   # Windows
# cd backend && PYTHONPATH=. python -m pytest -q               # macOS/Linux
```

## Layout
```
extension/          WXT + React side panel, content script (snapshot/relay), background (userScripts)
extension/convex/   Convex schema + functions — sync + community library
backend/            FastAPI + WebSocket; Claude agent + Gemini vision + Playwright test/retry; Dockerfile
ARCHITECTURE.md     full technical breakdown
```

## License
[MIT](./LICENSE)
