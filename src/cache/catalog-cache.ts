// A small in-memory cache for public catalog reads (product lists, products, categories).
//
//   wrap(key, load) → the cached value if it's fresh, otherwise load() it and remember it
//   clear()         → forget everything (called whenever the catalog changes)
//
// Each server has its own copy in memory, so nothing extra to run. The catch with caching is
// knowing when data is out of date; see invalidation.js for how that's handled.
import { env } from "../config/env.ts";

const MAX_ENTRIES = 500;   // different searches/pages each take one entry; oldest go first

// key → { value, expiresAt }   (a Map remembers insertion order).
// Values of different types share the map; each key always holds the same kind of value.
const entries = new Map<string, { value: unknown; expiresAt: number }>();
const stats = { hits: 0, misses: 0, clears: 0 };
let ttlMs = env.CACHE_TTL_SECONDS * 1000;

export const catalogCache = {

  get enabled() {
    return ttlMs > 0;
  },

  // Tests switch caching on or off with this (CACHE_TTL_SECONDS=0 turns it off)
  configure({ ttlSeconds }: { ttlSeconds: number }): void {
    ttlMs = ttlSeconds * 1000;
    entries.clear();
  },

  // Returns { value, hit }. <T>: the value has the type load() returns
  async wrap<T>(key: string, load: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
    if (!this.enabled) {
      return { value: await load(), hit: false };
    }

    const entry = entries.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      stats.hits++;
      return { value: entry.value as T, hit: true };
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
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) {
          entries.delete(oldest);
        }
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
export const cacheKey = (prefix: string, params: object = {}): string =>
  `${prefix}:${JSON.stringify(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))}`;
