import { describe, expect, it } from "vitest";
import { sanitizeForToolOutput } from "../src/utils/output.js";

describe("sanitizeForToolOutput", () => {
  it("removes nested raw payloads while preserving academic fields", () => {
    const sanitized = sanitizeForToolOutput({
      query: "测井",
      sources: [
        {
          items: [
            {
              title: "The synthesis of seismograms from well log data",
              doi: "10.1190/1.1438155",
              citationCount: 101,
              raw: {
                openalex: {
                  abstract_inverted_index: {
                    large: [1, 2, 3]
                  }
                }
              }
            }
          ]
        }
      ],
      raw: {
        shouldDisappear: true
      }
    });

    expect(sanitized).toEqual({
      query: "测井",
      sources: [
        {
          items: [
            {
              title: "The synthesis of seismograms from well log data",
              doi: "10.1190/1.1438155",
              citationCount: 101
            }
          ]
        }
      ]
    });
  });
});
