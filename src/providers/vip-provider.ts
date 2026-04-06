import { createCipheriv, createHmac, randomUUID } from "node:crypto";
import { ProviderContext, SearchProvider } from "./base.js";
import {
  ArticleRecord,
  DownloadCandidate,
  ProviderSearchResult,
  SearchMode,
  SearchRequest
} from "../types.js";
import { normalizeDoi, normalizeWhitespace, uniqueList } from "../utils/text.js";
import { buildBrowserCompatibleHeaders } from "../utils/http-headers.js";

interface VipNamedEntity {
  name?: string;
}

interface VipJournalInfo {
  name?: string;
  vol?: string;
  num?: string;
  issn?: string;
  publisher?: string;
  rangeInfo?: Array<{
    abbrNameVersion?: string;
    subjectName?: string;
  }>;
}

interface VipClassInfoSection {
  list?: Array<{
    name?: string;
  }>;
}

interface VipClassInfo {
  clc?: VipClassInfoSection;
  edu?: VipClassInfoSection;
  nec?: VipClassInfoSection;
}

interface VipProviderLink {
  database?: string;
  _v?: {
    uri?: string;
  };
}

interface VipRow {
  id?: string;
  doi?: string;
  title?: string;
  paperLanguage?: string;
  abstr?: string;
  pubDate?: string;
  year?: number;
  isPdf?: number;
  pdfPath?: string;
  byRefCnt?: number;
  byUnityRefCnt?: number;
  refCnt?: number;
  beginPage?: string;
  endPage?: string;
  jumpPage?: string;
  cqvipIsOa?: boolean;
  keywordInfo?: VipNamedEntity[];
  authorInfo?: VipNamedEntity[];
  organInfo?: VipNamedEntity[];
  journalInfo?: VipJournalInfo;
  providerSource?: VipProviderLink[];
  classInfo?: VipClassInfo;
  type?: number | string;
}

interface VipSearchResponse {
  code?: number;
  message?: string | null;
  data?: {
    total?: number;
    rows?: VipRow[];
  };
}

interface VipBootstrap {
  uuid: string;
  env: string;
  authEnv: string;
}

const VIP_APP_ID = "f0de4ab08fbe4ca2afd1708d160d33a4";
const VIP_SIGNATURE_SECRET = "06925E8A-CBB9-4A95-A738-B1C9156B9D06";
const VIP_SEARCH_PATH = "/advanceSearch";
const VIP_SEARCH_TYPES = [1, 2, 3, 5, 6, 18];
const VIP_BOOTSTRAP_TTL_MS = 30 * 60 * 1000;

export class VipProvider implements SearchProvider {
  readonly id = "vip" as const;

  async search(
    request: SearchRequest,
    context: ProviderContext
  ): Promise<ProviderSearchResult> {
    const cacheKey = JSON.stringify({ version: 2, request });
    const cached = await context.cache.get<ProviderSearchResult>("search/vip", cacheKey);
    if (cached) {
      return cached;
    }

    const response = await fetchVipSearchResponse(request.query, context);
    const rows = response.data?.rows ?? [];
    const mapped = rows.map(mapVipRowToRecord);
    const items = applyVipModeFilter(mapped, request.mode, request.query).slice(
      0,
      request.maxResults
    );

    const result: ProviderSearchResult = {
      source: this.id,
      total: response.data?.total ?? items.length,
      items,
      notes: [
        "CQVIP search now uses signed HTTP requests reproduced from the public site runtime.",
        "Search does not require login or a visible browser window.",
        "Some detail or download routes may still require your own account.",
        "Current VIP integration prioritizes rich metadata retrieval over full-text download."
      ]
    };

    await context.cache.set("search/vip", cacheKey, result, context.config.searchCacheTtlMs);
    return result;
  }

  async getRecord(locator: string, context: ProviderContext): Promise<ArticleRecord | null> {
    const doi = normalizeDoi(locator);
    const recordId = parseVipRecordId(locator);
    const query = doi ?? recordId;
    if (!query) {
      return null;
    }

    const response = await fetchVipSearchResponse(query, context);
    const rows = response.data?.rows ?? [];
    const matched = rows.find((row) => {
      if (doi) {
        return normalizeDoi(row.doi) === doi;
      }
      return normalizeWhitespace(row.id) === recordId;
    });

    return matched ? mapVipRowToRecord(matched) : null;
  }

  async resolveDownload(
    _record: ArticleRecord,
    _context: ProviderContext
  ): Promise<DownloadCandidate[]> {
    return [];
  }
}

export function mapVipRowToRecord(row: VipRow): ArticleRecord {
  const detailUrl = buildVipDetailUrl(row.id);
  const keywords = uniqueList((row.keywordInfo ?? []).map((keyword) => keyword.name ?? ""));
  const subjects = uniqueList([
    ...flattenVipClassNames(row.classInfo?.clc),
    ...flattenVipClassNames(row.classInfo?.edu),
    ...flattenVipClassNames(row.classInfo?.nec),
    ...((row.journalInfo?.rangeInfo ?? []).map((entry) =>
      normalizeWhitespace(entry.abbrNameVersion ?? entry.subjectName)
    ) ?? [])
  ]);
  const citationCount = [row.byUnityRefCnt, row.byRefCnt]
    .filter((value): value is number => typeof value === "number")
    .sort((left, right) => right - left)[0];

  return {
    id: normalizeWhitespace(row.id) || detailUrl || normalizeWhitespace(row.title) || "vip-record",
    source: "vip",
    title: normalizeWhitespace(row.title) || "Untitled",
    authors: uniqueList((row.authorInfo ?? []).map((author) => author.name ?? "")),
    journal: normalizeWhitespace(row.journalInfo?.name),
    year: row.year,
    volume: normalizeWhitespace(row.journalInfo?.vol),
    issue: normalizeWhitespace(row.journalInfo?.num),
    pages: joinVipPages(row.beginPage, row.endPage, row.jumpPage),
    doi: normalizeDoi(row.doi),
    abstract: normalizeWhitespace(row.abstr),
    keywords: keywords.length ? keywords : undefined,
    institutions: uniqueList((row.organInfo ?? []).map((organ) => organ.name ?? "")),
    language: normalizeWhitespace(row.paperLanguage),
    publisher: normalizeWhitespace(row.journalInfo?.publisher),
    publicationDate: normalizeWhitespace(row.pubDate),
    citationCount,
    referenceCount: row.refCnt,
    sourceType: normalizeVipType(row.type),
    issn: uniqueList([normalizeWhitespace(row.journalInfo?.issn)]),
    subjects: subjects.length ? subjects : undefined,
    detailUrl,
    access: row.isPdf ? "session_required" : "unknown",
    snippets: uniqueList([normalizeWhitespace(row.abstr)].filter(Boolean)),
    raw: {
      vip: row,
      providerLinks: (row.providerSource ?? []).map((entry) => entry._v?.uri).filter(Boolean)
    }
  };
}

async function fetchVipSearchResponse(
  query: string,
  context: ProviderContext,
  attempt = 0
): Promise<VipSearchResponse> {
  const bootstrap = await getVipBootstrap(context, attempt > 0);
  const timestampMs = Date.now();
  const response = await context.http.request(
    `https://www.cqvip.com/newsite${VIP_SEARCH_PATH}`,
    {
      method: "POST",
      headers: buildVipSignedHeaders(bootstrap, timestampMs, context),
      body: JSON.stringify(buildVipSearchPayload(query))
    }
  );

  const payload = JSON.parse(response.text) as VipSearchResponse;
  if ((payload.code === 10009 || payload.code === 505) && attempt < 1) {
    return fetchVipSearchResponse(query, context, attempt + 1);
  }

  if (payload.code !== 200) {
    throw new Error(
      `CQVIP search returned code ${payload.code ?? "unknown"}${payload.message ? `: ${payload.message}` : ""}`
    );
  }

  return payload;
}

async function getVipBootstrap(
  context: ProviderContext,
  forceRefresh: boolean
): Promise<VipBootstrap> {
  if (!forceRefresh) {
    const cached = await context.cache.get<VipBootstrap>("vip/bootstrap", "current");
    if (cached) {
      return cached;
    }
  }

  const html = await context.http.getText("https://www.cqvip.com/", {
    headers: buildBrowserCompatibleHeaders(context.config, {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    })
  });
  const bootstrap = parseVipBootstrapHtml(html);
  await context.cache.set("vip/bootstrap", "current", bootstrap, VIP_BOOTSTRAP_TTL_MS);
  return bootstrap;
}

function buildVipSearchPayload(query: string): Record<string, unknown> {
  return {
    language: null,
    types: VIP_SEARCH_TYPES,
    openForceTranslate: true,
    indexSearch: true,
    resultField: [
      "newspaperInfo",
      "mediaName",
      "providerSource",
      "appNo",
      "pubNo",
      "otherOrganInfo",
      "cqvipIsOa"
    ],
    agsList: [],
    conditions: [
      {
        content: query,
        logicalOperator: "AND",
        searchField: "U",
        exact: false
      }
    ],
    searchGuid: randomUUID()
  };
}

export function parseVipBootstrapHtml(html: string): VipBootstrap {
  const uuid = html.match(/uuid:\"([^\"]+)\"/)?.[1];
  const env = html.match(/env:\"([^\"]+)\"/)?.[1];
  const authEnv = html.match(/authEnv:\"([^\"]+)\"/)?.[1];

  if (!uuid || !env || !authEnv) {
    throw new Error(
      "CQVIP bootstrap data is missing. The site may have changed its SSR payload."
    );
  }

  return {
    uuid,
    env,
    authEnv
  };
}

export function buildVipSignedHeaders(
  bootstrap: VipBootstrap,
  timestampMs: number,
  context: Pick<ProviderContext, "config">
): Record<string, string> {
  const timestampSeconds = Math.floor(timestampMs / 1000);
  const webVersion = String(timestampMs);

  return buildBrowserCompatibleHeaders(context.config, {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    referer: "https://www.cqvip.com/",
    dt: "pc",
    cqvipenv: bootstrap.env,
    "cqvip-type": "sm",
    "cqvip-ts": String(timestampMs),
    path: VIP_SEARCH_PATH,
    "cqvip-sign": buildVipRequestSignature(
      `${VIP_SEARCH_PATH}-${timestampMs}`,
      bootstrap.uuid
    ),
    appid: VIP_APP_ID,
    timestamp: String(timestampSeconds),
    signature: buildVipTimestampSignature(timestampSeconds),
    "auth-env": bootstrap.authEnv,
    webversion: webVersion
  });
}

function buildVipTimestampSignature(timestampSeconds: number): string {
  const payload = `${VIP_APP_ID}\n${VIP_SIGNATURE_SECRET}\n${timestampSeconds}`;
  return createHmac("sha1", Buffer.from(VIP_SIGNATURE_SECRET, "utf8"))
    .update(Buffer.from(payload, "utf8"))
    .digest("base64");
}

function buildVipRequestSignature(plainText: string, uuid: string): string {
  let payload = Buffer.from(plainText, "utf8");
  const remainder = payload.length % 8;
  if (remainder !== 0) {
    payload = Buffer.concat([payload, Buffer.alloc(8 - remainder, 0)]);
  }

  const key = normalizeVipDesKey(uuid);
  const cipher = createCipheriv("des-ede3-ecb", Buffer.concat([key, key, key]), null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(payload), cipher.final()]).toString("hex");
}

function normalizeVipDesKey(value: string): Buffer {
  const buffer = Buffer.from(normalizeWhitespace(value), "utf8");
  if (buffer.length === 8) {
    return buffer;
  }

  if (buffer.length > 8) {
    return buffer.subarray(0, 8);
  }

  return Buffer.concat([buffer, Buffer.alloc(8 - buffer.length, 0)]);
}

function applyVipModeFilter(
  items: ArticleRecord[],
  mode: SearchMode,
  query: string
): ArticleRecord[] {
  const normalizedQuery = normalizeWhitespace(query).toLowerCase();
  if (mode === "keyword") {
    return items;
  }

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

function buildVipDetailUrl(recordId: string | undefined): string | undefined {
  const normalized = normalizeWhitespace(recordId);
  if (!normalized) {
    return undefined;
  }
  return `https://www.cqvip.com/doc/journal/${normalized}?resourceId=${normalized}&type=1`;
}

function parseVipRecordId(locator: string): string | undefined {
  const normalized = normalizeWhitespace(locator);
  if (!normalized) {
    return undefined;
  }

  const directMatch = normalized.match(/^\d+$/);
  if (directMatch) {
    return directMatch[0];
  }

  try {
    const url = new URL(locator);
    return normalizeWhitespace(url.searchParams.get("resourceId")) || undefined;
  } catch {
    return undefined;
  }
}

function flattenVipClassNames(section: VipClassInfoSection | undefined): string[] {
  return (section?.list ?? []).map((entry) => normalizeWhitespace(entry.name));
}

function joinVipPages(
  beginPage: string | undefined,
  endPage: string | undefined,
  jumpPage: string | undefined
): string | undefined {
  const begin = normalizeWhitespace(beginPage);
  const end = normalizeWhitespace(endPage);
  const jump = normalizeWhitespace(jumpPage);

  if (begin && end) {
    return `${begin}-${end}`;
  }
  return begin || end || jump || undefined;
}

function normalizeVipType(type: number | string | undefined): string | undefined {
  if (type === 1 || type === "1") {
    return "journal-article";
  }
  return normalizeWhitespace(String(type ?? "")) || undefined;
}
