interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface LoadedValue<T> {
  value: T;
  snapshot: T;
}

export interface RequestCacheOptions<T> {
  enabled: boolean;
  ttlMs: number;
  maxEntries: number;
  clone: (value: T) => T;
  isCacheable: (value: T) => boolean;
  now?: () => number;
}

/** A bounded LRU cache that also shares concurrent loads of the same key. */
export class RequestCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly pending = new Map<string, Promise<LoadedValue<T>>>();
  private readonly now: () => number;

  constructor(private readonly options: RequestCacheOptions<T>) {
    this.now = options.now ?? Date.now;
  }

  get(key: string, load: () => Promise<T>): Promise<T> {
    if (!this.options.enabled || this.options.ttlMs <= 0 || this.options.maxEntries <= 0) return load();
    const entry = this.entries.get(key);
    if (entry) {
      if (entry.expiresAt > this.now()) {
        this.entries.delete(key);
        this.entries.set(key, entry);
        return Promise.resolve(this.options.clone(entry.value));
      }
      this.entries.delete(key);
    }
    const pending = this.pending.get(key);
    if (pending) return pending.then(({ snapshot }) => this.options.clone(snapshot));
    // Keep the bookkeeping bounded even during a burst of distinct requests.
    if (this.pending.size >= this.options.maxEntries) return load();

    const operation = Promise.resolve().then(load).then((value) => {
      const snapshot = this.options.clone(value);
      if (this.options.isCacheable(value)) {
        for (const [entryKey, cached] of this.entries) {
          if (cached.expiresAt <= this.now()) this.entries.delete(entryKey);
        }
        this.entries.set(key, {
          value: snapshot,
          expiresAt: this.now() + this.options.ttlMs,
        });
        while (this.entries.size > this.options.maxEntries) {
          const oldest = this.entries.keys().next().value;
          if (oldest === undefined) break;
          this.entries.delete(oldest);
        }
      }
      return { value, snapshot };
    }).finally(() => {
      this.pending.delete(key);
    });
    this.pending.set(key, operation);
    return operation.then(({ value }) => value);
  }
}
