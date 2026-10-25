"""FastAPI app exposing a single /ws endpoint the side panel talks to."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader (no dependency). Existing env vars win."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.split(" #", 1)[0]  # strip trailing inline comments
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


# Load backend/.env before importing the agent (which reads env at import time).
_load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from fastapi import FastAPI, WebSocket, WebSocketDisconnect  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from .agent import assist, generate_mod  # noqa: E402
from .models import GenerateRequest  # noqa: E402
from .tools import fetch_widget_data  # noqa: E402

app = FastAPI(title="Tailor backend")

# Injected widgets poll /widget/fetch directly from the page, so allow any origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Cache widget data by dataSource so polling doesn't hammer Apify/upstream.
_widget_cache: dict[str, tuple[float, object]] = {}


@app.get("/health")
async def health():
    return {"ok": True}


@app.post("/widget/fetch")
async def widget_fetch(payload: dict):
    ds = payload.get("dataSource") or {}
    refresh = int(ds.get("refreshSec") or 30)
    key = json.dumps(ds, sort_keys=True)
    now = time.time()
    hit = _widget_cache.get(key)
    if hit and now - hit[0] < max(10, refresh):
        return {"data": hit[1], "cached": True}
    try:
        data = await fetch_widget_data(ds)
    except Exception as e:
        return JSONResponse(status_code=502, content={"error": str(e)})
    _widget_cache[key] = (now, data)
    return {"data": data, "cached": False}


@app.websocket("/ws")
async def ws(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue

            msg_type = data.get("type")
            if msg_type not in ("generate", "assist"):
                continue

            req = GenerateRequest(**data)

            async def status(message: str) -> None:
                await websocket.send_json(
                    {"type": "status", "requestId": req.requestId, "message": message}
                )

            try:
                if msg_type == "assist":
                    result = await assist(req, status)
                    if result["kind"] == "answer":
                        await websocket.send_json(
                            {
                                "type": "answer",
                                "requestId": req.requestId,
                                "markdown": result["markdown"],
                            }
                        )
                    else:
                        await websocket.send_json(
                            {"type": "mod", "requestId": req.requestId, "mod": result["mod"]}
                        )
                else:
                    mod = await generate_mod(req, status)
                    await websocket.send_json(
                        {"type": "mod", "requestId": req.requestId, "mod": mod}
                    )
            except Exception as e:  # surface failures to the panel instead of dropping
                await websocket.send_json(
                    {"type": "error", "requestId": req.requestId, "message": str(e)}
                )
    except WebSocketDisconnect:
        return
