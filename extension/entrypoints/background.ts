import type { BackgroundRequest, BackgroundResponse } from '@/lib/protocol';
import {
  registerMod,
  unregisterMod,
  syncAllMods,
  userScriptsAvailable,
  HTTP_BASE,
} from '@/lib/mods';

// The background service worker owns all chrome.userScripts calls (that API is only
// available in the extension's own worker, not content scripts or the side panel).
export default defineBackground(() => {
  // Open the side panel when the toolbar icon is clicked.
  chrome.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((e) => console.warn('[Tailor] setPanelBehavior failed', e));

  // Re-sync live registrations with storage on startup (defensive — registrations
  // already persist on their own).
  chrome.runtime.onStartup.addListener(() => void syncAllMods().catch(console.warn));
  chrome.runtime.onInstalled.addListener(() => void syncAllMods().catch(console.warn));

  // Let user scripts (widgets) message the extension so we can proxy their data fetches —
  // the page's CSP blocks a direct fetch from the user-script world.
  function enableWidgetMessaging() {
    try {
      if (userScriptsAvailable()) {
        chrome.userScripts.configureWorld({ messaging: true } as chrome.userScripts.WorldProperties);
      }
    } catch (e) {
      console.warn('[Tailor] configureWorld failed', e);
    }
  }
  enableWidgetMessaging();
  chrome.runtime.onStartup.addListener(enableWidgetMessaging);
  chrome.runtime.onInstalled.addListener(enableWidgetMessaging);

  const onUserScriptMessage = (chrome.runtime as any).onUserScriptMessage;
  onUserScriptMessage?.addListener(
    (message: any, _sender: any, sendResponse: (r: unknown) => void) => {
      if (message?.type !== 'WIDGET_FETCH') return;
      (async () => {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 40_000);
          const res = await fetch(HTTP_BASE + '/widget/fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataSource: message.dataSource }),
            signal: ctrl.signal,
          });
          clearTimeout(t);
          sendResponse(await res.json());
        } catch (e) {
          sendResponse({ error: e instanceof Error ? e.message : String(e) });
        }
      })();
      return true;
    },
  );

  chrome.runtime.onMessage.addListener(
    (msg: BackgroundRequest, _sender, sendResponse: (r: BackgroundResponse) => void) => {
      (async () => {
        try {
          switch (msg.type) {
            case 'CHECK_USERSCRIPTS':
              return { ok: true, userScriptsAvailable: userScriptsAvailable() };
            case 'CAPTURE_SCREENSHOT': {
              const [tab] = await chrome.tabs.query({
                active: true,
                currentWindow: true,
              });
              const screenshot = await chrome.tabs.captureVisibleTab(tab?.windowId, {
                format: 'jpeg',
                quality: 60,
              });
              return { ok: true, screenshot };
            }
            case 'REGISTER_MOD':
              await registerMod(msg.mod);
              return { ok: true };
            case 'UNREGISTER_MOD':
              await unregisterMod(msg.id);
              return { ok: true };
            case 'SYNC_MODS':
              await syncAllMods();
              return { ok: true };
            default:
              return { ok: false, error: 'unknown request' };
          }
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      })().then(sendResponse);
      return true; // keep the message channel open for the async response
    },
  );
});
