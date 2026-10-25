"""Pydantic schemas shared across the backend. Mirrors extension/lib/protocol.ts."""

from __future__ import annotations

from pydantic import BaseModel, Field


class ExistingMod(BaseModel):
    kind: str = "mod"
    title: str = ""
    js: str = ""
    css: str = ""
    renderJs: str = ""
    dataSource: dict | None = None
    matches: list[str] = Field(default_factory=list)


class GenerateRequest(BaseModel):
    type: str = "generate"  # 'generate' | 'assist'
    requestId: str
    prompt: str
    url: str
    snapshot: str = ""
    # Base64 data URL of the visible tab, used by the 'assist' (vision) path.
    screenshot: str | None = None
    existing: ExistingMod | None = None


class GeneratedMod(BaseModel):
    kind: str = "mod"  # 'mod' | 'widget'
    title: str
    description: str
    matches: list[str]
    js: str = ""
    css: str = ""
    # widget-only
    renderJs: str = ""
    dataSource: dict | None = None
    refreshSec: int = 30
    warning: str | None = None


class TestResult(BaseModel):
    ok: bool
    errors: list[str] = Field(default_factory=list)
    notes: str = ""
