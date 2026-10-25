"""Tiny SQLite logger for generation runs + eval cases. Logs only; mods live in the
extension's storage.local."""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "tailor.db"


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts REAL,
            url TEXT,
            prompt TEXT,
            attempts INTEGER,
            ok INTEGER,
            title TEXT,
            errors TEXT
        )"""
    )
    return conn


def log_run(
    url: str,
    prompt: str,
    attempts: int,
    ok: bool,
    title: str,
    errors: list[str],
) -> None:
    try:
        conn = _conn()
        conn.execute(
            "INSERT INTO runs (ts,url,prompt,attempts,ok,title,errors) VALUES (?,?,?,?,?,?,?)",
            (time.time(), url, prompt, attempts, 1 if ok else 0, title, json.dumps(errors)),
        )
        conn.commit()
        conn.close()
    except Exception as e:  # logging must never break a request
        print(f"[tailor] log_run failed: {e}")
