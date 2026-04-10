import { ProviderContext, SearchProvider } from "./base.js";
import {
  ArticleRecord,
  DownloadCandidate,
  ProviderSearchResult,
  SearchRequest,
  SourceId
} from "../types.js";
import { normalizeDoi, normalizeWhitespace } from "../utils/text.js";
import {
  applyUnpaywall,
  buildCrossrefSearchUrl,
  buildOpenAlexSearchUrl,
  CrossrefItem,
  CrossrefListResponse,
  CrossrefSingleResponse,
  hasDoiPrefix,
  mapCrossrefItemToRecord,
  mapOpenAlexItemToRecord,
  matchJournalName,
  mergeMetadataRecords,
  normalizeOpenAccessFormat,
  OpenAlexResponse,
  OpenAlexWork,
  UnpaywallResponse
} from "./open-metadata.js";
import { searchCrossrefAuthorAffiliationCandidates } from "./author-affiliation-rescue.js";

export interface MetadataLibraryProviderOptions {
  id: SourceId;
  displayName: string;
  cacheNamespace: string;
  cacheVersion: number;
  notes: string[];
  doiPrefixes?: string[];
  publisherPattern?: RegExp;
  excludePublisherPattern?: RegExp;
  journalPatterns?: RegExp[];
  urlPattern?: RegExp;
  excludeUrlPattern?: RegExp;
  defaultJournal?: string;
  openAlexFilter?: string;
  skipJournalSearchName?: string;
  limitMultiplier?: number;
  keywordSearchHint?: string;
}

export class MetadataLibraryProvider implements SearchProvider {
  readonly id: SourceId;

  constructor(private readonly options: MetadataLibraryProviderOptions) {
    this.id = options.id;
  }

  async search(
    request: SearchRequest,
    context: ProviderContext
  ): Promise<ProviderSearchResult> {
    const cacheKey = JSON.stringify({
      version: this.options.cacheVersion,
      request
    });
    const cached = await context.cache.get<ProviderSearchResult>(
      this.options.cacheNamespace,
      cacheKey
    );
    if (cached) {
      return cached;
    }

    const items =
      request.mode === "doi"
        ? await this.searchByDoi(request.query, context)
        : await this.searchByQuery(request, context);

    const result: ProviderSearchResult = {
      source: this.id,
      total: items.length,
      items,
      notes: this.options.notes
    };

    await context.cache.set(
      this.options.cacheNamespace,
      cacheKey,
      result,
      context.config.searchCacheTtlMs
    );
    return result;
  }

  async getRecord(locator: string, context: ProviderContext): Promise<ArticleRecord | null> {
    const doi = normalizeDoi(locator);
    if (!doi) {
      return null;
    }

    const response = await context.http.getJson<CrossrefSingleResponse>(
      `https://api.crossref.org/works/${encodeURIComponent(doi)}`
    );
    const item = response.message;
    if (!item || !this.matchesCrossrefItem(item)) {
      return null;
    }

    return this.enrichRecord(this.mapCrossrefItem(item), context);
  }

  async resolveDownload(
    record: ArticleRecord,
    context: ProviderContext
  ): Promise<DownloadCandidate[]> {
    const workingRecord =
      record.doi || record.oaUrl || record.raw?.openalex
        ? record
        : (await this.getRecord(record.id, context)) ?? record;

    const candidates: DownloadCandidate[] = [];
    const oaUrl = normalizeWhitespace(workingRecord.oaUrl);
    const oaPdfUrl = normalizeWhitespace(
      (workingRecord.raw?.oaPdfUrl as string | undefined) ?? workingRecord.pdfUrl
    );

    if (oaPdfUrl) {
      candidates.push({
        id: `${workingRecord.id}:oa-pdf`,
        source: this.id,
        label: "Open-access PDF",
        url: oaPdfUrl,
        method: "http",
        format: "pdf",
        requiresAuth: false,
        referer: workingRecord.detailUrl
      });
    } else if (oaUrl) {
      candidates.push({
        id: `${workingRecord.id}:oa-link`,
        source: this.id,
        label: "Open-access full text",
        url: oaUrl,
        method: "http",
        format: normalizeOpenAccessFormat(oaUrl),
        requiresAuth: false,
        referer: workingRecord.detailUrl
      });
    }

    return candidates;
  }

  protected mapCrossrefItem(item: CrossrefItem): ArticleRecord {
    return mapCrossrefItemToRecord(this.id, item, this.options.defaultJournal);
  }

  protected mapOpenAlexItem(item: OpenAlexWork): ArticleRecord {
    return mapOpenAlexItemToRecord(this.id, item, this.options.defaultJournal);
  }

  protected matchesCrossrefItem(item: CrossrefItem): boolean {
    const primaryUrl =
      normalizeWhitespace(item.resource?.primary?.URL) || normalizeWhitespace(item.URL);
    const publisher = normalizeWhitespace(item.publisher);

    if (
      matchesPattern(publisher, this.options.excludePublisherPattern) ||
      matchesPattern(primaryUrl, this.options.excludeUrlPattern)
    ) {
      return false;
    }

    return Boolean(
      hasDoiPrefix(item.DOI, this.options.doiPrefixes ?? []) ||
        matchesAnyJournal(item["container-title"]?.[0], this.options.journalPatterns) ||
        matchesPattern(publisher, this.options.publisherPattern) ||
        matchesPattern(primaryUrl, this.options.urlPattern)
    );
  }

  protected matchesOpenAlexItem(item: OpenAlexWork): boolean {
    const landingPage =
      normalizeWhitespace(item.primary_location?.landing_page_url) ||
      normalizeWhitespace(item.primary_location?.pdf_url);
    const hostOrganization = normalizeWhitespace(
      item.primary_location?.source?.host_organization_name
    );
    const sourceName = normalizeWhitespace(item.primary_location?.source?.display_name);

    if (
      matchesPattern(hostOrganization, this.options.excludePublisherPattern) ||
      matchesPattern(landingPage, this.options.excludeUrlPattern)
    ) {
      return false;
    }

    return Boolean(
      hasDoiPrefix(item.doi ?? undefined, this.options.doiPrefixes ?? []) ||
        matchesAnyJournal(sourceName, this.options.journalPatterns) ||
        matchesPattern(hostOrganization, this.options.publisherPattern) ||
        matchesPattern(landingPage, this.options.urlPattern)
    );
  }

  private async searchByDoi(
    query: string,
    context: ProviderContext
  ): Promise<ArticleRecord[]> {
    const record = await this.getRecord(query, context);
    return record ? [record] : [];
  }

  private async searchByQuery(
    request: SearchRequest,
    context: ProviderContext
  ): Promise<ArticleRecord[]> {
    const limit = clampLimit(request.maxResults * (this.options.limitMultiplier ?? 5));
    const [crossrefResult, openAlexResult] = await Promise.allSettled([
      this.searchCrossref({ ...request, maxResults: limit }, context),
      this.searchOpenAlex({ ...request, maxResults: limit }, context, limit)
    ]);

    const crossrefItems =
      crossrefResult.status === "fulfilled" ? crossrefResult.value : [];
    const openAlexItems =
      openAlexResult.status === "fulfilled" ? openAlexResult.value : [];

    if (
      crossrefResult.status === "rejected" &&
      openAlexResult.status === "rejected"
    ) {
      throw new Error(`${this.options.displayName} metadata sources are temporarily unavailable.`);
    }

    const rescueItems = await this.searchAuthorAffiliationRescue(
      request,
      context,
      limit
    );

    const merged = mergeMetadataRecords([
      ...rescueItems,
      ...crossrefItems,
      ...openAlexItems
    ]).slice(
      0,
      request.maxResults
    );

    return Promise.all(merged.map((record) => this.enrichRecord(record, context)));
  }

  private async searchAuthorAffiliationRescue(
    request: SearchRequest,
    context: ProviderContext,
    limit: number
  ): Promise<ArticleRecord[]> {
    const items = await searchCrossrefAuthorAffiliationCandidates(
      request,
      context,
      limit
    );

    return items
      .filter((item) => this.matchesCrossrefItem(item))
      .map((item) => this.mapCrossrefItem(item));
  }

  private async searchCrossref(
    request: SearchRequest,
    context: ProviderContext
  ): Promise<ArticleRecord[]> {
    const response = await context.http.getJson<CrossrefListResponse>(
      buildCrossrefSearchUrl(this.applySearchHint(request), {
        rows: request.maxResults
      })
    );

    return (response.message.items ?? [])
      .filter((item) => this.matchesCrossrefItem(item))
      .map((item) => this.mapCrossrefItem(item));
  }

  private async searchOpenAlex(
    request: SearchRequest,
    context: ProviderContext,
    limit: number
  ): Promise<ArticleRecord[]> {
    const response = await context.http.getJson<OpenAlexResponse>(
      buildOpenAlexSearchUrl(this.applySearchHint(request), {
        filter: this.options.openAlexFilter,
        limit,
        mailto: context.config.openAlexMailto,
        skipJournalSearchName: this.options.skipJournalSearchName
      })
    );

    return (response.results ?? [])
      .filter((item) => this.matchesOpenAlexItem(item))
      .map((item) => this.mapOpenAlexItem(item));
  }

  private async enrichRecord(
    record: ArticleRecord,
    context: ProviderContext
  ): Promise<ArticleRecord> {
    const doi = normalizeDoi(record.doi);
    if (!doi) {
      return record;
    }

    const [openAlexRecord, unpaywallInfo] = await Promise.all([
      this.fetchOpenAlexByDoi(doi, context),
      this.fetchUnpaywallByDoi(doi, context)
    ]);

    let merged = record;
    if (openAlexRecord) {
      merged = mergeMetadataRecords([merged, openAlexRecord])[0];
    }

    if (unpaywallInfo) {
      merged = applyUnpaywall(merged, unpaywallInfo);
    }

    return merged;
  }

  private async fetchOpenAlexByDoi(
    doi: string,
    context: ProviderContext
  ): Promise<ArticleRecord | null> {
    try {
      const suffix = context.config.openAlexMailto
        ? `?mailto=${encodeURIComponent(context.config.openAlexMailto)}`
        : "";
      const item = await context.http.getJson<OpenAlexWork>(
        `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}${suffix}`
      );
      return this.matchesOpenAlexItem(item) ? this.mapOpenAlexItem(item) : null;
    } catch {
      return null;
    }
  }

  private async fetchUnpaywallByDoi(
    doi: string,
    context: ProviderContext
  ): Promise<UnpaywallResponse | null> {
    if (!context.config.unpaywallEmail) {
      return null;
    }

    try {
      const response = await context.http.request(
        `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(context.config.unpaywallEmail)}`
      );
      if (!response.ok) {
        return null;
      }
      return JSON.parse(response.text) as UnpaywallResponse;
    } catch {
      return null;
    }
  }

  private applySearchHint(request: SearchRequest): SearchRequest {
    const hint = normalizeWhitespace(this.options.keywordSearchHint);
    if (
      !hint ||
      request.mode !== "keyword" ||
      request.query.toLowerCase().includes(hint.toLowerCase())
    ) {
      return request;
    }

    return {
      ...request,
      query: `${request.query} ${hint}`
    };
  }
}

function matchesPattern(value: string, pattern: RegExp | undefined): boolean {
  return Boolean(pattern && value && pattern.test(value));
}

function matchesAnyJournal(name: string | undefined, patterns: RegExp[] | undefined): boolean {
  return Boolean(patterns?.length && matchJournalName(name, patterns));
}

function clampLimit(value: number): number {
  return Math.max(10, Math.min(value, 80));
}
