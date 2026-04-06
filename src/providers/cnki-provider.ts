import { load } from "cheerio";
import { SearchProvider, ProviderAuthError, ProviderContext } from "./base.js";
import {
  ArticleRecord,
  DownloadCandidate,
  ProviderSearchResult,
  SearchRequest
} from "../types.js";
import {
  extractYear,
  normalizeDoi,
  normalizeWhitespace,
  stripHtmlTags,
  uniqueList
} from "../utils/text.js";
import { sha1 } from "../utils/hash.js";

const CNKI_SEARCH_CACHE_VERSION = "cnki-search-v3";
const CNKI_BRIEF_GRID_URL = "https://kns.cnki.net/kns8s/brief/grid";
const CNKI_HTML_ACCEPT =
  "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8";
const CNKI_AI_READER_LABEL = "CNKI AI\u9605\u8bfb";

type CnkiTransport = "http" | "browser";

interface CnkiHtmlResponse {
  html: string;
  baseUrl: string;
  transport: CnkiTransport;
}

interface CnkiDownloadLink {
  label: string;
  url: string;
  format: "pdf" | "caj" | "unknown";
}

export class CnkiProvider implements SearchProvider {
  readonly id = "cnki" as const;

  async search(
    request: SearchRequest,
    context: ProviderContext
  ): Promise<ProviderSearchResult> {
    const cacheKey = buildCnkiSearchCacheKey(
      request,
      context.browser.getStateVersion("cnki"),
      context.config.cnkiRuntimeMode
    );
    const cached = await context.cache.get<ProviderSearchResult>("search/cnki", cacheKey);
    if (cached) {
      return cached;
    }

    const { html, baseUrl, transport } = await fetchCnkiSearchHtml(request, context);
    const items = parseCnkiSearchHtml(html, baseUrl).slice(0, request.maxResults);
    const result: ProviderSearchResult = {
      source: this.id,
      total: items.length,
      items,
      notes: [
        transport === "http"
          ? "CNKI search used saved-session HTTP requests and avoided opening a visible browser page."
          : "CNKI search fell back to the browser flow after the protocol request was blocked.",
        "CNKI downloads only use official links and still depend on your own account or institution permissions."
      ]
    };

    if (items.length > 0) {
      await context.cache.set("search/cnki", cacheKey, result, context.config.searchCacheTtlMs);
    }
    return result;
  }

  async getRecord(locator: string, context: ProviderContext): Promise<ArticleRecord | null> {
    if (!/^https?:\/\//i.test(locator)) {
      return null;
    }

    const { html, baseUrl } = await fetchCnkiDetailHtml(locator, context);
    return parseCnkiDetailHtml(html, baseUrl);
  }

  async resolveDownload(
    record: ArticleRecord,
    context: ProviderContext
  ): Promise<DownloadCandidate[]> {
    let workingRecord = record;
    const inlineCandidates = normalizeRawDownloadCandidates(
      (record.raw?.downloadCandidates ?? []) as Array<{
        url?: string;
        label?: string;
        format?: string;
      }>
    );

    if ((!hasUsableCnkiDownloadUrl(record.downloadUrl) && inlineCandidates.length === 0) && record.detailUrl) {
      const fullRecord = await this.getRecord(record.detailUrl, context);
      if (fullRecord) {
        workingRecord = {
          ...record,
          ...fullRecord
        };
      }
    }

    const rawCandidates = normalizeRawDownloadCandidates(
      (workingRecord.raw?.downloadCandidates ?? []) as Array<{
        url?: string;
        label?: string;
        format?: string;
      }>
    );

    const candidates: DownloadCandidate[] = [];
    appendCnkiDownloadCandidate(
      candidates,
      context,
      workingRecord.id,
      "CNKI primary download",
      workingRecord.downloadUrl,
      undefined,
      workingRecord.detailUrl
    );

    for (const candidate of rawCandidates) {
      appendCnkiDownloadCandidate(
        candidates,
        context,
        workingRecord.id,
        candidate.label,
        candidate.url,
        candidate.format,
        workingRecord.detailUrl
      );
    }

    const deduped = new Map<string, DownloadCandidate>();
    for (const candidate of candidates) {
      const key = `${candidate.method}:${candidate.url}`;
      if (!deduped.has(key)) {
        deduped.set(key, candidate);
      }
    }
    return [...deduped.values()];
  }
}

export function buildCnkiSearchUrl(request: SearchRequest): string {
  const params = new URLSearchParams({
    rc: request.filters?.resourceCode ?? "CJFQ",
    kw: request.query,
    rt: "journal",
    fd: cnkiFieldByMode(request.mode)
  });
  return `https://kns.cnki.net/starter?${params.toString()}`;
}

export function buildCnkiSearchCacheKey(
  request: SearchRequest,
  stateVersion: string,
  runtimeMode: "auto" | "http_only" | "headed"
): string {
  return JSON.stringify({
    version: CNKI_SEARCH_CACHE_VERSION,
    stateVersion,
    runtimeMode,
    request
  });
}

export function buildCnkiBriefGridForm(
  classId: string,
  request: SearchRequest
): Record<string, string> {
  const field = cnkiFieldByMode(request.mode);
  const title = cnkiModeTitle(request.mode);
  const queryJson = JSON.stringify({
    Platform: "",
    Resource: "JOURNAL",
    Classid: classId,
    Products: "",
    QNode: {
      QGroup: [
        {
          Key: cnkiModeGroupKey(request.mode),
          Title: "",
          Logic: 0,
          Items: [
            {
              Field: field,
              Value: request.query,
              Operator: "TOPRANK",
              Logic: 0,
              Title: title
            }
          ],
          ChildItems: []
        }
      ]
    },
    ExScope: 1,
    SearchType: 2,
    Rlang: "CHINESE",
    KuaKuCode: "",
    Expands: {},
    SearchFrom: 1
  });

  return {
    boolSearch: "true",
    QueryJson: queryJson,
    pageNum: "1",
    pageSize: String(Math.min(Math.max(request.maxResults, 1), 50)),
    dstyle: "listmode",
    aside: `${title}：${request.query}`,
    searchFrom: "资源范围：学术期刊",
    subject: "",
    language: "",
    uniplatform: "",
    CurPage: "1"
  };
}

export function parseCnkiSearchHtml(html: string, baseUrl: string): ArticleRecord[] {
  const $ = load(html);
  const rows = pickSearchRows($);
  const items: ArticleRecord[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const titleAnchor = firstLink(row, [
      "td.name a.fz14",
      "a.fz14",
      "a[href*='article/abstract']",
      "a[href*='detail']",
      "a[href*='Detail']",
      "a[href*='FileName=']"
    ]);
    const title = normalizeWhitespace(titleAnchor.text());
    if (!title || seen.has(title)) {
      continue;
    }
    seen.add(title);

    const detailUrl = normalizeCnkiUrl(absolutize(baseUrl, titleAnchor.attr("href")));
    const downloadLinks = collectRowDownloadLinks(row, baseUrl);
    const primaryDownload = downloadLinks.find(
      (link) => link.label !== CNKI_AI_READER_LABEL
    );
    const rowText = normalizeWhitespace(row.text());
    const authors =
      collectRowTexts(row, ["td.author a", "td.author"])
        .map(cleanCnkiAuthor)
        .filter(Boolean) || [];
    const journal = cleanCnkiJournal(
      normalizeWhitespace(row.find("td.source").text()) ||
        extractCnkiJournal(rowText) ||
        extractCnkiJournalFromText(rowText)
    );
    const dateText = normalizeWhitespace(row.find("td.date").text());
    const year = extractYear(dateText || rowText);
    const doi = normalizeDoi(rowText);

    items.push({
      id: sha1(detailUrl || `${title}:${rowText}`),
      source: "cnki",
      title: cleanCnkiTitle(title),
      authors: authors.length ? uniqueList(authors) : extractCnkiAuthors(rowText),
      journal,
      year,
      doi,
      detailUrl,
      downloadUrl: primaryDownload?.url,
      access: primaryDownload?.url ? "session_required" : "unknown",
      snippets: [rowText],
      raw: {
        rowText,
        downloadCandidates: downloadLinks
      }
    });
  }

  return items;
}

export function parseCnkiDetailHtml(html: string, baseUrl: string): ArticleRecord | null {
  const $ = load(html);
  const title = pickFirstText($, ["#Title", ".wx-tit h1", ".title h1", "h1"]);
  if (!title) {
    return null;
  }

  const authors = uniqueList(
    collectTexts($, [
      "#authorpart a",
      ".author a",
      "a.author-name",
      ".authors a"
    ]).map(cleanCnkiAuthor)
  );

  const keywords = uniqueList(
    collectTexts($, [
      "#catalog_KEYWORD ~ a",
      ".keywords a",
      "#keyword a",
      ".keywords-list a"
    ]).map((keyword) => keyword.replace(/[;；]\s*$/, ""))
  );

  const sourceText = collectTexts($, [".sourinfo p", ".source p", ".sourinfo", ".source"])
    .join(" ");
  const journal = cleanCnkiJournal(
    pickFirstText($, [".top-tip a", ".source a", ".sourinfo a"]) ||
      extractCnkiJournal(sourceText) ||
      extractCnkiJournalFromText(sourceText)
  );

  const downloadCandidates = collectAnchors($, [
    ".download-btns a[href]",
    "#cajDown",
    "#pdfDown",
    "a.btn-download",
    "a.briefDl_D",
    "a.briefDl_Y",
    "a[class*='download']",
    "a[href*='bar/download/order']",
    "a[href*='download']",
    "a[href*='DownLoad']",
    "a[href*='cajdownload']"
  ])
    .map((link) => ({
      label: normalizeWhitespace(link.text) || inferCnkiDownloadLabel(link.href),
      url: normalizeCnkiUrl(absolutize(baseUrl, link.href)),
      format: guessDownloadFormat(link.href, link.text)
    }))
    .filter((link): link is CnkiDownloadLink => {
      if (!link.url) {
        return false;
      }
      return !isIgnoredCnkiDownloadUrl(link.url);
    });

  const detailText = normalizeWhitespace($.root().text());
  const doi = normalizeDoi(detailText);
  const firstDownload = downloadCandidates.find(
    (candidate) => candidate.label !== CNKI_AI_READER_LABEL
  );
  const year = extractYear(sourceText || detailText);

  return {
    id: sha1(baseUrl),
    source: "cnki",
    title: cleanCnkiTitle(title),
    authors,
    journal,
    year,
    doi,
    abstract: stripHtmlTags(
      pickFirstText($, [
        "#ChDivSummary",
        ".abstract-text",
        ".summary",
        "#summary",
        ".abstract",
        ".brief"
      ])
    ),
    keywords,
    detailUrl: baseUrl,
    downloadUrl: firstDownload?.url,
    access: firstDownload?.url ? "session_required" : "unknown",
    raw: {
      sourceText,
      downloadCandidates
    }
  };
}

async function fetchCnkiSearchHtml(
  request: SearchRequest,
  context: ProviderContext
): Promise<CnkiHtmlResponse> {
  if (context.config.cnkiRuntimeMode !== "headed") {
    try {
      return await fetchCnkiSearchHtmlWithRequest(request, context);
    } catch (error) {
      if (context.config.cnkiRuntimeMode === "http_only") {
        throw normalizeCnkiSearchError(error);
      }
    }
  }

  return fetchCnkiHtmlWithBrowser(
    buildCnkiSearchUrl(request),
    context,
    "CNKI returned a verification page. Save a browser session with `npm run auth:cnki` first."
  );
}

async function fetchCnkiDetailHtml(
  locator: string,
  context: ProviderContext
): Promise<CnkiHtmlResponse> {
  if (context.config.cnkiRuntimeMode !== "headed") {
    try {
      return await fetchCnkiHtmlWithRequest(locator, context);
    } catch (error) {
      if (context.config.cnkiRuntimeMode === "http_only") {
        throw normalizeCnkiDetailError(error);
      }
    }
  }

  return fetchCnkiHtmlWithBrowser(
    locator,
    context,
    "CNKI detail page still requires verification. Refresh the saved CNKI browser session."
  );
}

async function fetchCnkiSearchHtmlWithRequest(
  request: SearchRequest,
  context: ProviderContext
): Promise<CnkiHtmlResponse> {
  const landing = await fetchCnkiHtmlWithRequest(buildCnkiSearchUrl(request), context);
  const classId = extractCnkiClassId(landing.baseUrl);
  if (!classId) {
    throw new ProviderAuthError(
      "CNKI did not return a result page identifier. Refresh the saved CNKI browser session."
    );
  }

  const grid = await context.browser.requestWithSession("cnki", CNKI_BRIEF_GRID_URL, {
    method: "POST",
    accept: "*/*",
    referer: landing.baseUrl,
    headers: {
      "x-requested-with": "XMLHttpRequest"
    },
    form: buildCnkiBriefGridForm(classId, request)
  });

  if (!grid.ok) {
    throw new ProviderAuthError(
      `CNKI rejected the session HTTP request with status ${grid.status}. Refresh the saved browser session.`
    );
  }

  if (isChallengePage(grid.url, grid.text)) {
    throw new ProviderAuthError(
      "CNKI returned a verification page while loading the result list. Refresh the saved browser session."
    );
  }

  return {
    html: grid.text,
    baseUrl: landing.baseUrl,
    transport: "http"
  };
}

async function fetchCnkiHtmlWithRequest(
  url: string,
  context: ProviderContext
): Promise<CnkiHtmlResponse> {
  const response = await context.browser.requestWithSession("cnki", url, {
    accept: CNKI_HTML_ACCEPT
  });
  if (!response.ok) {
    throw new ProviderAuthError(
      `CNKI rejected the session HTTP request with status ${response.status}. Refresh the saved browser session.`
    );
  }
  if (isChallengePage(response.url, response.text)) {
    throw new ProviderAuthError(
      "CNKI returned a verification page. Refresh the saved browser session."
    );
  }

  return {
    html: response.text,
    baseUrl: response.url,
    transport: "http"
  };
}

async function fetchCnkiHtmlWithBrowser(
  url: string,
  context: ProviderContext,
  verificationMessage: string
): Promise<CnkiHtmlResponse> {
  const payload = await context.browser.withPage("cnki", async (page) => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const content = await page.content();
    if (isChallengePage(page.url(), content)) {
      throw new ProviderAuthError(verificationMessage);
    }
    return {
      html: content,
      baseUrl: page.url()
    };
  });

  return {
    ...payload,
    transport: "browser"
  };
}

function appendCnkiDownloadCandidate(
  candidates: DownloadCandidate[],
  context: ProviderContext,
  recordId: string,
  label: string,
  url: string | undefined,
  formatHint: string | undefined,
  referer: string | undefined
): void {
  const normalizedUrl = normalizeCnkiUrl(url);
  if (!normalizedUrl || isIgnoredCnkiDownloadUrl(normalizedUrl)) {
    return;
  }

  const format = guessDownloadFormat(normalizedUrl, formatHint);
  const baseCandidate = {
    source: "cnki" as const,
    label: normalizeWhitespace(label) || inferCnkiDownloadLabel(normalizedUrl, formatHint),
    url: normalizedUrl,
    format,
    requiresAuth: true,
    referer
  };

  if (context.config.cnkiRuntimeMode !== "headed") {
    candidates.push({
      ...baseCandidate,
      id: `${recordId}:http:${sha1(normalizedUrl)}`,
      method: "http"
    });
  }

  if (context.config.cnkiRuntimeMode !== "http_only") {
    candidates.push({
      ...baseCandidate,
      id: `${recordId}:browser:${sha1(normalizedUrl)}`,
      method: "browser"
    });
  }
}

function normalizeRawDownloadCandidates(
  candidates: Array<{ url?: string; label?: string; format?: string }>
): CnkiDownloadLink[] {
  return candidates
    .map((candidate) => ({
      label:
        normalizeWhitespace(candidate.label) ||
        inferCnkiDownloadLabel(candidate.url, candidate.format),
      url: normalizeCnkiUrl(candidate.url),
      format: guessDownloadFormat(candidate.url, candidate.format)
    }))
    .filter((candidate): candidate is CnkiDownloadLink => {
      if (!candidate.url) {
        return false;
      }
      return !isIgnoredCnkiDownloadUrl(candidate.url);
    });
}

function cnkiFieldByMode(mode: SearchRequest["mode"]): string {
  switch (mode) {
    case "title":
      return "TI";
    case "author":
      return "AU";
    case "doi":
      return "DOI";
    case "journal":
      return "LY";
    case "keyword":
    default:
      return "SU";
  }
}

function cnkiModeTitle(mode: SearchRequest["mode"]): string {
  switch (mode) {
    case "title":
      return "篇名";
    case "author":
      return "作者";
    case "doi":
      return "DOI";
    case "journal":
      return "刊名";
    case "keyword":
    default:
      return "主题";
  }
}

function cnkiModeGroupKey(mode: SearchRequest["mode"]): string {
  switch (mode) {
    case "title":
      return "Title";
    case "author":
      return "Author";
    case "doi":
      return "DOI";
    case "journal":
      return "Journal";
    case "keyword":
    default:
      return "Subject";
  }
}

function pickSearchRows($: ReturnType<typeof load>) {
  const selectors = [
    "table tbody tr",
    "table tr",
    ".result-table-list tbody tr",
    ".result-table-list tr",
    ".search-result-list li",
    ".search-result-item",
    ".result-item"
  ];

  for (const selector of selectors) {
    const rows = $(selector)
      .toArray()
      .filter((node) => $(node).find("a").length > 0);
    if (rows.length) {
      return rows.map((node) => $(node));
    }
  }

  return [];
}

function firstLink(row: ReturnType<typeof load>["prototype"], selectors: string[]) {
  for (const selector of selectors) {
    const element = row.find(selector).first();
    if (element.length) {
      return element;
    }
  }
  return row.find("a").first();
}

function collectTexts($: ReturnType<typeof load>, selectors: string[]): string[] {
  for (const selector of selectors) {
    const values = $(selector)
      .toArray()
      .map((node) => normalizeWhitespace($(node).text()))
      .filter(Boolean);
    if (values.length) {
      return values;
    }
  }
  return [];
}

function collectRowTexts(
  row: ReturnType<typeof load>["prototype"],
  selectors: string[]
): string[] {
  for (const selector of selectors) {
    const values: string[] = [];
    for (const node of row.find(selector).toArray()) {
      const text = normalizeWhitespace(load(node).text());
      if (text) {
        values.push(text);
      }
    }
    if (values.length) {
      return values;
    }
  }
  return [];
}

function collectAnchors(
  $: ReturnType<typeof load>,
  selectors: string[]
): Array<{ text: string; href: string }> {
  for (const selector of selectors) {
    const links = $(selector)
      .toArray()
      .map((node) => ({
        text: normalizeWhitespace($(node).text()),
        href: normalizeWhitespace($(node).attr("href"))
      }))
      .filter((link) => Boolean(link.href));
    if (links.length) {
      return links;
    }
  }
  return [];
}

function collectRowDownloadLinks(
  row: ReturnType<typeof load>["prototype"],
  baseUrl: string
): CnkiDownloadLink[] {
  const selectors = [
    "td.operat a.downloadlink",
    "td.operat a[href*='bar/download/order']",
    "a.briefDl_D",
    "a.briefDl_Y",
    "a[class*='download']",
    "a[href*='download']",
    "a[href*='DownLoad']"
  ];

  const links: CnkiDownloadLink[] = [];
  for (const selector of selectors) {
    for (const node of row.find(selector).toArray()) {
      const element = row.find(node);
      const href = normalizeCnkiUrl(absolutize(baseUrl, element.attr("href")));
      if (!href) {
        continue;
      }
      links.push({
        label:
          normalizeWhitespace(element.text()) ||
          inferCnkiDownloadLabel(href, element.attr("class")),
        url: href,
        format: guessDownloadFormat(href, element.text())
      });
    }
    if (links.length) {
      return uniqueDownloadLinks(links);
    }
  }

  return [];
}

function uniqueDownloadLinks(links: CnkiDownloadLink[]): CnkiDownloadLink[] {
  const seen = new Set<string>();
  const unique: CnkiDownloadLink[] = [];
  for (const link of links) {
    if (seen.has(link.url)) {
      continue;
    }
    seen.add(link.url);
    unique.push(link);
  }
  return unique;
}

function pickFirstText($: ReturnType<typeof load>, selectors: string[]): string {
  for (const selector of selectors) {
    const text = normalizeWhitespace($(selector).first().text());
    if (text) {
      return text;
    }
  }
  return "";
}

function extractCnkiAuthors(text: string): string[] {
  const explicit = text.match(/作者[:：]\s*(.+?)(?:来源[:：]|摘要[:：]|关键词[:：]|$)/);
  if (explicit?.[1]) {
    return uniqueList(explicit[1].split(/[;,，；]/).map((value) => cleanCnkiAuthor(value)));
  }
  return [];
}

function extractCnkiJournal(text: string): string | undefined {
  const explicit = text.match(/来源[:：]\s*([^。]+?)(?:\b(19|20)\d{2}\b|$)/);
  if (explicit?.[1]) {
    return normalizeWhitespace(explicit[1]);
  }
  return undefined;
}

function extractCnkiJournalFromText(text: string): string | undefined {
  const generic = normalizeWhitespace(text).match(/^(.+?)\s+(?:19|20)\d{2}(?:\b|$)/);
  if (generic?.[1]) {
    return normalizeWhitespace(generic[1]);
  }
  return undefined;
}

function extractCnkiClassId(url: string): string | undefined {
  try {
    return new URL(url).searchParams.get("classid") ?? undefined;
  } catch {
    return undefined;
  }
}

function absolutize(baseUrl: string, maybeUrl: string | undefined): string | undefined {
  const url = normalizeWhitespace(maybeUrl);
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return url;
  }
}

function normalizeCnkiUrl(url: string | undefined): string | undefined {
  const value = normalizeWhitespace(url);
  if (!value || /^javascript:/i.test(value) || value === "#") {
    return undefined;
  }
  return value;
}

function hasUsableCnkiDownloadUrl(url: string | undefined): boolean {
  const normalized = normalizeCnkiUrl(url);
  if (!normalized) {
    return false;
  }
  return !isIgnoredCnkiDownloadUrl(normalized);
}

function isIgnoredCnkiDownloadUrl(url: string): boolean {
  const normalized = url.toLowerCase();
  return (
    normalized.includes("ai.cnki.net") ||
    normalized.includes("au.cnki.net/author/workbench")
  );
}

function inferCnkiDownloadLabel(url: string | undefined, hint?: string): string {
  const value = `${url ?? ""} ${hint ?? ""}`.toLowerCase();
  if (value.includes("caj")) {
    return "CAJ download";
  }
  if (value.includes("pdf")) {
    return "PDF download";
  }
  if (value.includes("bar/download/order")) {
    return "CNKI download";
  }
  return "CNKI download candidate";
}

function cleanCnkiJournal(journal: string | undefined): string | undefined {
  const value = normalizeWhitespace(journal);
  if (!value) {
    return undefined;
  }

  return value.replace(/[\s.。;；,:：]+$/, "");
}

function cleanCnkiTitle(title: string): string {
  return normalizeWhitespace(title.replace(/\s+附视频$/, ""));
}

function cleanCnkiAuthor(author: string): string {
  return normalizeWhitespace(author.replace(/\d+$/, ""));
}

function guessDownloadFormat(
  url: string | undefined,
  hint?: string
): "pdf" | "caj" | "unknown" {
  const value = `${url ?? ""} ${hint ?? ""}`.toLowerCase();
  if (value.includes(".pdf") || value.includes("pdf")) {
    return "pdf";
  }
  if (value.includes(".caj") || value.includes("caj")) {
    return "caj";
  }
  return "unknown";
}

function normalizeCnkiSearchError(error: unknown): Error {
  if (error instanceof ProviderAuthError) {
    return error;
  }
  if (error instanceof Error) {
    return new ProviderAuthError(
      `CNKI session HTTP search failed: ${error.message}. Refresh the saved browser session or switch CNKI_MCP_CNKI_RUNTIME_MODE=auto.`
    );
  }
  return new ProviderAuthError(
    "CNKI session HTTP search failed. Refresh the saved browser session or switch CNKI_MCP_CNKI_RUNTIME_MODE=auto."
  );
}

function normalizeCnkiDetailError(error: unknown): Error {
  if (error instanceof ProviderAuthError) {
    return error;
  }
  if (error instanceof Error) {
    return new ProviderAuthError(
      `CNKI session HTTP detail request failed: ${error.message}. Refresh the saved browser session or switch CNKI_MCP_CNKI_RUNTIME_MODE=auto.`
    );
  }
  return new ProviderAuthError(
    "CNKI session HTTP detail request failed. Refresh the saved browser session or switch CNKI_MCP_CNKI_RUNTIME_MODE=auto."
  );
}

function isChallengePage(url: string, html: string): boolean {
  return (
    url.includes("/verify/") ||
    html.includes("安全验证") ||
    html.includes("captchaType") ||
    html.includes("Just a moment") ||
    html.includes("cf-mitigated")
  );
}
