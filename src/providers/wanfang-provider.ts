import { load } from "cheerio";
import { SearchProvider, ProviderContext } from "./base.js";
import {
  ArticleRecord,
  DownloadCandidate,
  ProviderSearchResult,
  SearchMode,
  SearchRequest
} from "../types.js";
import {
  extractYear,
  normalizeDoi,
  normalizeWhitespace,
  uniqueList
} from "../utils/text.js";
import { buildBrowserCompatibleHeaders } from "../utils/http-headers.js";
import {
  buildWanfangDetailRequestFrame,
  buildWanfangReferenceListRequestFrame,
  buildWanfangSearchRequestFrame,
  parseWanfangDetailResponse,
  parseWanfangReferenceCountResponse,
  parseWanfangSearchResponse
} from "./wanfang-protocol.js";

export class WanfangProvider implements SearchProvider {
  readonly id = "wanfang" as const;

  async search(
    request: SearchRequest,
    context: ProviderContext
  ): Promise<ProviderSearchResult> {
    const cacheKey = JSON.stringify({ version: 4, request });
    const cached = await context.cache.get<ProviderSearchResult>("search/wanfang", cacheKey);
    if (cached) {
      return cached;
    }

    const protocol = await searchWanfangProtocol(request, context);
    const mapped = applyWanfangModeFilter(protocol.items, request.mode, request.query).slice(
      0,
      request.maxResults
    );
    const notes = [
      "Wanfang search now follows the official all-resources ranking that the public site uses by default.",
      "Search does not require a visible browser window or a saved Wanfang session.",
      "Full-text download still depends on your own Wanfang access."
    ];
    const result: ProviderSearchResult = {
      source: this.id,
      total: mapped.length,
      items: mapped,
      notes
    };

    await context.cache.set(
      "search/wanfang",
      cacheKey,
      result,
      context.config.searchCacheTtlMs
    );
    return result;
  }

  async getRecord(locator: string, context: ProviderContext): Promise<ArticleRecord | null> {
    const resolved = normalizeWanfangLocator(locator);
    if (!resolved) {
      return null;
    }

    try {
      return await fetchWanfangRecordWithProtocol(resolved, context);
    } catch {
      if (!resolved.detailUrl) {
        return null;
      }
      const html = await fetchWanfangDetailHtml(resolved.detailUrl, context);
      return parseWanfangDetailHtml(html, resolved.detailUrl);
    }
  }

  async resolveDownload(
    record: ArticleRecord,
    context: ProviderContext
  ): Promise<DownloadCandidate[]> {
    const workingRecord =
      record.downloadUrl || !record.detailUrl
        ? record
        : (await this.getRecord(record.detailUrl, context)) ?? record;
    const downloadUrl = normalizeWhitespace(workingRecord.downloadUrl);
    if (!downloadUrl) {
      return [];
    }

    return [
      {
        id: `${workingRecord.id}:wanfang-download-http`,
        source: this.id,
        label: "Wanfang download",
        url: downloadUrl,
        method: "http",
        format: "pdf",
        requiresAuth: true,
        referer: workingRecord.detailUrl
      },
      {
        id: `${workingRecord.id}:wanfang-download-browser`,
        source: this.id,
        label: "Wanfang download (browser fallback)",
        url: downloadUrl,
        method: "browser",
        format: "pdf",
        requiresAuth: true,
        referer: workingRecord.detailUrl
      }
    ];
  }
}

export function parseWanfangSearchHtml(html: string): ArticleRecord[] {
  const $ = load(html);
  const rows = $(".normal-list.periodical-list").toArray();
  const items: ArticleRecord[] = [];

  for (const row of rows) {
    const element = $(row);
    const title = normalizeWhitespace(element.find(".title-area .title").first().text());
    const hiddenId = normalizeWhitespace(element.find(".title-id-hidden").first().text());
    const detailUrl = buildWanfangDetailUrl(hiddenId);
    if (!title || !detailUrl) {
      continue;
    }

    const authorValues = element
      .find(".author-area .authors")
      .toArray()
      .map((node) => normalizeWhitespace($(node).text()))
      .filter((value) => value && !/\d{4}年\d+期/.test(value));
    const authorText = normalizeWhitespace(element.find(".author-area").text());
    const abstractText = normalizeWhitespace(
      element.find(".abstract-area").text().replace(/^摘要[:：]?\s*/, "")
    );
    const citationCount = extractNumber(
      normalizeWhitespace(element.find(".title-area .stat-item.quote").text()) ||
        authorText
    );

    items.push({
      id: hiddenId,
      source: "wanfang",
      title,
      authors: uniqueList(authorValues),
      journal: trimBookTitle(normalizeWhitespace(element.find(".periodical-title").text())),
      year: extractYear(authorText),
      issue: extractIssue(authorText),
      abstract: abstractText || undefined,
      keywords: uniqueList(
        element
          .find(".keywords-area .keywords-list")
          .toArray()
          .map((node) => normalizeWhitespace($(node).text()))
      ),
      citationCount,
      sourceType: normalizeWhitespace(element.find(".essay-type").text()) || "journal-article",
      detailUrl,
      access: "unknown",
      snippets: abstractText ? [abstractText] : undefined,
      raw: {
        hiddenId,
        journalRanks: uniqueList(
          element
            .find(".core-periodical-item")
            .toArray()
            .map((node) => normalizeWhitespace($(node).text()))
        )
      }
    });
  }

  return items;
}

export function parseWanfangDetailHtml(
  html: string,
  detailUrl: string
): ArticleRecord | null {
  const $ = load(html);
  const title = normalizeWhitespace($(".detailTitleCN span").first().text());
  if (!title) {
    return null;
  }

  const detailIntro = $(".detailIntro").first();
  const metaDescription = normalizeWhitespace($('meta[name="description"]').attr("content"));
  const metaKeywords = normalizeWhitespace($('meta[name="keywords"]').attr("content"));
  const relatedKeywords = uniqueList(
    $(".test-relate-keyword")
      .toArray()
      .map((node) => normalizeWhitespace($(node).text()))
      .filter((keyword) => keyword && keyword !== "...")
  );
  const citationCount =
    parseInteger(detailIntro.attr("citenum")) ??
    extractNumber(normalizeWhitespace($.root().text().match(/被引\s*\d+/)?.[0]));
  const referenceCount = parseInteger(detailIntro.attr("referencenum"));
  const breadcrumbText = normalizeWhitespace($(".breadcrumb").text());
  const journal = trimBookTitle(
    normalizeWhitespace($(".breadcrumb a[href*='/magazine/']").last().text())
  );
  const downloadUrl = normalizeWhitespace($("a.download.buttonItem").attr("href"));

  return {
    id: detailUrl,
    source: "wanfang",
    title,
    authors: uniqueList(
      $(".test-detail-author")
        .toArray()
        .map((node) => normalizeWhitespace($(node).text()))
    ),
    journal: journal || undefined,
    year: extractYear(breadcrumbText),
    issue: extractIssue(breadcrumbText),
    doi: normalizeDoi($(".doiStyle a").first().text()),
    abstract: metaDescription || undefined,
    keywords: relatedKeywords.length
      ? relatedKeywords
      : uniqueList(
          metaKeywords
            .split(/[，,]/)
            .map((keyword) => normalizeWhitespace(keyword))
            .filter(Boolean)
        ),
    institutions: uniqueList(
      $(".test-detail-org")
        .toArray()
        .map((node) => normalizeWhitespace($(node).text()))
    ),
    citationCount,
    referenceCount,
    sourceType: "journal-article",
    detailUrl,
    downloadUrl: downloadUrl || undefined,
    access: downloadUrl ? "session_required" : "unknown",
    raw: {
      breadcrumbText,
      metaKeywords,
      metaDescription
    }
  };
}

async function fetchWanfangSearchHtml(
  query: string,
  context: ProviderContext
): Promise<string> {
  return context.http.getText(buildWanfangSearchUrl(query), {
    headers: buildBrowserCompatibleHeaders(context.config, {
      referer: "https://www.wanfangdata.com.cn/"
    })
  });
}

async function fetchWanfangSearchHtmlWithBrowser(
  query: string,
  context: ProviderContext
): Promise<string> {
  return context.browser.withPage(
    "wanfang",
    async (page) => {
      await page.goto("https://www.wanfangdata.com.cn/", {
        waitUntil: "domcontentloaded"
      });
      await page.waitForTimeout(4000);
      await page.locator("#search-input").fill(query);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(8000);
      return page.content();
    },
    { headless: false }
  );
}

async function fetchWanfangDetailHtml(
  detailUrl: string,
  context: ProviderContext
): Promise<string> {
  return context.http.getText(detailUrl, {
    headers: buildBrowserCompatibleHeaders(context.config, {
      referer: "https://s.wanfangdata.com.cn/"
    })
  });
}

export function buildWanfangSearchUrl(query: string): string {
  return `https://s.wanfangdata.com.cn/paper?q=${encodeURIComponent(query)}&p=1`;
}

function buildWanfangDetailUrl(hiddenId: string): string | undefined {
  const normalized = normalizeWhitespace(hiddenId);
  if (!normalized) {
    return undefined;
  }

  if (/^D\d+$/i.test(normalized)) {
    return `https://d.wanfangdata.com.cn/thesis/${normalized}`;
  }
  if (/^[a-f0-9]{32}$/i.test(normalized)) {
    return `https://d.wanfangdata.com.cn/conference/${normalized}`;
  }

  const resourceId = normalized.replace(/^periodical_/, "");
  return `https://d.wanfangdata.com.cn/periodical/${resourceId}`;
}

function normalizeWanfangLocator(
  locator: string
): { resourceId: string; detailUrl: string } | undefined {
  const normalized = normalizeWhitespace(locator);
  if (!normalized) {
    return undefined;
  }

  if (/^https?:\/\//i.test(normalized)) {
    const match = normalized.match(/\/(periodical|thesis|conference)\/([^/?#]+)/i);
    if (!match?.[2]) {
      return undefined;
    }
    return {
      resourceId: match[2],
      detailUrl: normalized
    };
  }

  const detailUrl = buildWanfangDetailUrl(normalized);
  if (!detailUrl) {
    return undefined;
  }

  return {
    resourceId: normalized.replace(/^periodical_/, ""),
    detailUrl
  };
}

function applyWanfangModeFilter(
  items: ArticleRecord[],
  mode: SearchMode,
  query: string
): ArticleRecord[] {
  if (mode === "keyword") {
    return items;
  }

  const normalizedQuery = normalizeWhitespace(query).toLowerCase();
  const filtered = items.filter((item) => {
    switch (mode) {
      case "title":
        return normalizeWhitespace(item.title).toLowerCase().includes(normalizedQuery);
      case "author":
        return item.authors.some((author) =>
          normalizeWhitespace(author).toLowerCase().includes(normalizedQuery)
        );
      case "doi":
        return normalizeDoi(item.doi) === normalizeDoi(query);
      case "journal":
        return normalizeWhitespace(item.journal).toLowerCase().includes(normalizedQuery);
      default:
        return true;
    }
  });

  return filtered.length ? filtered : items;
}

function trimBookTitle(value: string): string {
  return normalizeWhitespace(value.replace(/[《》]/g, ""));
}

function extractIssue(value: string): string | undefined {
  const match = normalizeWhitespace(value).match(/(\d+)期/);
  return match?.[1];
}

function extractNumber(value: string | undefined): number | undefined {
  const match = normalizeWhitespace(value).match(/(\d+)/);
  return match ? Number(match[1]) : undefined;
}

function parseInteger(value: string | undefined): number | undefined {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return undefined;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function searchWanfangProtocol(
  request: SearchRequest,
  context: ProviderContext
): Promise<{ total: number; items: ArticleRecord[] }> {
  const pageSize = clampWanfangPageSize(request.maxResults);
  const maxPages = request.mode === "keyword" ? 2 : 3;
  const merged = new Map<string, ArticleRecord>();
  let total = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const referer = `https://s.wanfangdata.com.cn/paper?q=${encodeURIComponent(
      request.query
    )}&p=${page}`;
    const response = await context.http.request(
      "https://s.wanfangdata.com.cn/SearchService.SearchService/search",
      {
        method: "POST",
        headers: buildWanfangGrpcHeaders(context, referer),
        body: toRequestBody(
          buildWanfangSearchRequestFrame(request.query, page, pageSize, "paper")
        ) as unknown as RequestInit["body"]
      }
    );

    if (!response.ok) {
      throw new Error(
        `Wanfang grpc-web search failed with status ${response.status} for query ${request.query}.`
      );
    }

    const parsed = parseWanfangSearchResponse(response.buffer);
    total = parsed.total || total;

    for (const item of parsed.items) {
      merged.set(item.id, item);
    }

    const filtered = applyWanfangModeFilter([...merged.values()], request.mode, request.query);
    if (
      filtered.length >= request.maxResults ||
      !parsed.items.length ||
      (total > 0 && page * pageSize >= total)
    ) {
      break;
    }
  }

  return {
    total,
    items: [...merged.values()]
  };
}

async function fetchWanfangRecordWithProtocol(
  locator: { resourceId: string; detailUrl: string },
  context: ProviderContext
): Promise<ArticleRecord | null> {
  const resourceType = locator.detailUrl.includes("/thesis/")
    ? "Thesis"
    : locator.detailUrl.includes("/conference/")
      ? "Conference"
      : "Periodical";
  const response = await context.http.request(
    "https://d.wanfangdata.com.cn/Detail.DetailService/getDetailInFormation",
    {
      method: "POST",
      headers: buildWanfangGrpcHeaders(context, locator.detailUrl),
      body: toRequestBody(
        buildWanfangDetailRequestFrame(locator.resourceId, resourceType)
      ) as unknown as RequestInit["body"]
    }
  );

  if (!response.ok) {
    throw new Error(
      `Wanfang grpc-web detail request failed with status ${response.status} for ${locator.resourceId}.`
    );
  }

  const record = parseWanfangDetailResponse(response.buffer, locator.detailUrl);
  if (!record) {
    return null;
  }

  if (resourceType !== "Periodical") {
    return record;
  }

  const sourceCategory = readRawString(record.raw, "sourceCategory") ?? "QK_CHI";
  const providerCode = readRawString(record.raw, "providerCode") ?? "WF";
  const [citationCount, referenceCount] = await Promise.all([
    fetchWanfangReferenceCount(
      locator.resourceId,
      "Quotation",
      sourceCategory,
      providerCode,
      locator.detailUrl,
      context
    ).catch(() => undefined),
    fetchWanfangReferenceCount(
      locator.resourceId,
      "Reference",
      sourceCategory,
      providerCode,
      locator.detailUrl,
      context
    ).catch(() => undefined)
  ]);

  return {
    ...record,
    citationCount: record.citationCount ?? citationCount,
    referenceCount: record.referenceCount ?? referenceCount
  };
}

async function fetchWanfangReferenceCount(
  resourceId: string,
  listType: "Quotation" | "Reference",
  sourceCategory: string,
  providerCode: string,
  referer: string,
  context: ProviderContext
): Promise<number | undefined> {
  const response = await context.http.request(
    "https://d.wanfangdata.com.cn/Detail.DetailService/getReferenceList",
    {
      method: "POST",
      headers: buildWanfangGrpcHeaders(context, referer),
      body: toRequestBody(
        buildWanfangReferenceListRequestFrame(
          resourceId,
          listType,
          sourceCategory,
          providerCode
        )
      ) as unknown as RequestInit["body"]
    }
  );

  if (!response.ok) {
    throw new Error(
      `Wanfang ${listType.toLowerCase()} request failed with status ${response.status} for ${resourceId}.`
    );
  }

  return parseWanfangReferenceCountResponse(response.buffer);
}

function buildWanfangGrpcHeaders(
  context: ProviderContext,
  referer: string
): Record<string, string> {
  return {
    ...buildBrowserCompatibleHeaders(context.config, {
      referer,
      httpreferer: "https://www.wanfangdata.com.cn/"
    }),
    "content-type": "application/grpc-web+proto",
    "x-grpc-web": "1",
    "x-user-agent": "grpc-web-javascript/0.1"
  };
}

function clampWanfangPageSize(maxResults: number): number {
  return Math.min(Math.max(maxResults * 4, 20), 50);
}

function readRawString(
  raw: ArticleRecord["raw"] | undefined,
  key: string
): string | undefined {
  const value = raw?.[key];
  return typeof value === "string" ? value : undefined;
}

function toRequestBody(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer);
}
