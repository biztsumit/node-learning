// A small in-memory cache for public catalog reads (product lists, products, categories).
//
//   wrap(key, load) → the cached value if it's fresh, otherwise load() it and remember it
//   clear()         → forget everything (called whenever the catalog changes)
//
// Each server has its own copy in memory, so nothing extra to run. The catch with caching is
// knowing when data is out of date; see invalidation.js for how that's handled.
import { env } from "../config/env.ts";

const MAX_ENTRIES = 500;   // different searches/pages each take one entry; oldest go first

const entries = new Map();   // key → { value, expiresAt }   (a Map remembers insertion order)
const stats = { hits: 0, misses: 0, clears: 0 };
let ttlMs = env.CACHE_TTL_SECONDS * 1000;

export const catalogCache = {

  get enabled() {
    return ttlMs > 0;
  },

  // Tests switch caching on or off with this (CACHE_TTL_SECONDS=0 turns it off)
  configure({ ttlSeconds }) {
    ttlMs = ttlSeconds * 1000;
    entries.clear();
  },

  // Returns { value, hit }
  async wrap(key, load) {
    if (!this.enabled) {
      return { value: await load(), hit: false };
    }

    const entry = entries.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      stats.hits++;
      return { value: entry.value, hit: true };
    }

    stats.misses++;
    // Remember which "generation" of the cache this load started in. If the catalog changes
    // WHILE we're loading, the result may already be stale, so we don't store it.
    const generation = stats.clears;
    const value = await load();
    if (generation === stats.clears) {
      entries.delete(key);
      entries.set(key, { value, expiresAt: Date.now() + ttlMs });
      if (entries.size > MAX_ENTRIES) {
        entries.delete(entries.keys().next().value);   // the oldest entry
      }
    }
    return { value, hit: false };
  },

  clear() {
    entries.clear();
    stats.clears++;
  },

  stats() {
    return { ...stats, entries: entries.size };
  }
};

// Same query in a different order = same cache entry: { b: 1, a: 2 } and { a: 2, b: 1 }
export const cacheKey = (prefix, params = {}) =>
  `${prefix}:${JSON.stringify(Object.keys(params).sort().map((k) => [k, params[k]]))}`;
