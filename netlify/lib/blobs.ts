import { getStore } from "@netlify/blobs";

export interface KVStore {
  getJSON<T>(key: string): Promise<T | null>;
  setJSON(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export class InMemoryStore implements KVStore {
  private map = new Map<string, string>();

  async getJSON<T>(key: string): Promise<T | null> {
    const raw = this.map.get(key);
    return raw == null ? null : (JSON.parse(raw) as T);
  }
  async setJSON(key: string, value: unknown): Promise<void> {
    this.map.set(key, JSON.stringify(value));
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  async list(prefix = ""): Promise<string[]> {
    return [...this.map.keys()].filter((k) => k.startsWith(prefix));
  }
}

export function createConfigStore(opts: { testMode?: boolean } = {}): KVStore {
  if (opts.testMode || process.env.NODE_ENV === "test") {
    return new InMemoryStore();
  }
  const store = getStore({ name: "lessenza-config", consistency: "strong" });
  return {
    async getJSON<T>(key: string): Promise<T | null> {
      const data = await store.get(key, { type: "json" });
      return (data as T) ?? null;
    },
    async setJSON(key: string, value: unknown): Promise<void> {
      await store.setJSON(key, value);
    },
    async delete(key: string): Promise<void> {
      await store.delete(key);
    },
    async list(prefix = ""): Promise<string[]> {
      const out: string[] = [];
      const result = await store.list({ prefix });
      const blobs = (result as { blobs?: { key: string }[] }).blobs;
      if (Array.isArray(blobs)) {
        for (const b of blobs) out.push(b.key);
      }
      return out;
    },
  };
}

// Lazy module-level singleton for runtime
let runtimeStore: KVStore | null = null;
export function store(): KVStore {
  if (!runtimeStore) runtimeStore = createConfigStore();
  return runtimeStore;
}
export function resetStoreForTests(s: KVStore): void {
  runtimeStore = s;
}
