// Shared types for the WebSocket protocol between the side panel and the backend,
// plus the Mod shape persisted in storage.local. Keep this in sync with
// backend/app/models.py.

export interface ModVersion {
  js: string;
  css: string;
  createdAt: number;
  prompt: string;
}

export interface DataSource {
  kind: 'http' | 'apify';
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  actorId?: string;
  input?: unknown;
  jsonPath?: string;
  refreshSec?: number;
}

export interface Mod {
  id: string;
  /** 'mod' = page edit (js/css); 'widget' = live floating card (renderJs/dataSource). */
  kind?: 'mod' | 'widget';
  title: string;
  description: string;
  /** Chrome match patterns, e.g. ["*://*.youtube.com/*"]. */
  matches: string[];
  js: string;
  css: string;
  /** Widget-only: body of function render(el, data){…}. */
  renderJs?: string;
  /** Widget-only: where the card gets its data. */
  dataSource?: DataSource;
  /** Widget-only: refresh interval in seconds. */
  refreshSec?: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  /** Original user request that produced the current version. */
  prompt: string;
  /** Whether this mod is shared to the Convex community library. */
  published?: boolean;
  /** Prior versions, newest last. */
  history: ModVersion[];
}

/** A freshly generated mod or widget from the backend, before it is persisted. */
export interface GeneratedMod {
  kind?: 'mod' | 'widget';
  title: string;
  description: string;
  matches: string[];
  js: string;
  css: string;
  renderJs?: string;
  dataSource?: DataSource;
  refreshSec?: number;
  /** Present when the test/retry loop could not fully verify the result. */
  warning?: string;
}

// ---- Client -> server ----
export interface GenerateRequest {
  type: 'generate' | 'assist';
  requestId: string;
  prompt: string;
  url: string;
  snapshot: string;
  /** Base64 data URL of the visible tab — sent on the 'assist' (vision) path. */
  screenshot?: string;
  /** When editing an existing mod, its current code for context. */
  existing?: {
    kind?: 'mod' | 'widget';
    title: string;
    js: string;
    css: string;
    renderJs?: string;
    dataSource?: DataSource;
    matches: string[];
  };
}

export type ClientMessage = GenerateRequest;

// ---- Server -> client ----
export interface StatusMessage {
  type: 'status';
  requestId: string;
  message: string;
}
export interface ModMessage {
  type: 'mod';
  requestId: string;
  mod: GeneratedMod;
}
export interface ErrorMessage {
  type: 'error';
  requestId: string;
  message: string;
}
export interface AnswerMessage {
  type: 'answer';
  requestId: string;
  markdown: string;
}

export type ServerMessage = StatusMessage | ModMessage | ErrorMessage | AnswerMessage;

// ---- Messaging between side panel and content script ----
export interface GetSnapshotRequest {
  type: 'GET_SNAPSHOT';
}
export interface SnapshotResponse {
  url: string;
  title: string;
  snapshot: string;
}

// ---- Messaging between side panel and background worker ----
export type BackgroundRequest =
  | { type: 'REGISTER_MOD'; mod: Mod }
  | { type: 'UNREGISTER_MOD'; id: string }
  | { type: 'SYNC_MODS' }
  | { type: 'CHECK_USERSCRIPTS' }
  | { type: 'CAPTURE_SCREENSHOT' };

export interface BackgroundResponse {
  ok: boolean;
  /** For CHECK_USERSCRIPTS: whether the "Allow User Scripts" toggle is on. */
  userScriptsAvailable?: boolean;
  /** For CAPTURE_SCREENSHOT: base64 data URL of the visible tab. */
  screenshot?: string;
  error?: string;
}
