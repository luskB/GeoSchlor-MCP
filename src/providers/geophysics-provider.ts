import { ProviderContext, SearchProvider } from "./base.js";
import {
  ArticleRecord,
  DownloadCandidate,
  ProviderSearchResult,
  SearchRequest
} from "../types.js";
import { normalizeDoi, normalizeWhitespace } from "../utils/text.js";
import { mergeMetadataRecords, applyUnpaywall, buildCrossrefSearchUrl as buildGenericCrossrefSearchUrl, buildOpenAlexSearchUrl as buildGenericOpenAlexSearchUrl, CrossrefItem, CrossrefListResponse, CrossrefSingleResponse, OpenAlexResponse, OpenAlexWork, UnpaywallResponse, mapCrossrefItemToRecord, mapOpenAlexItemToRecord, matchIssn, matchJournalName, normalizeOpenAccessFormat } from "./open-metadata.js";

const GEOPHYSICS_PATTERNS = [/^geophysics$/i];

export class GeophysicsProvider implements SearchProvider {
  readonly id = "geophysics" as const;

  async search(
    request: SearchRequest,
    context: ProviderContext
  ): Promise<ProviderSearchResult> {
    const cacheKey = JSON.stringify({ version: 3, request });
    const cached = await context.cache.get<ProviderSearchResult>(
      "search/geophysics",
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
      notes: [
        "GEOPHYSICS search uses Crossref public metadata as the main backbone and OpenAlex as the enrichment layer.",
        "Search does not require a GeoScienceWorld login.",
        "Downloads prefer open-access or repository copies. Publisher-only PDFs are only exposed as an optional fallback when a local browser session already exists."
      ]
    };

    await context.cache.set(
      "search/geophysics",
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
    if (!item || !isGeophysicsItem(item, context.config.geophysicsIssn)) {
      return null;
    }

    return this.enrichRecord(mapCrossrefItem(item), context);
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

    if (context.browser.hasState("geophysics") && workingRecord.pdfUrl) {
      candidates.push({
        id: `${workingRecord.id}:publisher-pdf`,
        source: this.id,
        label: "Publisher PDF (optional fallback)",
        url: workingRecord.pdfUrl,
        method: "browser",
        format: "pdf",
        requiresAuth: false,
        referer: workingRecord.detailUrl
      });
    }

    const deduped = new Map<string, DownloadCandidate>();
    for (const candidate of candidates) {
      if (!deduped.has(candidate.url)) {
        deduped.set(candidate.url, candidate);
      }
    }
    return [...deduped.values()];
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
    const limit = clampLimit(request.maxResults * 3);
    const [crossrefResult, openAlexResult] = await Promise.allSettled([
      this.searchCrossref({ ...request, maxResults: limit }, context),
      this.searchOpenAlex(request, context, limit)
    ]);

    const crossrefItems =
      crossrefResult.status === "fulfilled" ? crossrefResult.value : [];
    const openAlexItems =
      openAlexResult.status === "fulfilled" ? openAlexResult.value : [];

    if (
      crossrefResult.status === "rejected" &&
      openAlexResult.status === "rejected"
    ) {
      throw new Error("GEOPHYSICS metadata sources are temporarily unavailable.");
    }

    const merged = mergeMetadataRecords([...crossrefItems, ...openAlexItems]).slice(
      0,
      request.maxResults
    );

    return Promise.all(merged.map((record) => this.enrichRecord(record, context)));
  }

  private async searchCrossref(
    request: SearchRequest,
    context: ProviderContext
  ): Promise<ArticleRecord[]> {
    const response = await context.http.getJson<CrossrefListResponse>(
      buildCrossrefSearchUrl(request, context.config.geophysicsIssn)
    );

    return (response.message.items ?? [])
      .filter((item) => isGeophysicsItem(item, context.config.geophysicsIssn))
      .map(mapCrossrefItem);
  }

  private async searchOpenAlex(
    request: SearchRequest,
    context: ProviderContext,
    limit: number
  ): Promise<ArticleRecord[]> {
    const response = await context.http.getJson<OpenAlexResponse>(
      buildOpenAlexSearchUrl(
        request,
        context.config.geophysicsIssn,
        limit,
        context.config.openAlexMailto
      )
    );

    return (response.results ?? [])
      .filter((item) => isGeophysicsOpenAlexItem(item, context.config.geophysicsIssn))
      .map(mapOpenAlexItem);
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
      const url = `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}${context.config.openAlexMailto ? `?mailto=${encodeURIComponent(context.config.openAlexMailto)}` : ""}`;
      const item = await context.http.getJson<OpenAlexWork>(url);
      return isGeophysicsOpenAlexItem(item, context.config.geophysicsIssn)
        ? mapOpenAlexItem(item)
        : null;
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
}

export function buildCrossrefSearchUrl(request: SearchRequest, issn: string): string {
  return buildGenericCrossrefSearchUrl(request, {
    journalIssn: issn,
    rows: request.maxResults
  });
}

export function buildOpenAlexSearchUrl(
  request: SearchRequest,
  issn: string,
  limit: number,
  mailto?: string
): string {
  return buildGenericOpenAlexSearchUrl(request, {
    filter: `primary_location.source.issn:${issn}`,
    limit,
    mailto,
    skipJournalSearchName: "GEOPHYSICS"
  });
}

export function mapCrossrefItem(item: CrossrefItem): ArticleRecord {
  return mapCrossrefItemToRecord("geophysics", item, "GEOPHYSICS");
}

export function mapOpenAlexItem(item: OpenAlexWork): ArticleRecord {
  return mapOpenAlexItemToRecord("geophysics", item, "GEOPHYSICS");
}

function isGeophysicsItem(item: CrossrefItem, issn: string): boolean {
  return (
    matchJournalName(item["container-title"]?.[0], GEOPHYSICS_PATTERNS) ||
    matchIssn(item.ISSN, issn)
  );
}

function isGeophysicsOpenAlexItem(item: OpenAlexWork, issn: string): boolean {
  return (
    matchJournalName(item.primary_location?.source?.display_name, GEOPHYSICS_PATTERNS) ||
    matchIssn(item.primary_location?.source?.issn, issn) ||
    normalizeWhitespace(item.primary_location?.source?.issn_l) === normalizeWhitespace(issn)
  );
}

function clampLimit(value: number): number {
  return Math.max(10, Math.min(value, 50));
}
