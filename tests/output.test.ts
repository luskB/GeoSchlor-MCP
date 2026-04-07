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

  it("compacts aggregated search output without changing result counts or core identity fields", () => {
    const sanitized = sanitizeForToolOutput({
      query: "logging",
      mode: "keyword",
      queryVariants: ["logging", "well logging", "logging"],
      total: 2,
      sources: [
        {
          source: "geophysics",
          total: 2,
          notes: [
            "GEOPHYSICS search uses Crossref and OpenAlex.",
            "Second note.",
            "Third note should be trimmed."
          ],
          items: [
            {
              id: "10.1190/geo2024-0457.1",
              source: "geophysics",
              title: "Transient <b>electromagnetic</b> forward-modeling",
              authors: ["Wenjun Xiong", "Lizhi Xiao"],
              journal: "Geophysics",
              year: 2025,
              doi: "10.1190/geo2024-0457.1",
              abstract:
                "ABSTRACT <p>This is a very long abstract.</p> ".repeat(30),
              keywords: [
                "Well logging",
                "Well logging",
                "Geophysics",
                "Resistivity",
                "Modeling",
                "Inversion",
                "Simulation"
              ],
              institutions: [
                "China University of Petroleum, Beijing. 27287517@qq.com",
                "China University of Petroleum, Beijing. xiao@cup.edu.cn (corresponding author)",
                "Yangtze University"
              ],
              citationCount: 1,
              referenceCount: 68,
              access: "subscription",
              detailUrl: "https://example.com/detail",
              raw: {
                huge: true
              }
            },
            {
              id: "10.1190/geo2024-0022.1",
              source: "geophysics",
              title: "A novel neural network prediction model",
              authors: ["Yuhua Zhao"],
              year: 2025,
              doi: "10.1190/geo2024-0022.1",
              access: "subscription"
            }
          ]
        }
      ]
    });

    expect(sanitized).toEqual({
      query: "logging",
      mode: "keyword",
      queryVariants: ["logging", "well logging"],
      total: 2,
      sources: [
        {
          source: "geophysics",
          total: 2,
          notes: [
            "GEOPHYSICS search uses Crossref and OpenAlex.",
            "Second note."
          ],
          items: [
            {
              id: "10.1190/geo2024-0457.1",
              source: "geophysics",
              title: "Transient electromagnetic forward-modeling",
              authors: ["Wenjun Xiong", "Lizhi Xiao"],
              journal: "Geophysics",
              year: 2025,
              doi: "10.1190/geo2024-0457.1",
              abstract: expect.stringMatching(/^This is a very long abstract\./),
              keywords: [
                "Well logging",
                "Geophysics",
                "Resistivity",
                "Modeling",
                "Inversion",
                "Simulation"
              ],
              institutions: [
                "China University of Petroleum, Beijing.",
                "Yangtze University"
              ],
              citationCount: 1,
              referenceCount: 68,
              access: "subscription",
              detailUrl: "https://example.com/detail"
            },
            {
              id: "10.1190/geo2024-0022.1",
              source: "geophysics",
              title: "A novel neural network prediction model",
              authors: ["Yuhua Zhao"],
              year: 2025,
              doi: "10.1190/geo2024-0022.1",
              access: "subscription"
            }
          ]
        }
      ]
    });
  });
});
