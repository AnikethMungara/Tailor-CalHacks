// Convex sync layer: mirrors local mods to the cloud (cross-device sync) and powers the
// live Community Mods library. Everything here degrades to a no-op when no Convex
// deployment URL is configured, so the core extension works with zero Convex setup.
//
// Configure by setting WXT_CONVEX_URL (or VITE_CONVEX_URL) at build time — the value
// `npx convex dev` prints for your deployment.

import { ConvexClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import type { Mod } from './protocol';

const URL: string =
  (import.meta.env as any).WXT_CONVEX_URL ||
  (import.meta.env as any).VITE_CONVEX_URL ||
  '';

export function convexEnabled(): boolean {
  return !!URL;
}

let _client: ConvexClient | null = null;
function client(): ConvexClient | null {
  if (!URL) return null;
  if (!_client) _client = new ConvexClient(URL);
  return _client;
}

const DEVICE_KEY = 'tailor:deviceId';
let _deviceId: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (_deviceId) return _deviceId;
  const r = await chrome.storage.local.get(DEVICE_KEY);
  let id = r[DEVICE_KEY] as string | undefined;
  if (!id) {
    id = 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    await chrome.storage.local.set({ [DEVICE_KEY]: id });
  }
  _deviceId = id;
  return id;
}

export interface CommunityMod {
  _id: string;
  deviceId: string;
  localId: string;
  title: string;
  description: string;
  matches: string[];
  js: string;
  css: string;
  public: boolean;
  installs: number;
  updatedAt: number;
}

export async function pushMod(mod: Mod): Promise<void> {
  const c = client();
  if (!c) return;
  const deviceId = await getDeviceId();
  await c.mutation(anyApi.mods.publish as any, {
    deviceId,
    localId: mod.id,
    title: mod.title,
    description: mod.description,
    matches: mod.matches,
    js: mod.js,
    css: mod.css,
    public: !!mod.published,
  });
}

export async function setPublic(localId: string, isPublic: boolean): Promise<void> {
  const c = client();
  if (!c) return;
  const deviceId = await getDeviceId();
  await c.mutation(anyApi.mods.setPublic as any, {
    deviceId,
    localId,
    public: isPublic,
  });
}

export async function removeRemote(localId: string): Promise<void> {
  const c = client();
  if (!c) return;
  const deviceId = await getDeviceId();
  await c.mutation(anyApi.mods.remove as any, { deviceId, localId });
}

export function subscribeCommunity(cb: (mods: CommunityMod[]) => void): () => void {
  const c = client();
  if (!c) return () => {};
  return c.onUpdate(anyApi.mods.listPublic as any, {}, (rows: any) =>
    cb(rows as CommunityMod[]),
  );
}

export async function countInstall(id: string): Promise<void> {
  const c = client();
  if (!c) return;
  await c.mutation(anyApi.mods.install as any, { id });
}
