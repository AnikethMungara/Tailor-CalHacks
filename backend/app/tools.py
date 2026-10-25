"""Tool schemas (write_mod / write_widget), the Playwright smoke tests, the widget data
fetcher (Apify / HTTP), and small helpers."""

from __future__ import annotations

import json
import os
import re
from urllib.parse import urlparse

from .models import GeneratedMod, TestResult

# Strict tool schema for page mods. strict=True guarantees input validates.
WRITE_MOD_TOOL = {
    "name": "write_mod",
    "description": (
        "Return the JavaScript and/or CSS for a per-site modification that fulfils the "
        "user's request, scoped to the relevant site via Chrome match patterns. The JS "
        "runs in an isolated world with full DOM access at document_idle. For sites that "
        "load or re-render content dynamically (YouTube, Gmail, SPAs), set up a "
        "MutationObserver so the change survives navigation and lazy loading. Do not "
        "rely on site-internal variables or frameworks. Prefer CSS for hide/style changes "
        "and JS for structural/behavioral changes."
    ),
    "strict": True,
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "title": {"type": "string", "description": "Short name, e.g. 'Hide YouTube Shorts'."},
            "description": {"type": "string", "description": "One sentence on what it does."},
            "matches": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Chrome match patterns, e.g. ['*://*.youtube.com/*'].",
            },
            "css": {"type": "string", "description": "CSS to inject (may be empty)."},
            "js": {"type": "string", "description": "JS statements to run (may be empty)."},
        },
        "required": ["title", "description", "matches", "css", "js"],
    },
}

# Strict tool schema for live widgets. dataSource and sampleData are passed as JSON
# strings to keep the schema flat and robust.
WRITE_WIDGET_TOOL = {
    "name": "write_widget",
    "description": (
        "Build a live WIDGET: a small floating card, injected on the matching site, that "
        "refreshes from an external data source while the user browses. Use this (instead "
        "of write_mod) whenever the request is to track/display live or external data "
        "(scores, prices, weather, counts, feeds).\n"
        "- renderJs: the BODY of `function render(el, data){ ... }` that fills `el` (the "
        "card element) from `data`. Be resilient to missing fields.\n"
        "- dataSource: a JSON string describing where data comes from. DEFAULT TO APIFY "
        "scraping: {\"kind\":\"apify\",\"actorId\":\"apify/cheerio-scraper\",\"input\":"
        "{\"startUrls\":[{\"url\":\"<page>\"}],\"proxyConfiguration\":{\"useApifyProxy\":true},"
        "\"pageFunction\":\"async function pageFunction(context){ const $ = context.$; return "
        "{ /* fields render() needs */ }; }\"},\"jsonPath\":\"[0]\"} (use apify/web-scraper for "
        "JS-rendered pages; apify/google-search-scraper with {\"queries\":\"...\"} to search "
        "when you lack a URL). Use {\"kind\":\"http\",...} ONLY for a public JSON API you are "
        "certain exists. Never invent URLs. jsonPath (optional) selects the useful part.\n"
        "- sampleData: a JSON string with a realistic example of `data`, used to test the "
        "render function.\n"
        "- refreshSec: how often to refresh (>= 10)."
    ),
    "strict": True,
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "title": {"type": "string"},
            "description": {"type": "string"},
            "matches": {"type": "array", "items": {"type": "string"}},
            "css": {"type": "string", "description": "Extra CSS for the card (may be empty)."},
            "renderJs": {"type": "string", "description": "Body of function render(el, data){...}."},
            "dataSource": {"type": "string", "description": "JSON string; see description."},
            "sampleData": {"type": "string", "description": "JSON string; example data for testing."},
            "refreshSec": {"type": "integer", "description": "Refresh interval in seconds (>=10)."},
        },
        "required": [
            "title",
            "description",
            "matches",
            "css",
            "renderJs",
            "dataSource",
            "sampleData",
            "refreshSec",
        ],
    },
}


def host_matches(url: str) -> list[str]:
    try:
        host = urlparse(url).hostname or ""
        host = host[4:] if host.startswith("www.") else host
        if host:
            return [f"*://*.{host}/*"]
    except Exception:
        pass
    return ["*://*/*"]


def stub_mod(prompt: str, url: str) -> GeneratedMod:
    """Returned when no ANTHROPIC_API_KEY is set — proves the pipeline end-to-end."""
    return GeneratedMod(
        title="Tailor placeholder",
        description="Visible banner confirming the mod pipeline works.",
        matches=host_matches(url),
        css=(
            "#tailor-placeholder{position:fixed;z-index:2147483647;top:10px;right:10px;"
            "background:#4f46e5;color:#fff;padding:8px 12px;border-radius:10px;"
            "font:600 13px system-ui;box-shadow:0 4px 16px rgba(0,0,0,.3)}"
        ),
        js=(
            "const b=document.createElement('div');b.id='tailor-placeholder';"
            "b.textContent='Tailored by Tailor \\u2702\\ufe0f';"
            "document.body&&document.body.appendChild(b);"
        ),
        warning="No ANTHROPIC_API_KEY set — returned a placeholder, not a real mod.",
    )


async def run_test(snapshot_html: str, css: str, js: str) -> TestResult:
    """Load the snapshot in headless Chromium, inject css+js, report runtime errors."""
    return await _smoke(snapshot_html, css, js)


async def run_widget_test(render_js: str, css: str, sample_data) -> TestResult:
    """Verify a widget's render(el, data) runs against sampleData without throwing."""
    sample = json.dumps(sample_data)
    js = (
        "const __el = document.createElement('div');"
        "document.body.appendChild(__el);"
        f"const __data = {sample};"
        f"(function render(el, data){{ {render_js} \n}})(__el, __data);"
    )
    return await _smoke("<div id='root'></div>", css, js)


async def _smoke(snapshot_html: str, css: str, js: str) -> TestResult:
    try:
        from playwright.async_api import async_playwright
    except Exception as e:  # pragma: no cover
        return TestResult(ok=True, notes=f"Playwright unavailable, skipped test: {e}")

    errors: list[str] = []
    html = (
        "<!doctype html><html><head><meta charset='utf-8'></head><body>"
        f"{snapshot_html}</body></html>"
    )
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            page.on("pageerror", lambda exc: errors.append(f"pageerror: {exc}"))
            page.on(
                "console",
                lambda m: errors.append(f"console.error: {m.text}")
                if m.type == "error"
                else None,
            )
            await page.set_content(html, wait_until="domcontentloaded")
            if css:
                await page.add_style_tag(content=css)
            if js:
                await page.evaluate(f"() => {{ {js} \n}}")
            await page.wait_for_timeout(300)
            await browser.close()
    except Exception as e:
        errors.append(str(e))

    return TestResult(ok=len(errors) == 0, errors=errors, notes="smoke test")


def _apply_path(data, path: str):
    """Walk a dotted path with optional [index], e.g. 'events[0].score' or '[0].items'.

    Tokenizes into bare keys and [index] steps so malformed brackets can't crash it; on a
    missing key/index, raises a clear message the agent can act on.
    """
    if not path:
        return data
    # If the path uses unsupported expression syntax (filters, wildcards, ||, ?, =, spaces),
    # ignore it and return the whole response — render() is expected to do selection in JS.
    if re.search(r"[^\w.\[\]-]", path):
        return data
    tokens = re.findall(r"[^.\[\]]+|\[\d+\]", path)
    cur = data
    for tok in tokens:
        try:
            if tok.startswith("[") and tok.endswith("]"):
                cur = cur[int(tok[1:-1])]
            else:
                cur = cur[tok]
        except (KeyError, IndexError, TypeError) as e:
            raise RuntimeError(
                f"jsonPath {path!r} failed at {tok!r}: {type(e).__name__}"
            ) from e
    return cur


async def fetch_widget_data(ds: dict):
    """Fetch widget data server-side (no CORS/CSP limits) via Apify or plain HTTP."""
    import httpx

    kind = ds.get("kind")
    if kind == "apify":
        token = os.getenv("APIFY_TOKEN")
        if not token:
            raise RuntimeError("APIFY_TOKEN not set on the backend.")
        actor = str(ds.get("actorId", "")).replace("/", "~")
        url = f"https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items?token={token}"
        async with httpx.AsyncClient(timeout=90) as c:
            r = await c.post(url, json=ds.get("input") or {})
            r.raise_for_status()
            data = r.json()
    elif kind == "http":
        method = str(ds.get("method", "GET")).upper()
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as c:
            r = await c.request(
                method,
                ds["url"],
                headers=ds.get("headers") or {},
                json=ds.get("input") if method != "GET" else None,
            )
            r.raise_for_status()
            data = r.json()
    else:
        raise RuntimeError(f"unknown dataSource kind: {kind!r}")

    return _apply_path(data, ds.get("jsonPath", ""))
