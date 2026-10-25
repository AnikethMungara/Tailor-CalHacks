"""The generation agent: Claude writes a page mod (write_mod) or a live widget
(write_widget); we smoke-test the result and feed failures back for up to 3 attempts."""

from __future__ import annotations

import json
import os
from typing import Awaitable, Callable

from .db import log_run
from .models import GenerateRequest, GeneratedMod, TestResult
from .vision import analyze_screen
from .tools import (
    WRITE_MOD_TOOL,
    WRITE_WIDGET_TOOL,
    fetch_widget_data,
    host_matches,
    run_test,
    run_widget_test,
    stub_mod,
)

MODEL = os.getenv("TAILOR_MODEL", "claude-haiku-4-5-20251001")
MAX_ATTEMPTS = 3

StatusCb = Callable[[str], Awaitable[None]]

SYSTEM = """You are Tailor, an expert at writing small, reliable per-site browser \
modifications. Given a user's plain-English request and a trimmed DOM snapshot of the page \
they are on, produce the change by calling exactly one tool.

Choose the tool:
- write_mod: edit the current page (hide/restyle/rearrange/add behavior).
- write_widget: the request is to track or display live/external data (scores, prices, \
weather, counts, feeds). This renders a small floating card that refreshes on its own.

Rules for write_mod:
- Scope with Chrome match patterns from the page URL (e.g. "*://*.youtube.com/*").
- Prefer CSS for hiding/restyling; use JS for structural or behavioral changes.
- JS runs in an isolated world with full DOM access at document_idle, wrapped in try/catch \
for you (plain statements, no top-level return, no outer IIFE).
- For lazily-rendered or SPA sites, install a MutationObserver so the change survives \
lazy loads and client-side navigation.
- Prefer stable selectors (ids, roles, aria-labels, visible text, data-testid); avoid \
auto-generated class hashes.

Rules for write_widget: provide renderJs (the body of function render(el, data)), a \
dataSource JSON string, a sampleData JSON string, and refreshSec. Keep render resilient to \
missing fields.
PREFER A FAST, KNOWN PUBLIC JSON API when one exists — these are instant and ideal for a \
polling widget. Use {"kind":"http","url":"...","method":"GET"}. Known-good examples:
- Sports scores: https://site.api.espn.com/apis/site/v2/sports/<sport>/<league>/scoreboard \
(e.g. basketball/nba, football/nfl, football/college-football). In renderJs iterate \
data.events[]; each event has competitions[0].competitors[], each with .team (fields \
displayName, shortDisplayName, location, name, abbreviation) and .score. Match the user's \
teams case-INSENSITIVELY as a SUBSTRING against ANY of those name fields (teams have many \
aliases). Show event.status.type.description (live/final/scheduled). If no event matches, \
display a friendly "No game scheduled today" — NOT an error. Note: the scoreboard only lists \
TODAY's games, so a matchup that isn't playing today won't appear.
- Crypto: https://api.coingecko.com/api/v3/simple/price?ids=<id>&vs_currencies=usd
- Weather: https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&current=temperature_2m
- Other public JSON APIs you are CERTAIN are real. NEVER invent an endpoint.
If NO suitable API exists, scrape with APIFY (note: Apify has a cold-start delay of up to a \
minute, so only use it when there is no API):
- Specific page: {"kind":"apify","actorId":"apify/cheerio-scraper","input":{"startUrls":\
[{"url":"<page>"}],"proxyConfiguration":{"useApifyProxy":true},"pageFunction":"async function \
pageFunction(context){ const $ = context.$; return { /* fields */ }; }"},"jsonPath":"[0]"} \
(apify/web-scraper for JS-rendered pages).
- Search when you lack a URL: {"kind":"apify","actorId":"apify/google-search-scraper",\
"input":{"queries":"<query>","maxPagesPerQuery":1,"resultsPerPage":5,"countryCode":"us"},\
"jsonPath":"[0].organicResults"} — renderJs scans results' .title/.description.
CRITICAL: jsonPath is ONLY simple navigation — dots and [index], e.g. "events" or \
"items[0]" — or empty for the whole response. NEVER put filters, wildcards, "?", "||", \
comparisons, or expressions in jsonPath. Do ALL filtering/selection/logic inside renderJs \
in JavaScript: the `data` passed to render(el, data) is the fetched JSON, so iterate and \
find what you need there (e.g. scan data.events for the matchup by team name). \
Make sampleData match the chosen source's real response shape.

Keep everything minimal. Only do what was asked."""


def _user_content(req: GenerateRequest) -> str:
    parts = [f"Page URL: {req.url}", f"User request: {req.prompt}"]
    if req.existing:
        parts.append(
            "You are EDITING an existing "
            + ("widget" if req.existing.kind == "widget" else "mod")
            + ". Current code:\n"
            f"--- matches ---\n{req.existing.matches}\n"
            f"--- css ---\n{req.existing.css}\n"
            f"--- js/renderJs ---\n{req.existing.renderJs or req.existing.js}\n"
            + (
                f"--- dataSource ---\n{json.dumps(req.existing.dataSource)}\n"
                if req.existing.dataSource
                else ""
            )
            + "Apply the requested change to it, using the same tool."
        )
    parts.append(f"Trimmed DOM snapshot:\n{req.snapshot}")
    return "\n\n".join(parts)


def _find_tool(content):
    for block in content:
        if getattr(block, "type", None) == "tool_use" and block.name in (
            "write_mod",
            "write_widget",
        ):
            return block
    return None


def _to_mod(block) -> GeneratedMod:
    i = block.input
    if block.name == "write_widget":
        try:
            data_source = json.loads(i.get("dataSource") or "{}")
        except Exception:
            data_source = {}
        data_source.setdefault("refreshSec", i.get("refreshSec", 30))
        return GeneratedMod(
            kind="widget",
            title=i.get("title", "Widget"),
            description=i.get("description", ""),
            matches=i.get("matches") or [],
            css=i.get("css", ""),
            renderJs=i.get("renderJs", ""),
            dataSource=data_source,
            refreshSec=int(i.get("refreshSec", 30) or 30),
        )
    return GeneratedMod(
        kind="mod",
        title=i.get("title", "Untitled mod"),
        description=i.get("description", ""),
        matches=i.get("matches") or [],
        css=i.get("css", ""),
        js=i.get("js", ""),
    )


async def generate_mod(req: GenerateRequest, status: StatusCb) -> dict:
    if not os.getenv("ANTHROPIC_API_KEY"):
        await status("No API key set — returning a placeholder mod.")
        mod = stub_mod(req.prompt, req.url)
        log_run(req.url, req.prompt, 0, True, mod.title, [])
        return mod.model_dump()

    import anthropic

    client = anthropic.AsyncAnthropic()
    messages: list[dict] = [{"role": "user", "content": _user_content(req)}]
    last: GeneratedMod | None = None
    last_errors: list[str] = []

    for attempt in range(1, MAX_ATTEMPTS + 1):
        await status("Thinking…" if attempt == 1 else f"Fixing errors (attempt {attempt})…")
        resp = await client.messages.create(
            model=MODEL,
            max_tokens=8000,
            system=SYSTEM,
            tools=[WRITE_MOD_TOOL, WRITE_WIDGET_TOOL],
            messages=messages,
        )
        block = _find_tool(resp.content)

        if block is None:
            messages.append({"role": "assistant", "content": resp.content})
            messages.append(
                {"role": "user", "content": "Please call write_mod or write_widget."}
            )
            continue

        last = _to_mod(block)
        if not last.matches:
            last.matches = host_matches(req.url)

        if last.kind == "widget":
            # Verify the data source actually returns data (catches hallucinated URLs,
            # 403s, etc.), then test render against the REAL response — not just a sample.
            await status("Checking the data source…")
            try:
                real_data = await fetch_widget_data(last.dataSource or {})
            except Exception as e:
                result = TestResult(ok=False, errors=[f"dataSource error: {e}"])
            else:
                await status("Testing the widget…")
                result = await run_widget_test(last.renderJs, last.css, real_data)
        else:
            await status("Testing the script…")
            result = await run_test(req.snapshot, last.css, last.js)

        if result.ok:
            log_run(req.url, req.prompt, attempt, True, last.title, [])
            return last.model_dump()

        last_errors = result.errors
        if attempt < MAX_ATTEMPTS:
            messages.append({"role": "assistant", "content": resp.content})
            messages.append(
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "is_error": True,
                            "content": (
                                "The code threw errors when tested:\n"
                                + "\n".join(result.errors)
                                + "\nFix it and call the tool again."
                            ),
                        }
                    ],
                }
            )

    log_run(req.url, req.prompt, MAX_ATTEMPTS, False, last.title if last else "", last_errors)
    if last is None:
        last = stub_mod(req.prompt, req.url)
    out = last.model_dump()
    out["warning"] = "Couldn't fully verify the result in testing — it may need a tweak."
    return out


ASSIST_SYSTEM = """You are Tailor's screen assistant. The user is looking at a web page; you \
receive a vision model's description of what's on screen plus the page's DOM. Decide:
- If they want to UNDERSTAND or get HELP with what's on screen (explain, summarize, answer a \
question, extract info), reply directly with a concise, helpful answer in Markdown. Ground it \
in what's actually on the screen. Do NOT call a tool.
- If they clearly want to CHANGE the page or add a live tracker, call write_mod or \
write_widget (follow each tool's rules). When creating a widget, keep jsonPath to simple \
dotted/[index] paths and do selection in renderJs; prefer a known fast JSON API, else Apify.
Default to answering unless a change is clearly requested. Be concise."""


async def assist(req: GenerateRequest, status: StatusCb) -> dict:
    """Vision-aware help: Gemini reads the screen, Claude answers or acts.

    Returns {'kind': 'answer', 'markdown': ...} or {'kind': 'mod', 'mod': {...}}.
    """
    if not os.getenv("ANTHROPIC_API_KEY"):
        return {
            "kind": "answer",
            "markdown": "_Set an ANTHROPIC_API_KEY to use screen assist._",
        }

    await status("Looking at the screen…")
    analysis = await analyze_screen(req.screenshot, req.prompt)

    import anthropic

    client = anthropic.AsyncAnthropic()
    user = (
        f"User request: {req.prompt or '(help me with what is on screen)'}\n\n"
        f"Page URL: {req.url}\n\n"
        f"What the vision model sees on screen:\n{analysis or '(no screen analysis available)'}"
        f"\n\nTrimmed DOM snapshot:\n{req.snapshot}"
    )

    await status("Thinking…")
    resp = await client.messages.create(
        model=MODEL,
        max_tokens=4000,
        system=ASSIST_SYSTEM,
        tools=[WRITE_MOD_TOOL, WRITE_WIDGET_TOOL],
        messages=[{"role": "user", "content": user}],
    )

    block = _find_tool(resp.content)
    if block is None:
        text = "".join(
            b.text for b in resp.content if getattr(b, "type", None) == "text"
        )
        return {"kind": "answer", "markdown": text or "I couldn't find anything to help with."}

    # The model chose to act — build, smoke-test once, and return the mod/widget.
    last = _to_mod(block)
    if not last.matches:
        last.matches = host_matches(req.url)
    if last.kind == "widget":
        await status("Testing the widget…")
        try:
            real = await fetch_widget_data(last.dataSource or {})
        except Exception:
            real = {}
        await run_widget_test(last.renderJs, last.css, real)
    else:
        await status("Testing the script…")
        await run_test(req.snapshot, last.css, last.js)
    return {"kind": "mod", "mod": last.model_dump()}
