import { describe, expect, it } from "vitest";
import { AapgProvider } from "../src/providers/aapg-provider.js";
import { EageProvider } from "../src/providers/eage-provider.js";
import { JgeProvider } from "../src/providers/jge-provider.js";
import { SpeProvider } from "../src/providers/spe-provider.js";
import { SpwlaProvider } from "../src/providers/spwla-provider.js";

describe("MetadataLibraryProvider wrappers", () => {
  it("filters SPE results from generic metadata responses", async () => {
    const provider = new SpeProvider();
    const result = await provider.search(
      {
        source: "spe",
        query: "logging",
        mode: "keyword",
        maxResults: 5
      },
      createProviderContext([
        {
          message: {
            items: [
              {
                DOI: "10.2118/4022-ms",
                title: ["Temperature Logging In Injection Wells"],
                publisher: "SPE",
                "container-title": ["Fall Meeting of the Society of Petroleum Engineers of AIME"],
                URL: "https://doi.org/10.2118/4022-ms",
                resource: {
                  primary: {
                    URL: "https://onepetro.org/SPEATCE/proceedings/72FM/72FM/SPE-4022-MS/164274"
                  }
                }
              },
              {
                DOI: "10.1190/geo-2025-0392",
                title: ["Not SPE"],
                publisher: "Society of Exploration Geophysicists",
                "container-title": ["GEOPHYSICS"],
                URL: "https://doi.org/10.1190/geo-2025-0392"
              }
            ]
          }
        },
        { results: [] }
      ])
    );

    expect(result.total).toBe(1);
    expect(result.items[0]?.source).toBe("spe");
    expect(result.items[0]?.doi).toBe("10.2118/4022-ms");
  });

  it("keeps SPWLA symposium records identified by DOI prefix and publisher", async () => {
    const provider = new SpwlaProvider();
    const result = await provider.search(
      {
        source: "spwla",
        query: "logging",
        mode: "keyword",
        maxResults: 5
      },
      createProviderContext([
        {
          message: {
            items: [
              {
                DOI: "10.30632/t60als-2019_tttt",
                title: ["A NEW THROUGH-CASING ACOUSTIC LOGGING TOOL USING DUAL-SOURCE TRANSMITTERS"],
                publisher: "Society of Petrophysicists and Well Log Analysts",
                "container-title": ["SPWLA 60th Annual Logging Symposium Transactions"],
                URL: "https://doi.org/10.30632/t60als-2019_tttt",
                resource: {
                  primary: {
                    URL: "https://www.spwla.org/SPWLA/Publications/Publication_Detail.aspx?iProductCode=2019_TTTT"
                  }
                }
              }
            ]
          }
        },
        { results: [] }
      ])
    );

    expect(result.total).toBe(1);
    expect(result.items[0]?.source).toBe("spwla");
    expect(result.items[0]?.doi).toBe("10.30632/t60als-2019_tttt");
  });

  it("matches EAGE EarthDoc records from OpenAlex landing pages", async () => {
    const provider = new EageProvider();
    const result = await provider.search(
      {
        source: "eage",
        query: "logging",
        mode: "keyword",
        maxResults: 5
      },
      createProviderContext([
        { message: { items: [] } },
        {
          results: [
            {
              id: "https://openalex.org/W1",
              doi: "https://doi.org/10.3997/2214-4609.2021613008",
              display_name: "Seismic Logging While Drilling Evolution",
              publication_year: 2021,
              primary_location: {
                landing_page_url: "https://www.earthdoc.org/content/papers/10.3997/2214-4609.2021613008",
                source: {
                  display_name: "Sixth EAGE Borehole Geophysics Workshop",
                  host_organization_name: "European Association of Geoscientists & Engineers"
                }
              },
              open_access: {
                is_oa: false
              }
            }
          ]
        }
      ])
    );

    expect(result.total).toBe(1);
    expect(result.items[0]?.source).toBe("eage");
    expect(result.items[0]?.doi).toBe("10.3997/2214-4609.2021613008");
  });

  it("matches Journal of Geophysics and Engineering records", async () => {
    const provider = new JgeProvider();
    const result = await provider.search(
      {
        source: "jge",
        query: "logging",
        mode: "keyword",
        maxResults: 5
      },
      createProviderContext([
        {
          message: {
            items: [
              {
                DOI: "10.1093/jge/gxaf012",
                title: ["A logging-constrained inversion workflow for complex reservoirs"],
                publisher: "Oxford University Press",
                "container-title": ["Journal of Geophysics and Engineering"],
                URL: "https://doi.org/10.1093/jge/gxaf012",
                resource: {
                  primary: {
                    URL: "https://academic.oup.com/jge/article/22/2/123/8123456"
                  }
                }
              },
              {
                DOI: "10.1190/geo-2025-0392",
                title: ["Not JGE"],
                publisher: "Society of Exploration Geophysicists",
                "container-title": ["GEOPHYSICS"],
                URL: "https://doi.org/10.1190/geo-2025-0392"
              }
            ]
          }
        },
        { results: [] }
      ])
    );

    expect(result.total).toBe(1);
    expect(result.items[0]?.source).toBe("jge");
    expect(result.items[0]?.journal).toBe("Journal of Geophysics and Engineering");
    expect(result.items[0]?.doi).toBe("10.1093/jge/gxaf012");
  });

  it("rescues JGE author queries with institution hints via OpenAlex author matching", async () => {
    const provider = new JgeProvider();
    const result = await provider.search(
      {
        source: "jge",
        query: "张凯 中国石油大学 测井",
        mode: "keyword",
        maxResults: 5
      },
      createProviderContext([
        { message: { items: [] } },
        { results: [] },
        {
          results: [
            {
              id: "https://openalex.org/I4210162190",
              display_name: "China University of Petroleum, East China"
            }
          ]
        },
        {
          results: [
            {
              id: "https://openalex.org/A5100323988",
              display_name: "Kai Zhang",
              display_name_alternatives: ["Zhang Kai", "张凯"],
              relevance_score: 500,
              works_count: 12,
              last_known_institutions: [
                {
                  id: "https://openalex.org/I4210162190",
                  display_name: "China University of Petroleum, East China"
                }
              ]
            }
          ]
        },
        {
          results: [
            {
              id: "https://openalex.org/W4210798042",
              doi: "https://doi.org/10.1093/jge/gxab074",
              display_name: "Pulse width research on half-sine excitation signal for bending vibrator",
              publication_year: 2022,
              primary_location: {
                landing_page_url: "https://doi.org/10.1093/jge/gxab074",
                source: {
                  display_name: "Journal of Geophysics and Engineering",
                  issn: ["1742-2132", "1742-2140"]
                }
              },
              authorships: [
                {
                  author: {
                    id: "https://openalex.org/A5100323988",
                    display_name: "Kai Zhang"
                  },
                  institutions: [
                    {
                      display_name: "China University of Petroleum, East China"
                    }
                  ]
                }
              ],
              open_access: {
                is_oa: false
              }
            }
          ]
        },
        {
          results: [
            {
              id: "https://openalex.org/W4210798042",
              doi: "https://doi.org/10.1093/jge/gxab074",
              display_name: "Pulse width research on half-sine excitation signal for bending vibrator",
              publication_year: 2022,
              primary_location: {
                landing_page_url: "https://doi.org/10.1093/jge/gxab074",
                source: {
                  display_name: "Journal of Geophysics and Engineering",
                  issn: ["1742-2132", "1742-2140"]
                }
              },
              authorships: [
                {
                  author: {
                    id: "https://openalex.org/A5100323988",
                    display_name: "Kai Zhang"
                  },
                  institutions: [
                    {
                      id: "https://openalex.org/I4210162190",
                      display_name: "China University of Petroleum, East China"
                    }
                  ]
                }
              ],
              open_access: {
                is_oa: false
              }
            }
          ]
        },
        {
          results: []
        },
        {
          results: []
        }
      ])
    );

    expect(result.total).toBe(1);
    expect(result.items[0]?.title).toBe(
      "Pulse width research on half-sine excitation signal for bending vibrator"
    );
    expect(result.items[0]?.authors).toContain("Kai Zhang");
    expect(result.notes).toContain(
      "JGE author-focused rescue used OpenAlex author matching inside the journal."
    );
  });

  it("matches AAPG Datapages-style Crossref records", async () => {
    const provider = new AapgProvider();
    const result = await provider.search(
      {
        source: "aapg",
        query: "logging",
        mode: "keyword",
        maxResults: 5
      },
      createProviderContext([
        {
          message: {
            items: [
              {
                DOI: "10.1306/3d93310a-16b1-11d7-8645000102c1865d",
                title: ["Electrical Well Logging"],
                publisher: "American Association of Petroleum Geologists AAPG/Datapages",
                "container-title": ["AAPG Bulletin"],
                URL: "https://doi.org/10.1306/3d93310a-16b1-11d7-8645000102c1865d",
                resource: {
                  primary: {
                    URL: "http://search.datapages.com/data/doi/10.1306/3D93310A-16B1-11D7-8645000102C1865D"
                  }
                }
              },
              {
                DOI: "10.1306/0bda5a08-16bd-11d7-8645000102c1865d",
                title: ["The Geologist and Logging: ABSTRACT"],
                publisher: "Unmaintained records",
                "container-title": ["AAPG Bulletin"],
                URL: "https://doi.org/10.1306/0bda5a08-16bd-11d7-8645000102c1865d",
                resource: {
                  primary: {
                    URL: "http://www.crossref.org/deleted_DOI.html"
                  }
                }
              }
            ]
          }
        },
        { results: [] }
      ])
    );

    expect(result.total).toBe(1);
    expect(result.items[0]?.source).toBe("aapg");
    expect(result.items[0]?.journal).toBe("AAPG Bulletin");
  });

  it("surfaces an availability error when both metadata sources fail", async () => {
    const provider = new EageProvider();

    await expect(
      provider.search(
        {
          source: "eage",
          query: "logging",
          mode: "keyword",
          maxResults: 5
        },
        createProviderContext([new Error("crossref down"), new Error("openalex down")])
      )
    ).rejects.toThrow("temporarily unavailable");
  });
});

function createProviderContext(responses: unknown[]) {
  let callIndex = 0;

  return {
    config: {
      searchCacheTtlMs: 60_000,
      openAlexMailto: undefined,
      unpaywallEmail: undefined
    },
    http: {
      async getJson() {
        const response = responses[callIndex++];
        if (response instanceof Error) {
          throw response;
        }
        return response;
      },
      async request() {
        throw new Error("unexpected request");
      }
    },
    cache: {
      async get() {
        return null;
      },
      async set() {
        return undefined;
      }
    },
    browser: {}
  } as any;
}
