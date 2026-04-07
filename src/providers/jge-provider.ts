import { ProviderContext } from "./base.js";
import {
  MetadataLibraryProvider,
  type MetadataLibraryProviderOptions
} from "./library-metadata-provider.js";
import {
  ArticleRecord,
  DownloadCandidate,
  ProviderSearchResult,
  SearchRequest
} from "../types.js";
import {
  OpenAlexResponse,
  OpenAlexWork,
  mapOpenAlexItemToRecord,
  mergeMetadataRecords
} from "./open-metadata.js";
import { normalizeWhitespace, uniqueList } from "../utils/text.js";

const BASE_OPTIONS: MetadataLibraryProviderOptions = {
  id: "jge",
  displayName: "Journal of Geophysics and Engineering",
  cacheNamespace: "search/jge-base",
  cacheVersion: 1,
  doiPrefixes: ["10.1093/jge/", "10.1088/1742-2132/", "10.1088/1742-2140/"],
  journalPatterns: [
    /^journal of geophysics and engineering$/i,
    /^j(?:ournal)?\.?\s*of\s*geophysics\s*and\s*engineering$/i
  ],
  urlPattern:
    /(academic\.oup\.com\/jge|iopscience\.iop\.org\/journal\/1742-2132|iopscience\.iop\.org\/journal\/1742-2140|iopscience\.iop\.org\/1742-2132|iopscience\.iop\.org\/1742-2140)/i,
  openAlexFilter: "primary_location.source.issn:1742-2140",
  keywordSearchHint: "Journal of Geophysics and Engineering",
  notes: [
    "JGE search uses public metadata from Crossref and OpenAlex.",
    "Coverage focuses on the Journal of Geophysics and Engineering across its historical IOP and current Oxford Academic records.",
    "Downloads prefer OA or repository links only."
  ]
};

const AUTHOR_RESCUE_CACHE_NAMESPACE = "search/jge";
const AUTHOR_RESCUE_CACHE_VERSION = 5;
const JOURNAL_ISSN_FILTER = "primary_location.source.issn:1742-2140";
const JOURNAL_ISSN_FALLBACK_FILTER = "primary_location.source.issn:1742-2132";
const JOURNAL_NAME = "Journal of Geophysics and Engineering";

interface OpenAlexInstitutionEntity {
  id?: string;
  display_name?: string;
}

interface OpenAlexInstitutionResponse {
  results?: OpenAlexInstitutionEntity[];
}

interface OpenAlexAuthorInstitution {
  id?: string;
  display_name?: string;
}

interface OpenAlexAuthorEntity {
  id?: string;
  display_name?: string;
  display_name_alternatives?: string[];
  relevance_score?: number;
  works_count?: number;
  last_known_institutions?: OpenAlexAuthorInstitution[];
}

interface OpenAlexAuthorResponse {
  results?: OpenAlexAuthorEntity[];
}

interface AuthorFocus {
  authorName?: string;
  institutionHint?: string;
}

export class JgeProvider extends MetadataLibraryProvider {
  constructor() {
    super(BASE_OPTIONS);
  }

  async search(
    request: SearchRequest,
    context: ProviderContext
  ): Promise<ProviderSearchResult> {
    const cacheKey = JSON.stringify({
      version: AUTHOR_RESCUE_CACHE_VERSION,
      request
    });
    const cached = await context.cache.get<ProviderSearchResult>(
      AUTHOR_RESCUE_CACHE_NAMESPACE,
      cacheKey
    );
    if (cached) {
      return cached;
    }

    const baseResult = await super.search(request, context);
    const rescuedItems = await this.searchByAuthorRescue(request, context);
    const mergedItems = rescuedItems.length
      ? mergeMetadataRecords([...rescuedItems, ...baseResult.items]).slice(
          0,
          request.maxResults
        )
      : baseResult.items;

    const result: ProviderSearchResult = {
      source: this.id,
      total: mergedItems.length,
      items: mergedItems,
      notes: rescuedItems.length
        ? uniqueList([
            ...(baseResult.notes ?? []),
            "JGE author-focused rescue used OpenAlex author matching inside the journal."
          ])
        : baseResult.notes
    };

    await context.cache.set(
      AUTHOR_RESCUE_CACHE_NAMESPACE,
      cacheKey,
      result,
      context.config.searchCacheTtlMs
    );
    return result;
  }

  async getRecord(locator: string, context: ProviderContext): Promise<ArticleRecord | null> {
    return super.getRecord(locator, context);
  }

  async resolveDownload(
    record: ArticleRecord,
    context: ProviderContext
  ): Promise<DownloadCandidate[]> {
    return super.resolveDownload(record, context);
  }

  private async searchByAuthorRescue(
    request: SearchRequest,
    context: ProviderContext
  ): Promise<ArticleRecord[]> {
    if (!shouldAttemptAuthorRescue(request)) {
      return [];
    }

    const focus = extractAuthorFocus(request.query, request.mode);
    if (!focus.authorName) {
      return [];
    }

    const institutionIds = focus.institutionHint
      ? await this.lookupInstitutionIds(focus.institutionHint, context)
      : [];
    const authors = await this.lookupAuthorCandidates(focus.authorName, context);
    const candidates = authors
      .map((author) => ({
        author,
        score: scoreAuthorCandidate(author, focus.authorName!, institutionIds)
      }))
      .filter((candidate) => candidate.score >= 80)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3);

    if (!candidates.length) {
      return [];
    }

    const records = await Promise.all(
      candidates.map((candidate) =>
        this.fetchAuthorWorks(candidate.author.id!, request, context)
      )
    );

    const institutionRecords = institutionIds.length
      ? await Promise.all(
          institutionIds.map((institutionId) =>
            this.fetchInstitutionWorks(institutionId, request, context)
          )
        )
      : [];
    const authorNameVariants = uniqueList(
      [
        focus.authorName,
        ...candidates.flatMap((candidate) => [
          candidate.author.display_name,
          ...(candidate.author.display_name_alternatives ?? [])
        ])
      ]
        .map((value) => normalizeWhitespace(value))
        .filter(Boolean) as string[]
    );

    const institutionMatchedRecords = institutionRecords
      .flat()
      .filter((record) => recordHasAuthorName(record, authorNameVariants));

    return mergeMetadataRecords([
      ...institutionMatchedRecords,
      ...records.flat()
    ]).slice(0, request.maxResults);
  }

  private async lookupInstitutionIds(
    institutionHint: string,
    context: ProviderContext
  ): Promise<string[]> {
    const url = `https://api.openalex.org/institutions?search=${encodeURIComponent(institutionHint)}&per-page=5${context.config.openAlexMailto ? `&mailto=${encodeURIComponent(context.config.openAlexMailto)}` : ""}`;
    const response = await context.http.getJson<OpenAlexInstitutionResponse>(url);
    return uniqueList(
      (response.results ?? [])
        .map((result) => normalizeWhitespace(result.id))
        .filter(Boolean) as string[]
    );
  }

  private async lookupAuthorCandidates(
    authorName: string,
    context: ProviderContext
  ): Promise<OpenAlexAuthorEntity[]> {
    const url = `https://api.openalex.org/authors?search=${encodeURIComponent(authorName)}&per-page=10${context.config.openAlexMailto ? `&mailto=${encodeURIComponent(context.config.openAlexMailto)}` : ""}`;
    const response = await context.http.getJson<OpenAlexAuthorResponse>(url);
    return response.results ?? [];
  }

  private async fetchAuthorWorks(
    authorId: string,
    request: SearchRequest,
    context: ProviderContext
  ): Promise<ArticleRecord[]> {
    const works = await Promise.all([
      this.fetchAuthorWorksByIssn(authorId, JOURNAL_ISSN_FILTER, request, context),
      this.fetchAuthorWorksByIssn(authorId, JOURNAL_ISSN_FALLBACK_FILTER, request, context)
    ]);

    return mergeMetadataRecords(works.flat());
  }

  private async fetchInstitutionWorks(
    institutionId: string,
    request: SearchRequest,
    context: ProviderContext
  ): Promise<ArticleRecord[]> {
    const works = await Promise.all([
      this.fetchInstitutionWorksByIssn(
        institutionId,
        JOURNAL_ISSN_FILTER,
        request,
        context
      ),
      this.fetchInstitutionWorksByIssn(
        institutionId,
        JOURNAL_ISSN_FALLBACK_FILTER,
        request,
        context
      )
    ]);

    return mergeMetadataRecords(works.flat());
  }

  private async fetchAuthorWorksByIssn(
    authorId: string,
    issnFilter: string,
    request: SearchRequest,
    context: ProviderContext
  ): Promise<ArticleRecord[]> {
    const filterParts = [issnFilter, `authorships.author.id:${authorId}`];
    if (request.filters?.yearFrom) {
      filterParts.push(`from_publication_date:${request.filters.yearFrom}-01-01`);
    }
    if (request.filters?.yearTo) {
      filterParts.push(`to_publication_date:${request.filters.yearTo}-12-31`);
    }

    const params = new URLSearchParams();
    params.set("filter", filterParts.join(","));
    params.set("per-page", String(Math.max(request.maxResults * 2, 10)));
    if (context.config.openAlexMailto) {
      params.set("mailto", context.config.openAlexMailto);
    }

    const response = await context.http.getJson<OpenAlexResponse>(
      `https://api.openalex.org/works?${params.toString()}`
    );

    return (response.results ?? [])
      .filter((item) => matchJgeOpenAlexWork(item, authorId))
      .map((item) => mapOpenAlexItemToRecord("jge", item, JOURNAL_NAME));
  }

  private async fetchInstitutionWorksByIssn(
    institutionId: string,
    issnFilter: string,
    request: SearchRequest,
    context: ProviderContext
  ): Promise<ArticleRecord[]> {
    const filterParts = [issnFilter, `authorships.institutions.id:${institutionId}`];
    if (request.filters?.yearFrom) {
      filterParts.push(`from_publication_date:${request.filters.yearFrom}-01-01`);
    }
    if (request.filters?.yearTo) {
      filterParts.push(`to_publication_date:${request.filters.yearTo}-12-31`);
    }

    const params = new URLSearchParams();
    params.set("filter", filterParts.join(","));
    params.set("per-page", String(Math.max(request.maxResults * 20, 100)));
    if (context.config.openAlexMailto) {
      params.set("mailto", context.config.openAlexMailto);
    }

    const response = await context.http.getJson<OpenAlexResponse>(
      `https://api.openalex.org/works?${params.toString()}`
    );

    return (response.results ?? [])
      .filter((item) => matchJgeInstitutionWork(item, institutionId))
      .map((item) => mapOpenAlexItemToRecord("jge", item, JOURNAL_NAME));
  }
}

function shouldAttemptAuthorRescue(request: SearchRequest): boolean {
  if (request.mode === "author") {
    return true;
  }

  if (request.mode !== "keyword") {
    return false;
  }

  const query = normalizeWhitespace(request.query);
  if (!query || query.length > 120) {
    return false;
  }

  return (
    /中国石油大学|大学|学院|系|老师|教授|研究员|博士/i.test(query) ||
    /\bChina University of Petroleum\b/i.test(query) ||
    /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/.test(query)
  );
}

function extractAuthorFocus(query: string, mode: SearchRequest["mode"]): AuthorFocus {
  const normalized = normalizeWhitespace(query);
  const institutionHint =
    normalized.match(
      /中国石油大学(?:（北京）|（华东）|\(北京\)|\(华东\)|北京|华东)?|China University of Petroleum(?:,?\s*(?:East China|Beijing))?/i
    )?.[0] ?? undefined;

  if (mode === "author") {
    return {
      authorName: normalized,
      institutionHint
    };
  }

  if (/[\u4e00-\u9fff]/.test(normalized)) {
    const stripped = normalizeWhitespace(
      normalized
        .replace(
          /中国石油大学(?:（北京）|（华东）|\(北京\)|\(华东\)|北京|华东)?/g,
          " "
        )
        .replace(/测井|声波测井|电成像测井|地球物理|物探|文献|论文|期刊|老师|教授|研究员|博士|学院|系/g, " ")
    );
    const authorName = stripped.match(/[\u4e00-\u9fff]{2,4}/)?.[0];
    return {
      authorName,
      institutionHint
    };
  }

  const englishName =
    normalized.match(/\b([A-Z][a-z]+(?:[-'][A-Za-z]+)?\s+[A-Z][a-z]+(?:[-'][A-Za-z]+)?)\b/)?.[1] ??
    undefined;

  return {
    authorName: englishName,
    institutionHint
  };
}

function scoreAuthorCandidate(
  author: OpenAlexAuthorEntity,
  expectedName: string,
  institutionIds: string[]
): number {
  const expected = normalizePersonName(expectedName);
  const names = [
    author.display_name,
    ...(author.display_name_alternatives ?? [])
  ]
    .map((value) => normalizePersonName(value))
    .filter(Boolean);

  let score = 0;
  if (names.includes(expected)) {
    score += 120;
  } else if (names.some((name) => name.includes(expected) || expected.includes(name))) {
    score += 80;
  }

  if (institutionIds.length) {
    const matchedInstitution = (author.last_known_institutions ?? []).some((institution) =>
      institution.id ? institutionIds.includes(institution.id) : false
    );
    if (matchedInstitution) {
      score += 120;
    }
  }

  score += Math.min(author.relevance_score ?? 0, 40);
  score += Math.min((author.works_count ?? 0) / 50, 10);
  return score;
}

function normalizePersonName(value: string | undefined): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchJgeOpenAlexWork(item: OpenAlexWork, authorId: string): boolean {
  const sourceName = normalizeWhitespace(item.primary_location?.source?.display_name);
  const issn = item.primary_location?.source?.issn ?? [];
  const authorIds = (item.authorships ?? [])
    .map((authorship) =>
      normalizeWhitespace((authorship.author as { id?: string } | undefined)?.id)
    )
    .filter(Boolean);

  return Boolean(
    authorIds.includes(authorId) &&
      (sourceName === JOURNAL_NAME ||
        issn.includes("1742-2140") ||
        issn.includes("1742-2132"))
  );
}

function matchJgeInstitutionWork(item: OpenAlexWork, institutionId: string): boolean {
  const sourceName = normalizeWhitespace(item.primary_location?.source?.display_name);
  const issn = item.primary_location?.source?.issn ?? [];
  const institutionIds = (item.authorships ?? [])
    .flatMap((authorship) =>
      (authorship.institutions ?? [])
        .map((institution) =>
          normalizeWhitespace((institution as { id?: string } | undefined)?.id)
        )
        .filter(Boolean)
    );

  return Boolean(
    institutionIds.includes(institutionId) &&
      (sourceName === JOURNAL_NAME ||
        issn.includes("1742-2140") ||
        issn.includes("1742-2132"))
  );
}

function recordHasAuthorName(record: ArticleRecord, authorNameVariants: string[]): boolean {
  const normalizedAuthors = uniqueList(
    record.authors.map((author) => normalizePersonName(author))
  );
  const normalizedVariants = uniqueList(
    authorNameVariants.map((author) => normalizePersonName(author)).filter(Boolean)
  );

  return normalizedVariants.some((variant) =>
    normalizedAuthors.some(
      (author) => author === variant || author.includes(variant) || variant.includes(author)
    )
  );
}
