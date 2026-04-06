import { describe, expect, it } from "vitest";
import {
  buildCrossrefSearchUrl,
  mapCrossrefItem
} from "../src/providers/petrophysics-provider.js";

describe("PetrophysicsProvider helpers", () => {
  it("builds a journal-scoped Crossref query", () => {
    const url = buildCrossrefSearchUrl(
      {
        source: "petrophysics",
        query: "nmr logging",
        mode: "keyword",
        maxResults: 5
      },
      "1529-9074"
    );

    expect(url).toContain("journals/1529-9074/works");
    expect(url).toContain("query.bibliographic=nmr+logging");
  });

  it("maps Crossref metadata into a richer academic record", () => {
    const record = mapCrossrefItem({
      DOI: "10.30632/pjv63n1-2022a5",
      title: ["Evaluating Petrophysical Properties and Volumetrics Uncertainties"],
      author: [
        {
          given: "Artur",
          family: "Kotwicki",
          affiliation: [{ name: "Aker BP ASA" }]
        }
      ],
      "container-title": ["Petrophysics - The SPWLA Journal of Formation Evaluation and Reservoir Description"],
      publisher: "Society of Petrophysicists and Well Log Analysts (SPWLA)",
      page: "82-103",
      volume: "63",
      issue: "1",
      abstract: "<jats:p>Petrophysical abstract.</jats:p>",
      ISSN: ["1529-9074", "2641-4112"],
      "is-referenced-by-count": 1,
      "reference-count": 12,
      "published-online": {
        "date-parts": [[2022, 2, 1]]
      }
    });

    expect(record.source).toBe("petrophysics");
    expect(record.publisher).toContain("SPWLA");
    expect(record.abstract).toBe("Petrophysical abstract.");
    expect(record.institutions).toEqual(["Aker BP ASA"]);
    expect(record.citationCount).toBe(1);
    expect(record.referenceCount).toBe(12);
    expect(record.issn).toContain("1529-9074");
  });
});
