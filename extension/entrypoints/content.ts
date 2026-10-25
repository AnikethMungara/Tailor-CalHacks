import { captureSnapshot } from '@/lib/snapshot';
import { HTTP_BASE } from '@/lib/mods';
import type { GetSnapshotRequest, SnapshotResponse } from '@/lib/protocol';

// Captures a trimmed DOM snapshot of the active page on demand, and relays widget data
// fetches. Runs in the isolated content-script world, which can read the DOM and make
// privileged fetches (not subject to the page CSP, unlike the user-script world where
// widgets run).
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    chrome.runtime.onMessage.addListener(
      (msg: GetSnapshotRequest, _sender, sendResponse: (r: SnapshotResponse) => void) => {
        if (msg?.type === 'GET_SNAPSHOT') {
          sendResponse({
            url: location.href,
            title: document.title,
            snapshot: captureSnapshot(),
          });
        }
        // synchronous response; no need to return true
      },
    );

    // Widget data relay: the injected widget (user-script world) posts a request here;
    // we fetch from the backend and post the result back. Avoids the page CSP.
    window.addEventListener('message', async (ev) => {
      const d = ev.data as { __tailor?: string; id?: string; dataSource?: unknown };
      if (!d || d.__tailor !== 'wf-req') return;
      console.debug('[Tailor] widget fetch relay received', d.dataSource);
      let json: unknown;
      try {
        const res = await fetch(HTTP_BASE + '/widget/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataSource: d.dataSource }),
        });
        json = await res.json();
      } catch (e) {
        json = { error: e instanceof Error ? e.message : String(e) };
      }
      window.postMessage({ __tailor: 'wf-res', id: d.id, json }, '*');
    });
  },
});
