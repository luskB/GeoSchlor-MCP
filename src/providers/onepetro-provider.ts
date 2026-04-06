import { ProviderContext, SearchProvider } from "./base.js";
import {
  ArticleRecord,
  DownloadCandidate,
  ProviderSearchResult,
  SearchRequest
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
  mergeMetadataRecords,
  normalizeOpenAccessFormat,
  OpenAlexResponse,
  OpenAlexWork,
  UnpaywallResponse
} from "./open-metadata.js";

const ONEPETRO_DOI_PREFIXES = ["10.2118/", "10.4043/", "10.15530/"];
const ONEPETRO_PUBLISHER_PATTERN =
  /(society of petroleum engineers|onepetro|spwla|offshore technology conference|spe)/i;

export class OnePetroProvider implements SearchProvider {
  readonly id = "onepetro" as const;

  async search(
    request: SearchRequest,
    context: ProviderContext
  ): Promise<ProviderSearchResult> {
    const cacheKey = JSON.stringify({ version: 3, request });
    const cached = await context.cache.get<ProviderSearchResult>(
      "search/onepetro",
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
        "OnePetro search follows a metadata-first strategy because the official platform is commonly protected by Cloudflare and subscription checks.",
        "Results are built from Crossref and OpenAlex and emphasize SPE / SPWLA / OTC DOI families commonly surfaced through OnePetro.",
        "Downloads prefer OA or repository links only."
      ]
    };

    await context.cache.set(
      "search/onepetro",
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
    if (!item || !isOnePetroCrossrefItem(item)) {
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

    return candidates;
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
    const limit = clampLimit(request.maxResults * 4);
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
      throw new Error("OnePetro metadata sources are temporarily unavailable.");
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
      buildCrossrefSearchUrl(request, {
        rows: request.maxResults
      })
    );

    return (response.message.items ?? []).filter(isOnePetroCrossrefItem).map(mapCrossrefItem);
  }

  private async searchOpenAlex(
    request: SearchRequest,
    context: ProviderContext,
    limit: number
  ): Promise<ArticleRecord[]> {
    const response = await context.http.getJson<OpenAlexResponse>(
      buildOpenAlexSearchUrl(request, {
        limit,
        mailto: context.config.openAlexMailto
      })
    );

    return (response.results ?? []).filter(isOnePetroOpenAlexItem).map(mapOpenAlexItem);
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
      return isOnePetroOpenAlexItem(item) ? mapOpenAlexItem(item) : null;
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

export function mapCrossrefItem(item: CrossrefItem): ArticleRecord {
  return mapCrossrefItemToRecord("onepetro", item);
}

export function mapOpenAlexItem(item: OpenAlexWork): ArticleRecord {
  return mapOpenAlexItemToRecord("onepetro", item);
}

function isOnePetroCrossrefItem(item: CrossrefItem): boolean {
  const primaryUrl =
    normalizeWhitespace(item.resource?.primary?.URL) || normalizeWhitespace(item.URL);
  return Boolean(
    hasDoiPrefix(item.DOI, ONEPETRO_DOI_PREFIXES) ||
      ONEPETRO_PUBLISHER_PATTERN.test(normalizeWhitespace(item.publisher)) ||
      /onepetro\.org/i.test(primaryUrl)
  );
}

function isOnePetroOpenAlexItem(item: OpenAlexWork): boolean {
  const landingPage =
    normalizeWhitespace(item.primary_location?.landing_page_url) ||
    normalizeWhitespace(item.primary_location?.pdf_url);
  const hostOrganization = normalizeWhitespace(
    item.primary_location?.source?.host_organization_name
  );

  return Boolean(
    hasDoiPrefix(item.doi ?? undefined, ONEPETRO_DOI_PREFIXES) ||
      /onepetro\.org/i.test(landingPage) ||
      ONEPETRO_PUBLISHER_PATTERN.test(hostOrganization)
  );
}

function clampLimit(value: number): number {
  return Math.max(10, Math.min(value, 60));
}
