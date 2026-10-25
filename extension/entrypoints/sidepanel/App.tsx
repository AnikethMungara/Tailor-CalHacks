import { useEffect, useRef, useState } from 'react';
import type { GeneratedMod, Mod } from '@/lib/protocol';
import { sendRequest } from '@/lib/ws';
import { getActiveTabSnapshot, bg, captureScreenshot } from '@/lib/api';
import { getMods, upsertMod, deleteMod, newModId } from '@/lib/mods';
import {
  convexEnabled,
  pushMod,
  setPublic,
  removeRemote,
  subscribeCommunity,
  countInstall,
  type CommunityMod,
} from '@/lib/sync';

type ChatMsg = {
  role: 'user' | 'assistant';
  text: string;
  mod?: Mod;
  error?: boolean;
};

type Tab = 'chat' | 'mods' | 'community';

const SUGGESTIONS = [
  'Hide Shorts on YouTube',
  'Make this page dark and wider',
  'Add a widget showing the top Hacker News stories',
];

function hostMatches(url: string): string[] {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return [`*://*.${host}/*`];
  } catch {
    return ['*://*/*'];
  }
}

export default function App() {
  const [tab, setTab] = useState<Tab>('chat');
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      role: 'assistant',
      text:
        "Describe a change to this site and I'll make it. Try “hide Shorts on YouTube” or “make this page dark”.",
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [mods, setMods] = useState<Mod[]>([]);
  const [community, setCommunity] = useState<CommunityMod[]>([]);
  const [editing, setEditing] = useState<Mod | null>(null);
  const [userScriptsOk, setUserScriptsOk] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshMods = () => getMods().then(setMods);

  useEffect(() => {
    refreshMods();
    bg({ type: 'CHECK_USERSCRIPTS' })
      .then((r) => setUserScriptsOk(!!r.userScriptsAvailable))
      .catch(() => setUserScriptsOk(false));
    // Live community library (no-op unless Convex is configured).
    const unsub = subscribeCommunity(setCommunity);
    return unsub;
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages, status]);

  async function applyMod(mod: Mod) {
    await upsertMod(mod);
    const reg = await bg({ type: 'REGISTER_MOD', mod });
    await pushMod(mod).catch(() => {});
    await refreshMods();
    return reg;
  }

  async function handleSend() {
    const prompt = input.trim();
    if (!prompt || busy) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text: prompt }]);
    setBusy(true);
    setStatus('Reading the page…');

    try {
      const snap = await getActiveTabSnapshot();
      setStatus('Thinking…');
      const requestId = Math.random().toString(36).slice(2);
      const result = await sendRequest(
        {
          type: 'generate',
          requestId,
          prompt,
          url: snap.url,
          snapshot: snap.snapshot,
          existing: editing
            ? {
                kind: editing.kind,
                title: editing.title,
                js: editing.js,
                css: editing.css,
                renderJs: editing.renderJs,
                dataSource: editing.dataSource,
                matches: editing.matches,
              }
            : undefined,
        },
        setStatus,
      );
      if (result.type === 'answer') {
        setMessages((m) => [...m, { role: 'assistant', text: result.markdown }]);
        setEditing(null);
        return;
      }
      const generated: GeneratedMod = result.mod;

      const now = Date.now();
      // Widgets follow you everywhere; page-mods stay scoped to their site.
      const matches =
        generated.kind === 'widget'
          ? ['*://*/*']
          : generated.matches?.length
            ? generated.matches
            : hostMatches(snap.url);

      let mod: Mod;
      if (editing) {
        mod = {
          ...editing,
          kind: generated.kind || editing.kind || 'mod',
          title: generated.title || editing.title,
          description: generated.description || editing.description,
          matches,
          js: generated.js,
          css: generated.css,
          renderJs: generated.renderJs,
          dataSource: generated.dataSource,
          refreshSec: generated.refreshSec,
          prompt,
          updatedAt: now,
          enabled: true,
          history: [
            ...editing.history,
            {
              js: editing.js,
              css: editing.css,
              prompt: editing.prompt,
              createdAt: editing.updatedAt,
            },
          ],
        };
      } else {
        mod = {
          id: newModId(),
          kind: generated.kind || 'mod',
          title: generated.title || 'Untitled mod',
          description: generated.description || prompt,
          matches,
          js: generated.js,
          css: generated.css,
          renderJs: generated.renderJs,
          dataSource: generated.dataSource,
          refreshSec: generated.refreshSec,
          enabled: true,
          createdAt: now,
          updatedAt: now,
          prompt,
          published: false,
          history: [],
        };
      }

      const reg = await applyMod(mod);
      setEditing(null);

      const note = !reg.ok
        ? ` (couldn’t go live: ${reg.error ?? 'userScripts off'})`
        : generated.warning
          ? ` ⚠️ ${generated.warning}`
          : '';
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text: `Applied “${mod.title}” to ${mod.matches.join(', ')}. Reload the tab if you don’t see it yet.${note}`,
          mod,
        },
      ]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text: e instanceof Error ? e.message : String(e),
          error: true,
        },
      ]);
    } finally {
      setBusy(false);
      setStatus('');
    }
  }

  async function applyGeneratedMod(generated: GeneratedMod, url: string, prompt: string) {
    const now = Date.now();
    const matches =
      generated.kind === 'widget'
        ? ['*://*/*']
        : generated.matches?.length
          ? generated.matches
          : hostMatches(url);
    const mod: Mod = {
      id: newModId(),
      kind: generated.kind || 'mod',
      title: generated.title || 'Untitled mod',
      description: generated.description || prompt,
      matches,
      js: generated.js,
      css: generated.css,
      renderJs: generated.renderJs,
      dataSource: generated.dataSource,
      refreshSec: generated.refreshSec,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      prompt,
      published: false,
      history: [],
    };
    const reg = await applyMod(mod);
    return { mod, reg };
  }

  async function handleHelp() {
    if (busy) return;
    const prompt = input.trim();
    setInput('');
    setMessages((m) => [
      ...m,
      { role: 'user', text: prompt ? `👁 ${prompt}` : '👁 Help with this screen' },
    ]);
    setBusy(true);
    setStatus('Capturing screen…');
    try {
      const snap = await getActiveTabSnapshot();
      const screenshot = await captureScreenshot();
      const requestId = Math.random().toString(36).slice(2);
      const result = await sendRequest(
        {
          type: 'assist',
          requestId,
          prompt,
          url: snap.url,
          snapshot: snap.snapshot,
          screenshot,
        },
        setStatus,
      );
      if (result.type === 'answer') {
        setMessages((m) => [...m, { role: 'assistant', text: result.markdown }]);
      } else {
        const { mod, reg } = await applyGeneratedMod(
          result.mod,
          snap.url,
          prompt || result.mod.description,
        );
        const note = !reg.ok
          ? ` (couldn’t go live: ${reg.error ?? 'userScripts off'})`
          : result.mod.warning
            ? ` ⚠️ ${result.mod.warning}`
            : '';
        setMessages((m) => [
          ...m,
          { role: 'assistant', text: `Applied “${mod.title}”.${note}`, mod },
        ]);
      }
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: e instanceof Error ? e.message : String(e), error: true },
      ]);
    } finally {
      setBusy(false);
      setStatus('');
    }
  }

  async function toggleMod(mod: Mod) {
    const updated = { ...mod, enabled: !mod.enabled, updatedAt: Date.now() };
    await upsertMod(updated);
    await bg(
      updated.enabled
        ? { type: 'REGISTER_MOD', mod: updated }
        : { type: 'UNREGISTER_MOD', id: updated.id },
    );
    await refreshMods();
  }

  async function togglePublish(mod: Mod) {
    const updated = { ...mod, published: !mod.published, updatedAt: Date.now() };
    await upsertMod(updated);
    await pushMod(updated).catch(() => {});
    await setPublic(updated.id, !!updated.published).catch(() => {});
    await refreshMods();
  }

  async function removeMod(mod: Mod) {
    await deleteMod(mod.id);
    await bg({ type: 'UNREGISTER_MOD', id: mod.id });
    await removeRemote(mod.id).catch(() => {});
    await refreshMods();
  }

  function startEdit(mod: Mod) {
    setEditing(mod);
    setTab('chat');
    setInput('');
    setMessages((m) => [
      ...m,
      {
        role: 'assistant',
        text: `Editing “${mod.title}”. Describe the change you want.`,
      },
    ]);
  }

  async function installCommunity(doc: CommunityMod) {
    const now = Date.now();
    const mod: Mod = {
      id: newModId(),
      title: doc.title,
      description: doc.description,
      matches: doc.matches,
      js: doc.js,
      css: doc.css,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      prompt: doc.description,
      published: false,
      history: [],
    };
    await applyMod(mod);
    await countInstall(doc._id).catch(() => {});
    setTab('mods');
  }

  return (
    <div className="flex h-full flex-col bg-[#0b0d12] text-[#e6e8ee]">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold tracking-tight">Tailor</span>
          <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-medium text-indigo-300">
            beta
          </span>
        </div>
        <nav className="flex gap-1 text-sm">
          <button
            onClick={() => setTab('chat')}
            className={`rounded-md px-3 py-1 ${tab === 'chat' ? 'bg-white/10' : 'hover:bg-white/5'}`}
          >
            Chat
          </button>
          <button
            onClick={() => setTab('mods')}
            className={`rounded-md px-3 py-1 ${tab === 'mods' ? 'bg-white/10' : 'hover:bg-white/5'}`}
          >
            My Mods{mods.length ? ` (${mods.length})` : ''}
          </button>
          <button
            onClick={() => setTab('community')}
            className={`rounded-md px-3 py-1 ${tab === 'community' ? 'bg-white/10' : 'hover:bg-white/5'}`}
          >
            Community
          </button>
        </nav>
      </header>

      {userScriptsOk === false && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
          Turn on <strong>“Allow User Scripts”</strong> on Tailor’s details page
          (chrome://extensions → Tailor → Details) so mods can run.
        </div>
      )}

      {tab === 'chat' && (
        <>
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-indigo-600 text-white'
                      : m.error
                        ? 'bg-red-500/15 text-red-200'
                        : 'bg-white/8 text-[#e6e8ee]'
                  }`}
                >
                  {m.text}
                  {m.mod && (
                    <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-black/40 p-2 text-[11px] text-emerald-200">
                      {m.mod.css ? `/* css */\n${m.mod.css}\n\n` : ''}
                      {m.mod.js ? `// js\n${m.mod.js}` : ''}
                    </pre>
                  )}
                </div>
              </div>
            ))}
            {messages.length <= 1 && !busy && (
              <div className="flex flex-wrap gap-2 pt-1">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setInput(s)}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 hover:bg-white/10"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {busy && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-white/8 px-3 py-2 text-sm text-white/70">
                  {status || 'Working…'}
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-white/10 p-3">
            {editing && (
              <div className="mb-2 flex items-center justify-between rounded-md bg-white/5 px-2 py-1 text-xs text-white/70">
                <span>Editing “{editing.title}”</span>
                <button
                  className="text-indigo-300 hover:underline"
                  onClick={() => setEditing(null)}
                >
                  cancel
                </button>
              </div>
            )}
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                rows={2}
                placeholder="Describe a change to this site…"
                className="flex-1 resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/30 focus:border-indigo-400/50"
                disabled={busy}
              />
              <button
                onClick={handleHelp}
                disabled={busy}
                title="Help with this screen — Tailor looks at the page"
                className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-base disabled:opacity-40"
              >
                👁
              </button>
              <button
                onClick={handleSend}
                disabled={busy || !input.trim()}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>
        </>
      )}

      {tab === 'mods' && (
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {mods.length === 0 && (
            <p className="text-sm text-white/50">
              No mods yet. Switch to Chat and describe a change.
            </p>
          )}
          {mods.map((mod) => (
            <div
              key={mod.id}
              className="rounded-xl border border-white/10 bg-white/5 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{mod.title}</span>
                    {mod.kind === 'widget' && (
                      <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[9px] font-medium text-emerald-300">
                        widget
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-white/50">{mod.description}</div>
                  <div className="mt-1 text-[10px] text-white/30">
                    {mod.matches.join(', ')}
                  </div>
                </div>
                <label className="flex cursor-pointer items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={mod.enabled}
                    onChange={() => toggleMod(mod)}
                  />
                  {mod.enabled ? 'on' : 'off'}
                </label>
              </div>
              <div className="mt-2 flex items-center gap-3 text-xs">
                <button
                  className="text-indigo-300 hover:underline"
                  onClick={() => startEdit(mod)}
                >
                  edit
                </button>
                <button
                  className="text-red-300 hover:underline"
                  onClick={() => removeMod(mod)}
                >
                  delete
                </button>
                {convexEnabled() && mod.kind !== 'widget' && (
                  <label className="flex cursor-pointer items-center gap-1 text-white/60">
                    <input
                      type="checkbox"
                      checked={!!mod.published}
                      onChange={() => togglePublish(mod)}
                    />
                    publish
                  </label>
                )}
                {mod.history.length > 0 && (
                  <span className="text-white/30">v{mod.history.length + 1}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'community' && (
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {!convexEnabled() ? (
            <p className="text-sm text-white/50">
              Community library is off. Set <code>WXT_CONVEX_URL</code> (from{' '}
              <code>npx convex dev</code>) and rebuild to browse and share mods.
            </p>
          ) : community.length === 0 ? (
            <p className="text-sm text-white/50">
              No published mods yet. Publish one from My Mods to seed the library.
            </p>
          ) : (
            community.map((doc) => (
              <div
                key={doc._id}
                className="rounded-xl border border-white/10 bg-white/5 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{doc.title}</div>
                    <div className="text-xs text-white/50">{doc.description}</div>
                    <div className="mt-1 text-[10px] text-white/30">
                      {doc.matches.join(', ')} · {doc.installs} installs
                    </div>
                  </div>
                  <button
                    className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white"
                    onClick={() => installCommunity(doc)}
                  >
                    Install
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
