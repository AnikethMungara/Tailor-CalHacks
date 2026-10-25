// Mod persistence (storage.local) + live registration via chrome.userScripts.
//
// storage.local is the source of truth; chrome.userScripts holds the live registrations.
// Registered user scripts persist across restarts and auto-run on matching URLs, so we
// only (re)sync registrations when mods change — there is no per-visit re-injection.
//
// CSS note: chrome.userScripts.register only accepts `js`. We fold CSS into the script by
// injecting a <style> element, which works reliably in the USER_SCRIPT world.

import type { Mod } from './protocol';

const STORAGE_KEY = 'tailor:mods';

// Backend HTTP base for widget data polling, derived from the WS URL (ws->http, wss->https).
// Used by the background worker, which proxies widget fetches (page CSP blocks them in the
// user-script world).
export const HTTP_BASE: string = (() => {
  const ws = (import.meta.env as any).WXT_WS_URL || 'ws://localhost:8000/ws';
  return String(ws).replace(/^ws/, 'http').replace(/\/ws$/, '');
})();

// ---- storage.local CRUD ----

export async function getMods(): Promise<Mod[]> {
  const res = await chrome.storage.local.get(STORAGE_KEY);
  return (res[STORAGE_KEY] as Mod[] | undefined) ?? [];
}

export async function getMod(id: string): Promise<Mod | undefined> {
  return (await getMods()).find((m) => m.id === id);
}

async function writeMods(mods: Mod[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: mods });
}

export async function upsertMod(mod: Mod): Promise<void> {
  const mods = await getMods();
  const idx = mods.findIndex((m) => m.id === mod.id);
  if (idx >= 0) mods[idx] = mod;
  else mods.push(mod);
  await writeMods(mods);
}

export async function deleteMod(id: string): Promise<void> {
  await writeMods((await getMods()).filter((m) => m.id !== id));
}

export function newModId(): string {
  return 'mod_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ---- chrome.userScripts registration ----

/** True when the "Allow User Scripts" toggle is on (the API is undefined otherwise). */
export function userScriptsAvailable(): boolean {
  try {
    // Accessing the property throws if the toggle is off.
    return typeof chrome.userScripts !== 'undefined';
  } catch {
    return false;
  }
}

function buildCode(mod: Mod): string {
  if (mod.kind === 'widget') return buildWidgetCode(mod);
  const css = JSON.stringify(mod.css ?? '');
  // Wrap so a thrown error in generated JS can't take down the page silently.
  return `(() => {
  try {
    const __tailorCss = ${css};
    if (__tailorCss) {
      const s = document.createElement('style');
      s.setAttribute('data-tailor', ${JSON.stringify(mod.id)});
      s.textContent = __tailorCss;
      (document.head || document.documentElement).appendChild(s);
    }
  } catch (e) { console.error('[Tailor] css inject failed', e); }
  try {
${mod.js ?? ''}
  } catch (e) { console.error('[Tailor] mod ${mod.id} error', e); }
})();`;
}

function buildWidgetCode(mod: Mod): string {
  const id = JSON.stringify(mod.id);
  const css = JSON.stringify(mod.css ?? '');
  const ds = JSON.stringify(mod.dataSource ?? {});
  const title = JSON.stringify(mod.title ?? 'Widget');
  const refresh = Math.max(10, mod.refreshSec ?? 30) * 1000;
  return `(() => {
  try {
    const ID = ${id};
    const hostId = 'tailor-w-' + ID;
    if (document.getElementById(hostId)) return;
    const host = document.createElement('div');
    host.id = hostId;
    host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = '.card{font:13px/1.4 system-ui;background:#111827;color:#e6e8ee;padding:12px 14px;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.45);min-width:170px;max-width:300px;border:1px solid rgba(255,255,255,.08)}.hdr{display:flex;justify-content:space-between;align-items:center;gap:8px;font-weight:600;margin-bottom:6px;cursor:move}.x{cursor:pointer;opacity:.5}.x:hover{opacity:1}.bd{font-size:12px}' + ${css};
    const card = document.createElement('div'); card.className = 'card';
    const hdr = document.createElement('div'); hdr.className = 'hdr';
    const ttl = document.createElement('span'); ttl.textContent = ${title};
    const x = document.createElement('span'); x.className = 'x'; x.textContent = '\\u2715';
    hdr.appendChild(ttl); hdr.appendChild(x);
    const body = document.createElement('div'); body.className = 'bd'; body.textContent = 'Loading\\u2026';
    card.appendChild(hdr); card.appendChild(body);
    root.appendChild(style); root.appendChild(card);
    (document.body || document.documentElement).appendChild(host);
    x.addEventListener('click', () => host.remove());
    let dx = 0, dy = 0, drag = false;
    hdr.addEventListener('pointerdown', (e) => { drag = true; dx = e.clientX - host.offsetLeft; dy = e.clientY - host.offsetTop; host.style.right = 'auto'; hdr.setPointerCapture(e.pointerId); });
    hdr.addEventListener('pointermove', (e) => { if (!drag) return; host.style.left = (e.clientX - dx) + 'px'; host.style.top = (e.clientY - dy) + 'px'; });
    hdr.addEventListener('pointerup', () => { drag = false; });
    function render(el, data) { ${mod.renderJs ?? ''} }
    function requestData(dataSource, timeoutMs) {
      return new Promise((resolve, reject) => {
        const reqId = 'wf_' + Math.random().toString(36).slice(2);
        const onMsg = (ev) => {
          const d = ev.data;
          if (!d || d.__tailor !== 'wf-res' || d.id !== reqId) return;
          window.removeEventListener('message', onMsg);
          clearTimeout(t);
          resolve(d.json);
        };
        const t = setTimeout(() => {
          window.removeEventListener('message', onMsg);
          reject(new Error('timed out'));
        }, timeoutMs);
        window.addEventListener('message', onMsg);
        window.postMessage({ __tailor: 'wf-req', id: reqId, dataSource: dataSource }, '*');
      });
    }
    async function tick() {
      try {
        const json = await requestData(${ds}, 45000);
        if (json && json.error) { body.textContent = '\\u26a0\\ufe0f ' + json.error; return; }
        render(body, json ? json.data : null);
      } catch (e) { body.textContent = '\\u26a0\\ufe0f ' + ((e && e.message) || e); }
    }
    tick();
    setInterval(tick, ${refresh});
  } catch (e) { console.error('[Tailor] widget ${mod.id} error', e); }
})();`;
}

export async function registerMod(mod: Mod): Promise<void> {
  if (!userScriptsAvailable()) throw new Error('userScripts API unavailable');
  // Clear any previous registration with this id, then register fresh.
  await unregisterMod(mod.id).catch(() => {});
  if (!mod.enabled) return;
  await chrome.userScripts.register([
    {
      id: mod.id,
      matches: mod.matches,
      js: [{ code: buildCode(mod) }],
      runAt: 'document_idle',
      world: 'USER_SCRIPT',
    },
  ]);
}

export async function unregisterMod(id: string): Promise<void> {
  if (!userScriptsAvailable()) return;
  const existing = await chrome.userScripts.getScripts({ ids: [id] });
  if (existing.length) await chrome.userScripts.unregister({ ids: [id] });
}

/** Reconcile live registrations with storage (used on startup and after bulk changes). */
export async function syncAllMods(): Promise<void> {
  if (!userScriptsAvailable()) return;
  const mods = await getMods();
  const existing = await chrome.userScripts.getScripts();
  if (existing.length) {
    await chrome.userScripts.unregister({ ids: existing.map((s) => s.id) });
  }
  const enabled = mods.filter((m) => m.enabled);
  if (enabled.length) {
    await chrome.userScripts.register(
      enabled.map((mod) => ({
        id: mod.id,
        matches: mod.matches,
        js: [{ code: buildCode(mod) }],
        runAt: 'document_idle' as const,
        world: 'USER_SCRIPT' as const,
      })),
    );
  }
}
