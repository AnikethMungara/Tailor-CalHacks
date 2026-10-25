import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

// Mods synced from the extension. Keyed by an anonymous per-install deviceId + the mod's
// local storage id, so a device can upsert its own mods and publish them to everyone.
export default defineSchema({
  mods: defineTable({
    deviceId: v.string(),
    localId: v.string(),
    title: v.string(),
    description: v.string(),
    matches: v.array(v.string()),
    js: v.string(),
    css: v.string(),
    public: v.boolean(),
    installs: v.number(),
    updatedAt: v.number(),
  })
    .index('by_device', ['deviceId'])
    .index('by_device_local', ['deviceId', 'localId'])
    .index('by_public', ['public']),
});
