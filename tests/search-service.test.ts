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

  it("uses protocol-only CNKI context during search enrichment", async () => {
    const seenRuntimeModes: string[] = [];
    const service = new SearchService(
      {
        searchEnrichmentLimit: 1,
        cnkiRuntimeMode: "auto"
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
          id: "cnki",
          async search() {
            return {
              source: "cnki",
              total: 1,
              items: [
                {
                  id: "cnki-record",
                  source: "cnki",
                  title: "Logging example",
                  authors: ["A"],
                  year: 2025,
                  access: "session_required",
                  detailUrl: "https://kns.cnki.net/kcms2/article/abstract?v=test"
                }
              ]
            };
          },
          async getRecord(_locator, context) {
            seenRuntimeModes.push(context.config.cnkiRuntimeMode);
            throw new Error("protocol detail blocked");
          },
          async resolveDownload() {
            return [];
          }
        }
      ]
    );

    const result = await service.search({
      source: "cnki",
      query: "logging",
      mode: "keyword",
      maxResults: 5
    });

    expect(result.total).toBe(1);
    expect(seenRuntimeModes).toEqual(["http_only"]);
  });

  it("keeps trying English CNKI variants before falling back to Chinese companions", async () => {
    const seenQueries: string[] = [];
    const service = new SearchService(
      {
        searchEnrichmentLimit: 0,
        cnkiRuntimeMode: "auto"
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
          id: "cnki",
          async search(request) {
            seenQueries.push(request.query);
            return {
              source: "cnki",
              total: 5,
              items: new Array(5).fill(null).map((_, index) => ({
                id: `${request.query}-${index}`,
                source: "cnki",
                title: request.query === "logging" ? `Logging ${index}` : `Result ${index}`,
                authors: ["A"],
                year: 2025,
                access: "session_required"
              }))
            };
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
      source: "cnki",
      query: "well logging",
      mode: "keyword",
      maxResults: 5
    });

    expect(result.total).toBe(5);
    expect(seenQueries.slice(0, 2)).toEqual(["well logging", "logging"]);
  });
});
