import { describe, expect, it } from "vitest";
import {
  buildQueryVariants,
  prioritizeQueryVariants
} from "../src/utils/query-expansion.js";

describe("query expansion", () => {
  it("expands Chinese petroleum-domain queries into English companions", () => {
    const variants = buildQueryVariants("\u6d4b\u4e95", "keyword");
    expect(variants).toContain("\u6d4b\u4e95");
    expect(variants).toContain("well logging");
    expect(variants).toContain("logging");
  });

  it("expands English logging queries into Chinese and English companions", () => {
    const variants = buildQueryVariants("well logging", "title");
    expect(variants).toContain("well logging");
    expect(variants).toContain("logging");
    expect(variants).toContain("\u6d4b\u4e95");
  });

  it("does not expand author queries", () => {
    expect(buildQueryVariants("\u5f20\u4e09", "author")).toEqual(["\u5f20\u4e09"]);
  });

  it("keeps the original query first for Chinese-library providers", () => {
    const prioritized = prioritizeQueryVariants("cnki", [
      "well logging",
      "\u6d4b\u4e95",
      "logging"
    ]);
    expect(prioritized[0]).toBe("well logging");
    expect(prioritized[1]).toBe("logging");
  });

  it("prioritizes English companions for metadata-first English providers", () => {
    const prioritized = prioritizeQueryVariants("onepetro", [
      "logging",
      "\u6d4b\u4e95",
      "well logging"
    ]);
    expect(prioritized[0]).toBe("logging");
    expect(prioritized[1]).toBe("well logging");
  });
});
