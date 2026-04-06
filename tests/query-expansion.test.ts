import { describe, expect, it } from "vitest";
import {
  buildQueryVariants,
  prioritizeQueryVariants
} from "../src/utils/query-expansion.js";

describe("query expansion", () => {
  it("expands Chinese petroleum-domain queries into English companions", () => {
    const variants = buildQueryVariants("测井", "keyword");
    expect(variants).toContain("测井");
    expect(variants).toContain("well logging");
    expect(variants).toContain("logging");
  });

  it("expands English logging queries into Chinese companions", () => {
    const variants = buildQueryVariants("well logging", "title");
    expect(variants).toContain("well logging");
    expect(variants).toContain("测井");
  });

  it("does not expand author queries", () => {
    expect(buildQueryVariants("张三", "author")).toEqual(["张三"]);
  });

  it("prioritizes Chinese variants for Chinese-library providers", () => {
    const prioritized = prioritizeQueryVariants("cnki", ["well logging", "测井"]);
    expect(prioritized[0]).toBe("测井");
  });

  it("prioritizes English variants for metadata-first English providers", () => {
    const prioritized = prioritizeQueryVariants("onepetro", ["测井", "well logging"]);
    expect(prioritized[0]).toBe("well logging");
  });
});
