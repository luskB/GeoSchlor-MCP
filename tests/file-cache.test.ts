import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileCache } from "../src/storage/file-cache.js";

let currentTempDir = "";

describe("FileCache", () => {
  afterEach(async () => {
    if (currentTempDir) {
      await rm(currentTempDir, { recursive: true, force: true });
      currentTempDir = "";
    }
  });

  it("stores and retrieves entries until they expire", async () => {
    currentTempDir = await mkdtemp(join(tmpdir(), "cnki-mcp-cache-"));
    const cache = new FileCache(currentTempDir);

    await cache.set("records", "abc", { value: 1 }, 1000);
    expect(await cache.get("records", "abc")).toEqual({ value: 1 });
  });

  it("returns null after ttl passes", async () => {
    currentTempDir = await mkdtemp(join(tmpdir(), "cnki-mcp-cache-"));
    const cache = new FileCache(currentTempDir);

    await cache.set("records", "abc", { value: 1 }, 1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await cache.get("records", "abc")).toBeNull();
  });
});
