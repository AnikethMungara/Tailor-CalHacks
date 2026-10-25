// WebSocket client for a single generate request. The side panel owns the connection
// (content scripts can't reach localhost; MV3 workers sleep). One connection per request
// keeps things simple and robust for the demo.

import type { ClientMessage, ServerMessage, GeneratedMod } from './protocol';

// Points at localhost in dev; set WXT_WS_URL at build time to target a deployed backend
// (e.g. wss://tailor.example.com/ws on Vultr).
export const WS_URL: string =
  (import.meta.env as any).WXT_WS_URL || 'ws://localhost:8000/ws';
const TIMEOUT_MS = 120_000;

export type RequestResult =
  | { type: 'mod'; mod: GeneratedMod }
  | { type: 'answer'; markdown: string };

export function sendRequest(
  req: ClientMessage,
  onStatus: (message: string) => void,
): Promise<RequestResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(WS_URL);

    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };

    const timer = setTimeout(
      () => done(() => reject(new Error('Timed out waiting for the backend.'))),
      TIMEOUT_MS,
    );

    ws.onopen = () => ws.send(JSON.stringify(req));

    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (msg.type === 'status') onStatus(msg.message);
      else if (msg.type === 'mod') done(() => resolve({ type: 'mod', mod: msg.mod }));
      else if (msg.type === 'answer')
        done(() => resolve({ type: 'answer', markdown: msg.markdown }));
      else if (msg.type === 'error') done(() => reject(new Error(msg.message)));
    };

    ws.onerror = () =>
      done(() =>
        reject(new Error(`Can't reach the backend at ${WS_URL}. Is it running?`)),
      );
    ws.onclose = () =>
      done(() => reject(new Error('Connection closed before a result arrived.')));
  });
}
