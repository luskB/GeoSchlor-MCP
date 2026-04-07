import { describe, expect, it } from "vitest";
import { ScholarSearchService } from "../src/services/scholar-search-service.js";

describe("ScholarSearchService", () => {
  it("ranks author-matched institution papers ahead of unrelated institution-topic papers", async () => {
    const service = new ScholarSearchService(
      {
        searchCacheTtlMs: 60_000
      } as any,
      {
        async getJson(url: string) {
          const current = new URL(url);
          if (current.pathname === "/institutions") {
            return {
              results: [
                {
                  id: "https://openalex.org/I4210162190",
                  display_name: "China University of Petroleum, East China",
                  relevance_score: 99
                }
              ]
            };
          }

          if (current.pathname === "/authors") {
            return {
              results: [
                {
                  id: "https://openalex.org/A5101790603",
                  display_name: "Kai Zhang",
                  display_name_alternatives: ["Kai Zhang", "Zhang Kai"],
                  relevance_score: 50,
                  works_count: 8,
                  last_known_institutions: [
                    {
                      id: "https://openalex.org/I4210162190",
                      display_name: "China University of Petroleum, East China"
                    }
                  ]
                }
              ]
            };
          }

          if (current.pathname === "/works") {
            const filter = current.searchParams.get("filter") ?? "";
            if (filter.includes("authorships.institutions.id")) {
              return {
                results: [
                  {
                    id: "https://openalex.org/W1",
                    doi: "https://doi.org/10.1190/example-1",
                    display_name: "Design of a New Acoustic Logging While Drilling Tool",
                    publication_year: 2021,
                    publication_date: "2021-05-01",
                    authorships: [
                      {
                        author: { display_name: "Kai Zhang" },
                        institutions: [
                          { display_name: "China University of Petroleum, East China" }
                        ]
                      },
                      {
                        author: { display_name: "Baohai Tan" },
                        institutions: [
                          { display_name: "China University of Petroleum, East China" }
                        ]
                      }
                    ],
                    abstract_inverted_index: {
                      acoustic: [0],
                      logging: [1],
                      tool: [2]
                    },
                    primary_location: {
                      landing_page_url: "https://doi.org/10.1190/example-1",
                      source: {
                        display_name: "Sensors",
                        host_organization_name: "MDPI"
                      }
                    },
                    open_access: {
                      is_oa: true,
                      oa_status: "gold",
                      oa_url: "https://example.com/example-1.pdf"
                    },
                    cited_by_count: 5,
                    referenced_works_count: 20
                  },
                  {
                    id: "https://openalex.org/W2",
                    doi: "https://doi.org/10.1190/example-2",
                    display_name: "Acoustic Logging Simulation for Reservoir Characterization",
                    publication_year: 2023,
                    publication_date: "2023-07-10",
                    authorships: [
                      {
                        author: { display_name: "Li Wei" },
                        institutions: [
                          { display_name: "China University of Petroleum, East China" }
                        ]
                      }
                    ],
                    abstract_inverted_index: {
                      acoustic: [0],
                      logging: [1],
                      simulation: [2]
                    },
                    primary_location: {
                      landing_page_url: "https://doi.org/10.1190/example-2",
                      source: {
                        display_name: "Journal of Logging",
                        host_organization_name: "Example Press"
                      }
                    },
                    open_access: {
                      is_oa: false,
                      oa_status: "closed"
                    },
                    cited_by_count: 12,
                    referenced_works_count: 18
                  }
                ]
              };
            }

            if (filter.includes("author.id")) {
              return {
                results: [
                  {
                    id: "https://openalex.org/W1",
                    doi: "https://doi.org/10.1190/example-1",
                    display_name: "Design of a New Acoustic Logging While Drilling Tool",
                    publication_year: 2021,
                    publication_date: "2021-05-01",
                    authorships: [
                      {
                        author: { display_name: "Kai Zhang" },
                        institutions: [
                          { display_name: "China University of Petroleum, East China" }
                        ]
                      }
                    ],
                    abstract_inverted_index: {
                      acoustic: [0],
                      logging: [1],
                      tool: [2]
                    },
                    primary_location: {
                      landing_page_url: "https://doi.org/10.1190/example-1",
                      source: {
                        display_name: "Sensors",
                        host_organization_name: "MDPI"
                      }
                    },
                    open_access: {
                      is_oa: true,
                      oa_status: "gold",
                      oa_url: "https://example.com/example-1.pdf"
                    },
                    cited_by_count: 5,
                    referenced_works_count: 20
                  }
                ]
              };
            }
          }

          throw new Error(`Unexpected URL: ${url}`);
        }
      } as any,
      {
        async get() {
          return null;
        },
        async set() {
          return undefined;
        }
      } as any
    );

    const result = await service.search({
      authorName: "张凯",
      institution: "中国石油大学",
      topic: "acoustic logging",
      maxResults: 5
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toContain("Acoustic Logging While Drilling");
    expect(result.items[0]?.matchedAuthorAliases).toContain("Kai Zhang");
    expect(result.items[0]?.matchSignals).toContain("author:Kai Zhang");
    expect(result.notes).toContain(
      "Lower-confidence institution/topic matches were hidden because higher-confidence author-matched scholar results were found."
    );
  });

  it("expands Chinese topic hints into English-first OpenAlex queries", async () => {
    const seenSearchTerms: string[] = [];
    const service = new ScholarSearchService(
      {
        searchCacheTtlMs: 60_000
      } as any,
      {
        async getJson(url: string) {
          const current = new URL(url);
          if (current.pathname === "/institutions") {
            return {
              results: [
                {
                  id: "https://openalex.org/I4210162190",
                  display_name: "China University of Petroleum, East China",
                  relevance_score: 99
                }
              ]
            };
          }

          if (current.pathname === "/authors") {
            return {
              results: [
                {
                  id: "https://openalex.org/A5101790603",
                  display_name: "Kai Zhang",
                  display_name_alternatives: ["Kai Zhang", "Zhang Kai"],
                  relevance_score: 50,
                  works_count: 8,
                  last_known_institutions: [
                    {
                      id: "https://openalex.org/I4210162190",
                      display_name: "China University of Petroleum, East China"
                    }
                  ]
                }
              ]
            };
          }

          if (current.pathname === "/works") {
            const search = current.searchParams.get("search");
            if (search) {
              seenSearchTerms.push(search);
            }
            return { results: [] };
          }

          throw new Error(`Unexpected URL: ${url}`);
        }
      } as any,
      {
        async get() {
          return null;
        },
        async set() {
          return undefined;
        }
      } as any
    );

    const result = await service.search({
      authorName: "张凯",
      institution: "中国石油大学",
      topic: "测井",
      maxResults: 5
    });

    expect(result.topicVariants[0]).toBe("well logging");
    expect(result.topicVariants).toContain("logging");
    expect(seenSearchTerms).toContain("well logging");
  });
});
