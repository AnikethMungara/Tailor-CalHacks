"""Gemini vision layer: describe what's on the user's screen so the Claude agent can act
on it. Degrades to an empty string when no GEMINI_API_KEY is set (Claude then works from the
DOM alone)."""

from __future__ import annotations

import asyncio
import base64
import os


async def analyze_screen(screenshot_data_url: str | None, question: str) -> str:
    key = os.getenv("GEMINI_API_KEY")
    if not key or not screenshot_data_url:
        return ""

    try:
        from google import genai
        from google.genai import types
    except Exception as e:  # SDK missing
        return f"(vision unavailable: {e})"

    try:
        b64 = (
            screenshot_data_url.split(",", 1)[1]
            if "," in screenshot_data_url
            else screenshot_data_url
        )
        img = base64.b64decode(b64)
    except Exception as e:
        return f"(could not decode screenshot: {e})"

    model = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
    prompt = (
        "You are the vision layer of a browser assistant. Look at this screenshot of the "
        "user's current web page and describe it so another AI can act on it: the page type, "
        "the main content or task, key text/numbers/tables, any errors or notable UI. "
        f"The user asked: \"{question or '(general help with this screen)'}\" — focus on what "
        "is relevant to that. Be concise and concrete; no preamble."
    )

    def _call() -> str:
        client = genai.Client(api_key=key)
        resp = client.models.generate_content(
            model=model,
            contents=[
                types.Part.from_bytes(data=img, mime_type="image/jpeg"),
                prompt,
            ],
        )
        return resp.text or ""

    last_err: Exception | None = None
    for attempt in range(3):
        try:
            return await asyncio.to_thread(_call)
        except Exception as e:
            last_err = e
            msg = str(e)
            transient = any(
                c in msg
                for c in ("503", "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED", "high demand")
            )
            if transient and attempt < 2:
                await asyncio.sleep(1.5 * (attempt + 1))
                continue
            break
    return f"(vision error: {last_err})"
