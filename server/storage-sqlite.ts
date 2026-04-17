import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import type { KVStore } from "../netlify/lib/blobs";

/**
 * SQLite-backed KVStore — the self-hosted replacement for Netlify Blobs.
 *
 * Single table:
 *   kv(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)
 *
 * `list(prefix)` is indexed by key so prefix scans are O(log n).
 * Writes are atomic per-statement and run in WAL mode for concurrent reads.
 */
export class SqliteStore implements KVStore {
  private db: Database.Database;
  private stmtGet: Database.Statement<[string]>;
  private stmtSet: Database.Statement<[string, string, number]>;
  private stmtDel: Database.Statement<[string]>;
  private stmtList: Database.Statement<[string]>;

  constructor(filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS idx_kv_key_prefix ON kv(key);
    `);
    this.stmtGet = this.db.prepare("SELECT value FROM kv WHERE key = ?");
    this.stmtSet = this.db.prepare(
      "INSERT INTO kv(key, value, updated_at) VALUES(?, ?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    );
    this.stmtDel = this.db.prepare("DELETE FROM kv WHERE key = ?");
    this.stmtList = this.db.prepare("SELECT key FROM kv WHERE key LIKE ? ORDER BY key");
  }

  async getJSON<T>(key: string): Promise<T | null> {
    const row = this.stmtGet.get(key) as { value: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }

  async setJSON(key: string, value: unknown): Promise<void> {
    this.stmtSet.run(key, JSON.stringify(value), Date.now());
  }

  async delete(key: string): Promise<void> {
    this.stmtDel.run(key);
  }

  async list(prefix = ""): Promise<string[]> {
    // SQLite LIKE pattern — escape % and _ in prefix so they match literally.
    const escaped = prefix.replace(/([%_\\])/g, "\\$1");
    const pattern = escaped + "%";
    const rows = this.stmtList.all(pattern) as { key: string }[];
    return rows.map((r) => r.key);
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Resolves the SQLite DB path from env or a sensible default.
 * LESSENZA_DB_PATH wins; otherwise uses ./data/lessenza.db under cwd.
 */
export function resolveDbPath(): string {
  const envPath = process.env.LESSENZA_DB_PATH;
  if (envPath && envPath.trim()) return path.resolve(envPath.trim());
  return path.resolve(process.cwd(), "data", "lessenza.db");
}
