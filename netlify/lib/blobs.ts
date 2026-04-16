import { getStore } from "@netlify/blobs";
import * as fs from "node:fs";
import * as path from "node:path";

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

// Simple file-based store for unlinked `netlify dev` so data survives across
// function invocations and worker restarts. Not for production use.
class FileStore implements KVStore {
  private dir: string;
  constructor(dir: string) {
    this.dir = dir;
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  }
  private file(key: string): string {
    const safe = key.replace(/[^a-zA-Z0-9_.-]/g, "_");
    return path.join(this.dir, safe + ".json");
  }
  async getJSON<T>(key: string): Promise<T | null> {
    try {
      const raw = fs.readFileSync(this.file(key), "utf8");
      return JSON.parse(raw) as T;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") return null;
      throw err;
    }
  }
  async setJSON(key: string, value: unknown): Promise<void> {
    fs.writeFileSync(this.file(key), JSON.stringify(value, null, 2));
  }
  async delete(key: string): Promise<void> {
    try { fs.unlinkSync(this.file(key)); } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "ENOENT") throw err;
    }
  }
  async list(prefix = ""): Promise<string[]> {
    try {
      const files = fs.readdirSync(this.dir);
      const keys: string[] = [];
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const key = f.slice(0, -5).replace(/_/g, "/"); // best-effort reverse of safe replacement
        if (key.startsWith(prefix)) keys.push(key);
      }
      return keys;
    } catch {
      return [];
    }
  }
}

let devFallback: KVStore | null = null;
function getDevFallback(): KVStore {
  if (!devFallback) {
    // Use /tmp (writable on Lambda) if in Netlify, else local folder.
    const baseDir = process.env.NETLIFY_DEV
      ? path.resolve(process.cwd(), ".netlify-dev-blobs")
      : path.join("/tmp", "lessenza-blobs");
    devFallback = new FileStore(baseDir);
  }
  return devFallback;
}

function isLocalDev(): boolean {
  // true when running `netlify dev` unlinked, false in production functions.
  return !!process.env.NETLIFY_DEV;
}

export function createConfigStore(opts: { testMode?: boolean } = {}): KVStore {
  if (opts.testMode || process.env.NODE_ENV === "test") {
    return new InMemoryStore();
  }
  // Try to acquire the Netlify Blobs store — first via auto-context,
  // then via explicit siteID + token (required for classic v1 handlers).
  let store: ReturnType<typeof getStore>;
  try {
    store = getStore({ name: "lessenza-config", consistency: "strong" });
  } catch (autoErr) {
    const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
    const token = process.env.NETLIFY_BLOBS_TOKEN;
    if (siteID && token) {
      try {
        store = getStore({ name: "lessenza-config", consistency: "strong", siteID, token });
      } catch (manualErr) {
        if (isLocalDev()) return getDevFallback();
        console.error("Netlify Blobs (manual) unavailable:", manualErr);
        throw manualErr;
      }
    } else {
      if (isLocalDev()) return getDevFallback();
      console.error("Netlify Blobs unavailable and no NETLIFY_BLOBS_TOKEN set:", autoErr);
      throw autoErr;
    }
  }
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
