import { describe, expect, it } from "vitest";
import {
  buildVipSignedHeaders,
  mapVipRowToRecord,
  parseVipBootstrapHtml
} from "../src/providers/vip-provider.js";

describe("VipProvider helpers", () => {
  it("parses bootstrap fields from the SSR home page shell", () => {
    const bootstrap = parseVipBootstrapHtml(`
      <script>
        window.__NUXT__={state:{uuid:"9MEfqSC3",env:"zs",authEnv:"pro"}};
      </script>
    `);

    expect(bootstrap).toEqual({
      uuid: "9MEfqSC3",
      env: "zs",
      authEnv: "pro"
    });
  });

  it("builds the signed CQVIP search headers expected by the site runtime", () => {
    const headers = buildVipSignedHeaders(
      {
        uuid: "VbNDasMD",
        env: "zs",
        authEnv: "pro"
      },
      1775396095715,
      {
        config: {
          browserUserAgent: undefined
        }
      } as never
    );

    expect(headers.appid).toBe("f0de4ab08fbe4ca2afd1708d160d33a4");
    expect(headers.timestamp).toBe("1775396095");
    expect(headers.signature).toBe("9z4jQpYe2wyTjGjno9AjDcqQq58=");
    expect(headers["cqvip-sign"]).toBe(
      "654c2b62140149f6b265a7a82283d8d6481fe6dbdb1854a148e49e24191a9623"
    );
  });

  it("maps a CQVIP row into an academic article record", () => {
    const record = mapVipRowToRecord({
      id: "7202502985",
      doi: "10.20015/j.cnki.ISSN1000-0666.2026.0030",
      title: "2024年中国台湾花莲地震高烈度台站加速度记录反应谱特征",
      abstr: "反应谱特征研究可为地震设计反应谱修订提供参考。",
      paperLanguage: "zh",
      pubDate: "2026-06-01",
      year: 2026,
      isPdf: 1,
      byRefCnt: 0,
      byUnityRefCnt: 7,
      refCnt: 26,
      beginPage: "82",
      endPage: "90",
      cqvipIsOa: true,
      keywordInfo: [{ name: "花莲地震" }, { name: "反应谱" }],
      authorInfo: [{ name: "张潇男" }, { name: "王海云" }],
      organInfo: [{ name: "中国地震局工程力学研究所" }],
      journalInfo: {
        name: "地震研究",
        vol: "49",
        num: "2",
        issn: "1000-0666",
        publisher: "云南省地震局",
        rangeInfo: [{ abbrNameVersion: "北大核心（2023）" }]
      },
      classInfo: {
        clc: {
          list: [{ name: "地震工程" }]
        }
      },
      type: 1
    });

    expect(record.source).toBe("vip");
    expect(record.title).toContain("花莲地震");
    expect(record.authors).toEqual(["张潇男", "王海云"]);
    expect(record.journal).toBe("地震研究");
    expect(record.keywords).toEqual(["花莲地震", "反应谱"]);
    expect(record.institutions).toEqual(["中国地震局工程力学研究所"]);
    expect(record.publisher).toBe("云南省地震局");
    expect(record.citationCount).toBe(7);
    expect(record.referenceCount).toBe(26);
    expect(record.pages).toBe("82-90");
    expect(record.access).toBe("session_required");
    expect(record.detailUrl).toContain("resourceId=7202502985");
  });
});
