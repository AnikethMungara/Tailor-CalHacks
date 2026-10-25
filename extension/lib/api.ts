// Thin helpers the side panel uses to talk to the content script (snapshot) and the
// background worker (userScripts registration).

import type {
  SnapshotResponse,
  BackgroundRequest,
  BackgroundResponse,
} from './protocol';

export async function getActiveTabSnapshot(): Promise<SnapshotResponse> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error('No active tab.');
  if (/^(chrome|edge|about|chrome-extension):/.test(tab.url)) {
    throw new Error('Open a normal website tab — Tailor can’t read browser pages.');
  }
  try {
    return (await chrome.tabs.sendMessage(tab.id, {
      type: 'GET_SNAPSHOT',
    })) as SnapshotResponse;
  } catch {
    throw new Error(
      'Could not read this page. Reload the tab so Tailor’s content script can attach, then try again.',
    );
  }
}

export async function bg(req: BackgroundRequest): Promise<BackgroundResponse> {
  return (await chrome.runtime.sendMessage(req)) as BackgroundResponse;
}

export async function captureScreenshot(): Promise<string | undefined> {
  try {
    const r = await bg({ type: 'CAPTURE_SCREENSHOT' });
    return r.screenshot;
  } catch {
    return undefined;
  }
}
