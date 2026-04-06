import { describe, expect, it } from "vitest";
import { SearchService } from "../src/services/search-service.js";
import { buildQueryVariants } from "../src/utils/query-expansion.js";

describe("SearchService", () => {
  it("keeps earlier results when a later query variant fails", async () => {
    const variants = buildQueryVariants("logging", "keyword");
    expect(variants[0]).toBe("logging");
    expect(variants.length).toBeGreaterThan(1);

    const seenQueries: string[] = [];
    const service = new SearchService(
      {
        searchEnrichmentLimit: 0
      } as any,
      {} as any,
      {
        async get() {
          return null;
        },
        async set() {
          return undefined;
        }
      } as any,
      {} as any,
      [
        {
          id: "geophysics",
          async search(request) {
            seenQueries.push(request.query);
            if (request.query === "logging") {
              return {
                source: "geophysics",
                total: 1,
                items: [
                  {
                    id: "10.1190/example",
                    source: "geophysics",
                    title: "Logging example",
                    authors: ["A"],
                    year: 2025,
                    access: "subscription"
                  }
                ],
                notes: ["ok"]
              };
            }

            throw new Error("variant lookup failed");
          },
          async getRecord() {
            return null;
          },
          async resolveDownload() {
            return [];
          }
        }
      ]
    );

    const result = await service.search({
      source: "geophysics",
      query: "logging",
      mode: "keyword",
      maxResults: 5
    });

    expect(result.total).toBe(1);
    expect(result.sources[0]?.items[0]?.title).toBe("Logging example");
    expect(seenQueries[0]).toBe("logging");
    expect(seenQueries.length).toBeGreaterThan(1);
  });
});
