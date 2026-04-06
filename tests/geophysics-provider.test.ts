import { describe, expect, it } from "vitest";
import {
  GeophysicsProvider,
  buildOpenAlexSearchUrl,
  buildCrossrefSearchUrl,
  mapCrossrefItem,
  mapOpenAlexItem
} from "../src/providers/geophysics-provider.js";

describe("GeophysicsProvider helpers", () => {
  it("builds a Crossref journal query", () => {
    const url = buildCrossrefSearchUrl(
      {
        source: "geophysics",
        query: "full waveform inversion",
        mode: "keyword",
        maxResults: 5,
        filters: {
          yearFrom: 2020,
          yearTo: 2024,
          sortBy: "published"
        }
      },
      "0016-8033"
    );

    expect(url).toContain("journals/0016-8033/works");
    expect(url).toContain("query.bibliographic=full+waveform+inversion");
    expect(url).toContain("from-pub-date%3A2020-01-01");
    expect(url).toContain("until-pub-date%3A2024-12-31");
    expect(url).toContain("sort=published");
    expect(url).toContain("references-count");
  });

  it("maps a Crossref item into a normalized article record", () => {
    const record = mapCrossrefItem({
      DOI: "10.1190/geo-2025-0392",
      title: ["Investigation of a graphite deposit with drone-based semi-airborne electromagnetics"],
      author: [
        { given: "Ada", family: "Lovelace" },
        { name: "Grace Hopper" }
      ],
      "container-title": ["GEOPHYSICS"],
      URL: "https://doi.org/10.1190/geo-2025-0392",
      link: [
        {
          URL: "https://pubs.geoscienceworld.org/seg/geophysics/article-pdf/91/3/B53/7731539/geo-2025-0392.pdf",
          "content-type": "application/pdf"
        }
      ],
      volume: "91",
      issue: "3",
      page: "B53-B68",
      abstract: "<jats:p>Field test abstract.</jats:p>",
      "published-print": {
        "date-parts": [[2025, 5, 1]]
      }
    });

    expect(record.id).toBe("10.1190/geo-2025-0392");
    expect(record.journal).toBe("GEOPHYSICS");
    expect(record.authors).toEqual(["Ada Lovelace", "Grace Hopper"]);
    expect(record.year).toBe(2025);
    expect(record.pdfUrl).toContain("geo-2025-0392.pdf");
    expect(record.abstract).toBe("Field test abstract.");
  });

  it("builds an OpenAlex search url for the journal ISSN", () => {
    const url = buildOpenAlexSearchUrl(
      {
        source: "geophysics",
        query: "full waveform inversion",
        mode: "keyword",
        maxResults: 5,
        filters: {
          yearFrom: 2020,
          yearTo: 2024
        }
      },
      "0016-8033",
      15,
      "me@example.com"
    );

    expect(url).toContain("api.openalex.org/works?");
    expect(url).toContain("primary_location.source.issn%3A0016-8033");
    expect(url).toContain("from_publication_date%3A2020-01-01");
    expect(url).toContain("to_publication_date%3A2024-12-31");
    expect(url).toContain("search=full+waveform+inversion");
    expect(url).toContain("per-page=15");
    expect(url).toContain("mailto=me%40example.com");
  });

  it("maps an OpenAlex record with oa metadata", () => {
    const record = mapOpenAlexItem({
      id: "https://openalex.org/W1",
      doi: "https://doi.org/10.1190/geo-2020-0001",
      display_name: "Open article",
      publication_year: 2020,
      authorships: [
        { author: { display_name: "Alice" } },
        { author: { display_name: "Bob" } }
      ],
      primary_location: {
        landing_page_url: "https://repository.example.org/item/1",
        pdf_url: "https://repository.example.org/item/1.pdf",
        source: {
          display_name: "GEOPHYSICS"
        }
      },
      open_access: {
        is_oa: true,
        oa_status: "green",
        oa_url: "https://repository.example.org/item/1.pdf"
      },
      biblio: {
        volume: "85",
        issue: "4",
        first_page: "A1",
        last_page: "A9"
      }
    });

    expect(record.access).toBe("open");
    expect(record.oaUrl).toContain("item/1.pdf");
    expect(record.pdfUrl).toContain("item/1.pdf");
    expect(record.pages).toBe("A1-A9");
    expect(record.authors).toEqual(["Alice", "Bob"]);
  });

  it("returns an empty search result when the metadata sources respond successfully but find no matches", async () => {
    const provider = new GeophysicsProvider();
    const result = await provider.search(
      {
        source: "geophysics",
        query: "logging",
        mode: "keyword",
        maxResults: 5
      },
      createProviderContext([
        { message: { items: [] } },
        { results: [] }
      ])
    );

    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("surfaces an availability error only when both metadata sources fail", async () => {
    const provider = new GeophysicsProvider();

    await expect(
      provider.search(
        {
          source: "geophysics",
          query: "logging",
          mode: "keyword",
          maxResults: 5
        },
        createProviderContext([
          new Error("crossref down"),
          new Error("openalex down")
        ])
      )
    ).rejects.toThrow("temporarily unavailable");
  });
});

function createProviderContext(responses: unknown[]) {
  let callIndex = 0;

  return {
    config: {
      searchCacheTtlMs: 60_000,
      geophysicsIssn: "0016-8033",
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
    browser: {
      hasState() {
        return false;
      }
    }
  } as any;
}
