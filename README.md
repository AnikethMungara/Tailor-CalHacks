# Tailor — a browser that fits you ✂️

Describe a change to any website in plain English in a side panel; a Claude agent reads the
page, writes per-site JS/CSS, tests it in a sandbox, and applies it live via Chrome's
`userScripts` API. Your mods are saved, re-applied on every visit, and can sync + be shared
through a live community library.

- **Agent:** Claude (`claude-haiku-4-5-20251001`) — writes and self-corrects the mods
- **Vision:** Gemini — reads your screen for "Help with this screen" (context-aware assist)
- **Data:** Convex — cross-device sync + the Community Mods library *(optional)*
- **Deploy:** Vultr — hosts the backend *(optional)*

**Context-aware help:** click the 👁 button in the side panel — Tailor screenshots the page,
Gemini describes what's on screen, and Claude either answers your question about it or makes
a change. Add a free `GEMINI_API_KEY` (aistudio.google.com) to `backend/.env`; without it,
Claude still answers from the page's DOM.

Built for CalHacks 13.0.

## Prerequisites

- Node 20+ and npm
- Python 3.12
- Chrome 138+ (for the per-extension "Allow User Scripts" toggle)
- *(optional)* an `ANTHROPIC_API_KEY` — without one the backend returns a harmless
  placeholder mod so you can still see the whole pipeline work

## 1. Run the backend

```bash
cd backend
python -m venv .venv
# Windows (Git Bash):  source .venv/Scripts/activate
# macOS/Linux:         source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium        # for the test/retry loop

export ANTHROPIC_API_KEY=sk-ant-...           # optional; placeholder mod if omitted
uvicorn app.main:app --reload --port 8000
```

The side panel connects to `ws://localhost:8000/ws`.

## 2. Build + load the extension

```bash
cd extension
npm install
npm run dev        # hot-reloading dev build, or `npm run build` for a static one
```

Then in Chrome:

1. Go to `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select `extension/.output/chrome-mv3`.
3. Open the extension's **Details** page and turn on **"Allow User Scripts"**
   (required by Chrome 138+ before generated scripts can run).
4. Click the Tailor toolbar icon to open the side panel.

## 3. Try it

Open `https://youtube.com`, open the Tailor side panel, and type:

> hide Shorts on YouTube

The agent writes a mod, it's tested, applied live, and saved. Reload — it's still there.
Other sites are untouched (per-site scoping). Manage everything under **My Mods**.

### Live widgets (Apify)

Ask for something that tracks live data and Tailor builds a floating, self-refreshing card
instead of editing the page:

> add a widget showing the top Hacker News stories

The agent picks a data source — a public JSON API (`http`) when it knows one, or an **Apify**
Actor (`apify`) to scrape a page. The card polls the backend's `/widget/fetch` (which calls
the source server-side, cached) and updates every ~30s, even with the side panel closed.
Drag it by its header; close with ✕; manage it under **My Mods** (tagged `widget`).

For Apify-backed widgets, add a free token to `backend/.env`:
```
APIFY_TOKEN=apify_api_...
```
(HTTP-API widgets like the Hacker News example need no token.)

## Tests

```bash
cd backend && PYTHONPATH=. .venv/Scripts/python -m pytest -q   # Windows
# cd backend && PYTHONPATH=. python -m pytest -q               # macOS/Linux
```

## Community library + sync (Convex) — optional

Everything above works without Convex. To light up cross-device sync and the **Community**
tab:

```bash
cd extension
npx convex dev            # log in; creates a deployment, prints its URL, codegens convex/_generated
# then set the URL for the extension build:
#   echo "WXT_CONVEX_URL=https://<your>.convex.cloud" > .env
npm run build
```

Reload the extension. Publishing a mod from **My Mods** makes it appear live in **Community**
on any device (even another Chrome profile), one-click installable.

## Deploy the backend (Vultr)

```bash
cd backend
docker build -t tailor-backend .
docker run -e ANTHROPIC_API_KEY=sk-ant-... -p 8000:8000 tailor-backend
```

On a Vultr instance, run the same image and front it with a TLS proxy (e.g. Caddy) so the
extension can use `wss://`. Then build the extension pointed at it:

```bash
cd extension
echo "WXT_WS_URL=wss://your-host/ws" >> .env
npm run build
```

## Layout

```
extension/          WXT + React + Tailwind side panel, content script (snapshot), background (userScripts)
extension/convex/   Convex schema + functions — sync + community library (run `npx convex dev` here)
backend/            FastAPI + WebSocket; Claude agent + Playwright test/retry loop; Dockerfile for Vultr
```
