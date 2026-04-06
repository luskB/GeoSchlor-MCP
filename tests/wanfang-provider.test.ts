import { describe, expect, it } from "vitest";
import {
  buildWanfangSearchUrl,
  parseWanfangDetailHtml,
  parseWanfangSearchHtml
} from "../src/providers/wanfang-provider.js";

describe("WanfangProvider helpers", () => {
  it("builds the public all-resources search URL", () => {
    expect(buildWanfangSearchUrl("logging")).toBe(
      "https://s.wanfangdata.com.cn/paper?q=logging&p=1"
    );
  });

  it("parses a rendered Wanfang search result block", () => {
    const html = `
      <div class="normal-list periodical-list">
        <div class="title-area">
          <div class="ajust">
            <span class="title">基于快速傅里叶卷积的电成像测井图像修复</span>
            <div class="stat">
              <div class="stat-content">
                <div class="stat-item quote">被引 3</div>
              </div>
            </div>
            <span class="title-id-hidden">periodical_bjhkhtdxxb202601035</span>
          </div>
        </div>
        <div class="author-area">
          <span class="essay-type">期刊论文</span>
          <span class="authors">苏乾潇</span>
          <span class="authors">乔德新</span>
          <span class="periodical-title">《北京航空航天大学学报》</span>
          <span class="authors">2026年1期</span>
        </div>
        <div class="abstract-area">摘要：电成像测井图像修复方法研究。</div>
        <div class="keywords-area">
          <span class="keywords-list">电成像测井</span>
          <span class="keywords-list">图像修复</span>
        </div>
      </div>
    `;

    const records = parseWanfangSearchHtml(html);
    expect(records).toHaveLength(1);
    expect(records[0].title).toContain("电成像测井");
    expect(records[0].authors).toEqual(["苏乾潇", "乔德新"]);
    expect(records[0].journal).toBe("北京航空航天大学学报");
    expect(records[0].year).toBe(2026);
    expect(records[0].issue).toBe("1");
    expect(records[0].citationCount).toBe(3);
    expect(records[0].detailUrl).toContain("bjhkhtdxxb202601035");
  });

  it("parses a Wanfang detail page with abstract, doi, institutions, and download link", () => {
    const html = `
      <html>
        <head>
          <meta name="description" content="成像测井是复杂储层测井评价中的重要技术。">
          <meta name="keywords" content="电成像测井,图像修复,北京航空航天大学学报">
        </head>
        <body>
          <div class="breadcrumb">
            <a href="https://c.wanfangdata.com.cn/magazine/bjhkhtdxxb">北京航空航天大学学报</a>
            <span>2026年1期</span>
          </div>
          <div class="detailIntro" referencenum="12" citenum="4"></div>
          <div class="doiStyle">DOI: <a>10.13700/j.bh.1001-5965.2023.0754</a></div>
          <div class="detailTitleCN"><span>基于快速傅里叶卷积的电成像测井图像修复</span></div>
          <a class="test-detail-author">苏乾潇</a>
          <a class="test-detail-author">乔德新</a>
          <a class="test-detail-org">中国石油勘探开发研究院</a>
          <a class="download buttonItem" href="https://oss.wanfangdata.com.cn/file/download/perio_bjhkhtdxxb202601035.aspx"></a>
          <a class="test-relate-keyword">电成像测井</a>
          <a class="test-relate-keyword">图像修复</a>
        </body>
      </html>
    `;

    const record = parseWanfangDetailHtml(
      html,
      "https://d.wanfangdata.com.cn/periodical/bjhkhtdxxb202601035"
    );

    expect(record?.title).toContain("电成像测井");
    expect(record?.doi).toBe("10.13700/j.bh.1001-5965.2023.0754");
    expect(record?.journal).toBe("北京航空航天大学学报");
    expect(record?.institutions).toEqual(["中国石油勘探开发研究院"]);
    expect(record?.citationCount).toBe(4);
    expect(record?.referenceCount).toBe(12);
    expect(record?.downloadUrl).toContain("oss.wanfangdata.com.cn");
    expect(record?.access).toBe("session_required");
  });
});
