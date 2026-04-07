import { describe, expect, it } from "vitest";
import {
  buildCnkiBriefGridForm,
  buildCnkiSearchCacheKey,
  buildCnkiSearchUrl,
  getCnkiSearchLanguages,
  parseCnkiDetailHtml,
  parseCnkiSearchHtml
} from "../src/providers/cnki-provider.js";

describe("CnkiProvider helpers", () => {
  it("builds a starter search url", () => {
    const url = buildCnkiSearchUrl({
      source: "cnki",
      query: "geophysics",
      mode: "title",
      maxResults: 10,
      filters: {
        resourceCode: "CJFQ"
      }
    });

    expect(url).toContain("https://kns.cnki.net/starter?");
    expect(url).toContain("rc=CJFQ");
    expect(url).toContain("fd=TI");
  });

  it("falls back to CJFQ when CNKI resourceCode is blank", () => {
    const url = buildCnkiSearchUrl({
      source: "cnki",
      query: "Kai Zhang",
      mode: "author",
      maxResults: 10,
      filters: {
        resourceCode: ""
      }
    });

    expect(url).toContain("rc=CJFQ");
  });

  it("builds a cache key that varies with the auth state version", () => {
    const request = {
      source: "cnki" as const,
      query: "geophysics",
      mode: "title" as const,
      maxResults: 10,
      filters: {
        resourceCode: "CJFQ"
      }
    };

    const a = buildCnkiSearchCacheKey(request, "state-a", "auto");
    const b = buildCnkiSearchCacheKey(request, "state-b", "auto");

    expect(a).not.toBe(b);
    expect(a).toContain("cnki-search-v5");
  });

  it("builds a brief grid form for protocol search", () => {
    const form = buildCnkiBriefGridForm("YSTT4HG0", {
      source: "cnki",
      query: "地震",
      mode: "keyword",
      maxResults: 5,
      filters: {}
    });

    expect(form.pageSize).toBe("5");
    expect(form.aside).toContain("地震");
    expect(form.QueryJson).toContain("\"Classid\":\"YSTT4HG0\"");
    expect(form.QueryJson).toContain("\"Field\":\"SU\"");
  });

  it("uses mixed-language protocol candidates for English CNKI queries", () => {
    expect(
      getCnkiSearchLanguages({
        source: "cnki",
        query: "well logging",
        mode: "keyword",
        maxResults: 5,
        filters: {}
      })
    ).toEqual(["", "Both"]);
  });

  it("keeps Chinese-only protocol mode for Chinese CNKI queries", () => {
    expect(
      getCnkiSearchLanguages({
        source: "cnki",
        query: "\u6d4b\u4e95",
        mode: "keyword",
        maxResults: 5,
        filters: {}
      })
    ).toEqual(["CHINESE"]);
  });

  it("parses a classic CNKI search result table", () => {
    const html = `
      <table class="GridTableContent">
        <tr><th>header</th></tr>
        <tr>
          <td>
            <a class="fz14" href="/KCMS/detail/detail.aspx?dbcode=CJFD&filename=DGWL202401001">A seismic paper</a>
            <a class="briefDl_D" href="/download/download.aspx?filename=DGWL202401001.pdf">PDF</a>
            作者: Alice;Bob 来源: Journal of Geophysics 2024
          </td>
        </tr>
      </table>
    `;

    const items = parseCnkiSearchHtml(html, "https://kns.cnki.net/starter");
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("A seismic paper");
    expect(items[0].detailUrl).toContain("DGWL202401001");
    expect(items[0].downloadUrl).toContain("DGWL202401001.pdf");
    expect(items[0].authors).toEqual(["Alice", "Bob"]);
    expect(items[0].year).toBe(2024);
  });

  it("parses a structured kns8 brief grid row", () => {
    const html = `
      <table>
        <tr><th>header</th></tr>
        <tr>
          <td class="seq">1</td>
          <td class="name">
            <a class="fz14" href="https://kns.cnki.net/kcms2/article/abstract?v=abc">Structured Paper</a>
          </td>
          <td class="author"><a>Alice1</a><a>Bob2</a></td>
          <td class="source"><span><a>Journal of Seismology</a></span></td>
          <td class="date">2026-04-04 10:00</td>
          <td class="operat">
            <a class="downloadlink" href="https://bar.cnki.net/bar/download/order?id=pdf1"></a>
            <a class="icon-read" href="https://bar.cnki.net/bar/download/order?id=read1">原版阅读</a>
          </td>
        </tr>
      </table>
    `;

    const items = parseCnkiSearchHtml(html, "https://kns.cnki.net/kns8s/defaultresult/index");
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Structured Paper");
    expect(items[0].authors).toEqual(["Alice", "Bob"]);
    expect(items[0].journal).toBe("Journal of Seismology");
    expect(items[0].year).toBe(2026);
    expect(items[0].downloadUrl).toContain("bar/download/order");
    expect(items[0].raw?.downloadCandidates).toMatchObject([
      expect.objectContaining({
        label: "PDF download"
      })
    ]);
  });

  it("parses a CNKI detail page", () => {
    const html = `
      <html>
        <body>
          <h1 id="Title">A CNKI Detail Paper</h1>
          <div id="authorpart"><a>Alice</a><a>Bob</a></div>
          <div class="sourinfo"><p>Journal of Applied Geophysics 2025</p></div>
          <span id="ChDivSummary">This is the abstract.</span>
          <div class="keywords"><a>keyword1</a><a>keyword2</a></div>
          <a class="btn-download" href="/download/download.aspx?filename=paper.caj">CAJ</a>
          DOI: 10.1234/ABCD.2025.001
        </body>
      </html>
    `;

    const record = parseCnkiDetailHtml(
      html,
      "https://kns.cnki.net/KCMS/detail/detail.aspx?dbcode=CJFD&filename=test"
    );
    expect(record?.title).toBe("A CNKI Detail Paper");
    expect(record?.authors).toEqual(["Alice", "Bob"]);
    expect(record?.abstract).toBe("This is the abstract.");
    expect(record?.doi).toBe("10.1234/abcd.2025.001");
    expect(record?.downloadUrl).toContain("paper.caj");
  });

  it("ignores non-download author workbench links on detail pages", () => {
    const html = `
      <html>
        <body>
          <h1 id="Title">Another CNKI Detail Paper</h1>
          <div class="sourinfo"><p>Journal of Applied Geophysics . 2025</p></div>
          <a class="btn-download" href="https://au.cnki.net/author/workbench/myAchievement?platform=kns">Author workspace</a>
          <a class="btn-download" href="/download/download.aspx?filename=paper.pdf">PDF</a>
        </body>
      </html>
    `;

    const record = parseCnkiDetailHtml(
      html,
      "https://kns.cnki.net/KCMS/detail/detail.aspx?dbcode=CJFD&filename=test2"
    );

    expect(record?.journal).toBe("Journal of Applied Geophysics");
    expect(record?.downloadUrl).toContain("paper.pdf");
    expect(record?.raw?.downloadCandidates).toMatchObject([
      expect.objectContaining({
        url: "https://kns.cnki.net/download/download.aspx?filename=paper.pdf"
      })
    ]);
  });
});
