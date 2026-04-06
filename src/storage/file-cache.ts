import { resolve } from "node:path";
import { readJsonIfExists, writeJson } from "../utils/files.js";
import { sha1 } from "../utils/hash.js";

interface CacheEnvelope<T> {
  expiresAt: string;
  value: T;
}

export class FileCache {
  constructor(private readonly rootDir: string) {}

  async get<T>(namespace: string, key: string): Promise<T | null> {
    const path = this.toPath(namespace, key);
    const cached = await readJsonIfExists<CacheEnvelope<T>>(path);
    if (!cached) {
      return null;
    }
    if (Date.now() > new Date(cached.expiresAt).getTime()) {
      return null;
    }
    return cached.value;
  }

  async set<T>(
    namespace: string,
    key: string,
    value: T,
    ttlMs: number
  ): Promise<void> {
    const path = this.toPath(namespace, key);
    await writeJson(path, {
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      value
    } satisfies CacheEnvelope<T>);
  }

  private toPath(namespace: string, key: string): string {
    return resolve(this.rootDir, namespace, `${sha1(key)}.json`);
  }
}
