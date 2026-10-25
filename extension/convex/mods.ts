import { query, mutation } from './_generated/server';
import { v } from 'convex/values';

const modFields = {
  deviceId: v.string(),
  localId: v.string(),
  title: v.string(),
  description: v.string(),
  matches: v.array(v.string()),
  js: v.string(),
  css: v.string(),
  public: v.boolean(),
};

async function findOwn(ctx: any, deviceId: string, localId: string) {
  return ctx.db
    .query('mods')
    .withIndex('by_device_local', (q: any) =>
      q.eq('deviceId', deviceId).eq('localId', localId),
    )
    .unique();
}

/** All mods belonging to this device. */
export const mine = query({
  args: { deviceId: v.string() },
  handler: (ctx, { deviceId }) =>
    ctx.db
      .query('mods')
      .withIndex('by_device', (q) => q.eq('deviceId', deviceId))
      .collect(),
});

/** The public community library, newest first. */
export const listPublic = query({
  args: {},
  handler: (ctx) =>
    ctx.db
      .query('mods')
      .withIndex('by_public', (q) => q.eq('public', true))
      .order('desc')
      .take(100),
});

/** Upsert a device's mod (called whenever a mod is created or edited locally). */
export const publish = mutation({
  args: modFields,
  handler: async (ctx, args) => {
    const existing = await findOwn(ctx, args.deviceId, args.localId);
    const patch = { ...args, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return ctx.db.insert('mods', { ...patch, installs: 0 });
  },
});

/** Flip a mod's public flag. */
export const setPublic = mutation({
  args: { deviceId: v.string(), localId: v.string(), public: v.boolean() },
  handler: async (ctx, { deviceId, localId, public: isPublic }) => {
    const existing = await findOwn(ctx, deviceId, localId);
    if (existing) await ctx.db.patch(existing._id, { public: isPublic });
  },
});

/** Remove a device's mod from the cloud. */
export const remove = mutation({
  args: { deviceId: v.string(), localId: v.string() },
  handler: async (ctx, { deviceId, localId }) => {
    const existing = await findOwn(ctx, deviceId, localId);
    if (existing) await ctx.db.delete(existing._id);
  },
});

/** Count an install of a community mod. */
export const install = mutation({
  args: { id: v.id('mods') },
  handler: async (ctx, { id }) => {
    const mod = await ctx.db.get(id);
    if (mod) await ctx.db.patch(id, { installs: mod.installs + 1 });
  },
});
