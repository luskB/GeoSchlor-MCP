import { describe, expect, it } from "vitest";
import { buildCrossrefSearchUrl } from "../src/providers/open-metadata.js";

describe("buildCrossrefSearchUrl", () => {
  it("supports author-affiliation rescue parameters", () => {
    const url = buildCrossrefSearchUrl(
      {
        source: "all",
        query: "Kai Zhang",
        mode: "author",
        maxResults: 10,
        filters: {
          yearFrom: 2020,
          yearTo: 2026
        }
      },
      {
        rows: 10,
        authorQueries: ["Kai Zhang", "Baohai Tan"],
        affiliationQuery: "China University of Petroleum",
        bibliographicQuery: "well logging"
      }
    );

    const parsed = new URL(url);
    const authorQueries = parsed.searchParams.getAll("query.author");

    expect(parsed.pathname).toBe("/works");
    expect(authorQueries).toEqual(["Kai Zhang", "Baohai Tan"]);
    expect(parsed.searchParams.get("query.affiliation")).toBe(
      "China University of Petroleum"
    );
    expect(parsed.searchParams.get("query.bibliographic")).toBe("well logging");
    expect(parsed.searchParams.get("filter")).toContain("from-pub-date:2020-01-01");
    expect(parsed.searchParams.get("filter")).toContain("until-pub-date:2026-12-31");
  });
});
