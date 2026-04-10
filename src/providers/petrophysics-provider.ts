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
  buildCrossrefSearchUrl as buildGenericCrossrefSearchUrl,
  buildOpenAlexSearchUrl as buildGenericOpenAlexSearchUrl,
  CrossrefItem,
  CrossrefListResponse,
  CrossrefSingleResponse,
  mapCrossrefItemToRecord,
  mapOpenAlexItemToRecord,
  matchIssn,
  matchJournalName,
  mergeMetadataRecords,
  normalizeOpenAccessFormat,
  OpenAlexResponse,
  OpenAlexWork,
  UnpaywallResponse
} from "./open-metadata.js";
import { searchCrossrefAuthorAffiliationCandidates } from "./author-affiliation-rescue.js";

const PETROPHYSICS_PATTERNS = [/^petrophysics\b/i];

export class PetrophysicsProvider implements SearchProvider {
  readonly id = "petrophysics" as const;

  async search(
    request: SearchRequest,
    context: ProviderContext
  ): Promise<ProviderSearchResult> {
    const cacheKey = JSON.stringify({ version: 4, request });
    const cached = await context.cache.get<ProviderSearchResult>(
      "search/petrophysics",
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
        "Petrophysics search uses public metadata from Crossref and OpenAlex, centered on the SPWLA journal.",
        "Search does not require an SPWLA login.",
        "Downloads prefer OA or repository links when available."
      ]
    };

    await context.cache.set(
      "search/petrophysics",
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
    if (!item || !isPetrophysicsItem(item, context.config.petrophysicsIssn)) {
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
      throw new Error("Petrophysics metadata sources are temporarily unavailable.");
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
      .filter((item) => isPetrophysicsItem(item, context.config.petrophysicsIssn))
      .map(mapCrossrefItem);
  }

  private async searchCrossref(
    request: SearchRequest,
    context: ProviderContext
  ): Promise<ArticleRecord[]> {
    const response = await context.http.getJson<CrossrefListResponse>(
      buildCrossrefSearchUrl(request, context.config.petrophysicsIssn)
    );

    return (response.message.items ?? [])
      .filter((item) => isPetrophysicsItem(item, context.config.petrophysicsIssn))
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
        context.config.petrophysicsIssn,
        limit,
        context.config.openAlexMailto
      )
    );

    return (response.results ?? [])
      .filter((item) => isPetrophysicsOpenAlexItem(item, context.config.petrophysicsIssn))
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
      return isPetrophysicsOpenAlexItem(item, context.config.petrophysicsIssn)
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
    skipJournalSearchName: "PETROPHYSICS"
  });
}

export function mapCrossrefItem(item: CrossrefItem): ArticleRecord {
  return mapCrossrefItemToRecord(
    "petrophysics",
    item,
    "Petrophysics - The SPWLA Journal of Formation Evaluation and Reservoir Description"
  );
}

export function mapOpenAlexItem(item: OpenAlexWork): ArticleRecord {
  return mapOpenAlexItemToRecord(
    "petrophysics",
    item,
    "Petrophysics - The SPWLA Journal of Formation Evaluation and Reservoir Description"
  );
}

function isPetrophysicsItem(item: CrossrefItem, issn: string): boolean {
  return (
    matchJournalName(item["container-title"]?.[0], PETROPHYSICS_PATTERNS) ||
    matchIssn(item.ISSN, issn) ||
    /spwla/i.test(normalizeWhitespace(item.publisher))
  );
}

function isPetrophysicsOpenAlexItem(item: OpenAlexWork, issn: string): boolean {
  return (
    matchJournalName(item.primary_location?.source?.display_name, PETROPHYSICS_PATTERNS) ||
    matchIssn(item.primary_location?.source?.issn, issn) ||
    normalizeWhitespace(item.primary_location?.source?.issn_l) === normalizeWhitespace(issn)
  );
}

function clampLimit(value: number): number {
  return Math.max(10, Math.min(value, 50));
}
