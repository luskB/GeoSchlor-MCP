import { ArticleRecord, SearchRequest, SourceId } from "../types.js";
import {
  normalizeDoi,
  normalizeWhitespace,
  stripHtmlTags,
  uniqueList
} from "../utils/text.js";
import { mergeArticleRecordList, mergeArticleRecords } from "../utils/article-records.js";

export interface CrossrefAffiliation {
  name?: string;
}

export interface CrossrefAuthor {
  given?: string;
  family?: string;
  name?: string;
  affiliation?: CrossrefAffiliation[];
}

export interface CrossrefLink {
  URL: string;
  "content-type"?: string;
}

export interface CrossrefDate {
  "date-parts"?: number[][];
}

export interface CrossrefResource {
  primary?: {
    URL?: string;
  };
}

export interface CrossrefItem {
  DOI?: string;
  title?: string[];
  author?: CrossrefAuthor[];
  "container-title"?: string[];
  abstract?: string;
  link?: CrossrefLink[];
  URL?: string;
  volume?: string;
  issue?: string;
  page?: string;
  issued?: CrossrefDate;
  "published-print"?: CrossrefDate;
  "published-online"?: CrossrefDate;
  publisher?: string;
  type?: string;
  ISSN?: string[];
  resource?: CrossrefResource;
  "is-referenced-by-count"?: number;
  "references-count"?: number;
  "reference-count"?: number;
}

export interface CrossrefSingleResponse {
  message: CrossrefItem;
}

export interface CrossrefListResponse {
  message: {
    items: CrossrefItem[];
  };
}

export interface OpenAlexSource {
  display_name?: string;
  issn?: string[];
  issn_l?: string;
  host_organization_name?: string;
}

export interface OpenAlexInstitution {
  display_name?: string;
}

export interface OpenAlexAuthor {
  display_name?: string;
}

export interface OpenAlexAffiliation {
  raw_affiliation_string?: string;
  institution_ids?: string[];
}

export interface OpenAlexAuthorship {
  author?: OpenAlexAuthor;
  institutions?: OpenAlexInstitution[];
  raw_affiliation_strings?: string[];
  affiliations?: OpenAlexAffiliation[];
}

export interface OpenAlexLocation {
  landing_page_url?: string | null;
  pdf_url?: string | null;
  source?: OpenAlexSource | null;
}

export interface OpenAlexOpenAccess {
  is_oa?: boolean;
  oa_status?: string;
  oa_url?: string | null;
  any_repository_has_fulltext?: boolean;
}

export interface OpenAlexBiblio {
  volume?: string | null;
  issue?: string | null;
  first_page?: string | null;
  last_page?: string | null;
}

export interface OpenAlexKeyword {
  display_name?: string;
}

export interface OpenAlexTopic {
  display_name?: string;
}

export interface OpenAlexWork {
  id?: string;
  doi?: string | null;
  title?: string;
  display_name?: string;
  publication_year?: number;
  publication_date?: string;
  language?: string;
  type?: string;
  authorships?: OpenAlexAuthorship[];
  primary_location?: OpenAlexLocation | null;
  locations?: OpenAlexLocation[];
  open_access?: OpenAlexOpenAccess | null;
  biblio?: OpenAlexBiblio | null;
  abstract_inverted_index?: Record<string, number[]>;
  cited_by_count?: number;
  referenced_works_count?: number;
  keywords?: OpenAlexKeyword[];
  topics?: OpenAlexTopic[];
}

export interface OpenAlexResponse {
  results: OpenAlexWork[];
}

export interface UnpaywallLocation {
  url?: string | null;
  url_for_pdf?: string | null;
  host_type?: string | null;
  version?: string | null;
}

export interface UnpaywallResponse {
  doi?: string;
  is_oa?: boolean;
  oa_status?: string;
  best_oa_location?: UnpaywallLocation | null;
}

export interface CrossrefSearchOptions {
  journalIssn?: string;
  rows: number;
  extraFilters?: string[];
}

export interface OpenAlexSearchOptions {
  filter?: string;
  limit: number;
  mailto?: string;
  skipJournalSearchName?: string;
}

export function buildCrossrefSearchUrl(
  request: SearchRequest,
  options: CrossrefSearchOptions
): string {
  const params = new URLSearchParams();
  params.set("rows", String(options.rows));
  params.set(
    "select",
    [
      "DOI",
      "title",
      "author",
      "container-title",
      "URL",
      "link",
      "issued",
      "published-print",
      "published-online",
      "volume",
      "issue",
      "page",
      "abstract",
      "publisher",
      "type",
      "ISSN",
      "resource",
      "is-referenced-by-count",
      "references-count"
    ].join(",")
  );

  const filters: string[] = [...(options.extraFilters ?? [])];
  if (request.filters?.yearFrom) {
    filters.push(`from-pub-date:${request.filters.yearFrom}-01-01`);
  }
  if (request.filters?.yearTo) {
    filters.push(`until-pub-date:${request.filters.yearTo}-12-31`);
  }
  if (filters.length) {
    params.set("filter", filters.join(","));
  }

  if (request.mode === "title") {
    params.set("query.title", request.query);
  } else if (request.mode === "author") {
    params.set("query.author", request.query);
  } else if (request.mode === "journal") {
    params.set("query.container-title", request.query);
  } else {
    params.set("query.bibliographic", request.query);
  }

  params.set(
    "sort",
    request.filters?.sortBy === "published" ? "published" : "relevance"
  );
  params.set("order", "desc");

  const basePath = options.journalIssn
    ? `https://api.crossref.org/journals/${encodeURIComponent(options.journalIssn)}/works`
    : "https://api.crossref.org/works";

  return `${basePath}?${params.toString()}`;
}

export function buildOpenAlexSearchUrl(
  request: SearchRequest,
  options: OpenAlexSearchOptions
): string {
  const params = new URLSearchParams();
  const filters: string[] = [];
  if (options.filter) {
    filters.push(options.filter);
  }
  if (request.filters?.yearFrom) {
    filters.push(`from_publication_date:${request.filters.yearFrom}-01-01`);
  }
  if (request.filters?.yearTo) {
    filters.push(`to_publication_date:${request.filters.yearTo}-12-31`);
  }
  if (filters.length) {
    params.set("filter", filters.join(","));
  }
  params.set("per-page", String(options.limit));

  const skipSearch =
    request.mode === "journal" &&
    options.skipJournalSearchName &&
    request.query.toUpperCase() === options.skipJournalSearchName.toUpperCase();

  if (!skipSearch) {
    params.set("search", request.query);
  }

  if (options.mailto) {
    params.set("mailto", options.mailto);
  }

  return `https://api.openalex.org/works?${params.toString()}`;
}

export function mapCrossrefItemToRecord(
  source: SourceId,
  item: CrossrefItem,
  defaultJournal?: string
): ArticleRecord {
  const doi = normalizeDoi(item.DOI);
  const title = normalizeWhitespace(item.title?.[0] ?? doi ?? "Untitled");
  const authors = uniqueList(
    (item.author ?? []).map((author) =>
      normalizeWhitespace(author.name ?? [author.given, author.family].filter(Boolean).join(" "))
    )
  );
  const publisherPdfUrl = item.link?.find((link) =>
    /application\/pdf/i.test(link["content-type"] ?? "")
  )?.URL;
  const detailUrl =
    normalizeWhitespace(item.resource?.primary?.URL) ||
    normalizeWhitespace(item.URL) ||
    (doi ? `https://doi.org/${doi}` : undefined);

  return {
    id: doi ?? title,
    source,
    title,
    authors,
    journal: normalizeWhitespace(item["container-title"]?.[0] ?? defaultJournal),
    year: pickYear(item),
    volume: normalizeWhitespace(item.volume),
    issue: normalizeWhitespace(item.issue),
    pages: normalizeWhitespace(item.page),
    doi,
    abstract: stripHtmlTags(item.abstract),
    institutions: extractCrossrefInstitutions(item.author),
    publisher: normalizeWhitespace(item.publisher),
    publicationDate: pickPublicationDate(item),
    citationCount: item["is-referenced-by-count"],
    referenceCount: item["references-count"] ?? item["reference-count"],
    sourceType: normalizeWhitespace(item.type),
    issn: uniqueList(item.ISSN ?? []),
    detailUrl,
    pdfUrl: publisherPdfUrl,
    access: publisherPdfUrl ? "subscription" : "unknown",
    raw: {
      crossref: item,
      publisherPdfUrl
    }
  };
}

export function mapOpenAlexItemToRecord(
  source: SourceId,
  item: OpenAlexWork,
  defaultJournal?: string
): ArticleRecord {
  const doi = normalizeDoi(item.doi);
  const title = normalizeWhitespace(item.display_name ?? item.title ?? doi ?? "Untitled");
  const authors = uniqueList(
    (item.authorships ?? []).map((authorship) =>
      normalizeWhitespace(authorship.author?.display_name)
    )
  );
  const detailUrl =
    normalizeWhitespace(
      item.primary_location?.landing_page_url ??
        (doi ? `https://doi.org/${doi}` : "")
    ) || undefined;
  const oaUrl = pickOpenAlexOaUrl(item);
  const oaPdfUrl = pickOpenAlexPdfUrl(item);

  return {
    id: doi ?? normalizeWhitespace(item.id ?? title),
    source,
    title,
    authors,
    journal: normalizeWhitespace(
      item.primary_location?.source?.display_name ?? defaultJournal
    ),
    year: item.publication_year,
    volume: normalizeWhitespace(item.biblio?.volume),
    issue: normalizeWhitespace(item.biblio?.issue),
    pages: joinPages(item.biblio?.first_page, item.biblio?.last_page),
    doi,
    abstract: reconstructAbstract(item.abstract_inverted_index),
    keywords: uniqueList((item.keywords ?? []).map((keyword) => keyword.display_name ?? "")),
    institutions: extractOpenAlexInstitutions(item),
    language: normalizeWhitespace(item.language),
    publisher: normalizeWhitespace(item.primary_location?.source?.host_organization_name),
    publicationDate: normalizeWhitespace(item.publication_date),
    citationCount: item.cited_by_count,
    referenceCount: item.referenced_works_count,
    sourceType: normalizeWhitespace(item.type),
    issn: uniqueList([
      ...(item.primary_location?.source?.issn ?? []),
      item.primary_location?.source?.issn_l ?? ""
    ]),
    subjects: uniqueList((item.topics ?? []).map((topic) => topic.display_name ?? "")),
    detailUrl,
    pdfUrl: oaPdfUrl || undefined,
    oaUrl: oaUrl || undefined,
    oaStatus: normalizeWhitespace(item.open_access?.oa_status),
    access: item.open_access?.is_oa ? "open" : "subscription",
    raw: {
      openalex: item,
      oaPdfUrl: oaPdfUrl || undefined
    }
  };
}

export function mergeMetadataRecords(records: ArticleRecord[]): ArticleRecord[] {
  return mergeArticleRecordList(records);
}

export function applyUnpaywall(record: ArticleRecord, unpaywall: UnpaywallResponse) {
  const oaUrl = normalizeWhitespace(
    unpaywall.best_oa_location?.url_for_pdf ?? unpaywall.best_oa_location?.url
  );

  if (!unpaywall.is_oa || !oaUrl) {
    return mergeArticleRecords(record, {
      ...record,
      oaStatus: record.oaStatus ?? normalizeWhitespace(unpaywall.oa_status),
      raw: {
        ...(record.raw ?? {}),
        unpaywall
      }
    });
  }

  return mergeArticleRecords(record, {
    ...record,
    oaUrl,
    oaStatus: normalizeWhitespace(unpaywall.oa_status),
    pdfUrl: normalizeWhitespace(unpaywall.best_oa_location?.url_for_pdf) || record.pdfUrl,
    access: "open",
    raw: {
      ...(record.raw ?? {}),
      unpaywall,
      oaPdfUrl: normalizeWhitespace(unpaywall.best_oa_location?.url_for_pdf) || undefined
    }
  });
}

export function normalizeOpenAccessFormat(url: string): "pdf" | "html" | "unknown" {
  const lower = normalizeWhitespace(url).toLowerCase();
  if (!lower) {
    return "unknown";
  }
  if (lower.includes(".pdf") || lower.includes("/pdf") || lower.includes("download")) {
    return "pdf";
  }
  return "html";
}

export function matchJournalName(
  name: string | undefined,
  patterns: RegExp[]
): boolean {
  const normalized = normalizeWhitespace(name);
  return Boolean(normalized && patterns.some((pattern) => pattern.test(normalized)));
}

export function matchIssn(issnValues: string[] | undefined, expectedIssn: string): boolean {
  const normalizedIssn = normalizeWhitespace(expectedIssn);
  return (issnValues ?? []).some((issn) => normalizeWhitespace(issn) === normalizedIssn);
}

export function hasDoiPrefix(doi: string | undefined, prefixes: string[]): boolean {
  const normalized = normalizeDoi(doi) ?? "";
  return prefixes.some((prefix) => normalized.startsWith(prefix.toLowerCase()));
}

export function joinPages(
  firstPage: string | null | undefined,
  lastPage: string | null | undefined
): string | undefined {
  const first = normalizeWhitespace(firstPage);
  const last = normalizeWhitespace(lastPage);
  if (first && last) {
    return `${first}-${last}`;
  }
  return first || last || undefined;
}

export function reconstructAbstract(
  invertedIndex: Record<string, number[]> | undefined
): string | undefined {
  if (!invertedIndex) {
    return undefined;
  }

  const tokens: string[] = [];
  for (const [term, positions] of Object.entries(invertedIndex)) {
    for (const position of positions) {
      tokens[position] = term;
    }
  }

  return normalizeWhitespace(tokens.join(" "));
}

function pickYear(item: CrossrefItem): number | undefined {
  return (
    item["published-print"]?.["date-parts"]?.[0]?.[0] ??
    item["published-online"]?.["date-parts"]?.[0]?.[0] ??
    item.issued?.["date-parts"]?.[0]?.[0]
  );
}

function pickPublicationDate(item: CrossrefItem): string | undefined {
  const parts =
    item["published-print"]?.["date-parts"]?.[0] ??
    item["published-online"]?.["date-parts"]?.[0] ??
    item.issued?.["date-parts"]?.[0];

  if (!parts?.length || parts.some((part) => typeof part !== "number")) {
    return undefined;
  }

  const [year, month = 1, day = 1] = parts;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function extractCrossrefInstitutions(
  authors: CrossrefAuthor[] | undefined
): string[] | undefined {
  const institutions = uniqueList(
    (authors ?? []).flatMap((author) =>
      (author.affiliation ?? []).map((affiliation) => normalizeWhitespace(affiliation.name))
    )
  );

  return institutions.length ? institutions : undefined;
}

function extractOpenAlexInstitutions(item: OpenAlexWork): string[] | undefined {
  const institutions = uniqueList(
    (item.authorships ?? []).flatMap((authorship) => [
      ...(authorship.institutions ?? []).map((institution) =>
        normalizeWhitespace(institution.display_name)
      ),
      ...(authorship.raw_affiliation_strings ?? []).map((affiliation) =>
        normalizeWhitespace(affiliation)
      )
    ])
  );

  return institutions.length ? institutions : undefined;
}

function pickOpenAlexOaUrl(item: OpenAlexWork): string {
  if (!item.open_access?.is_oa) {
    return "";
  }

  return normalizeWhitespace(
    item.open_access.oa_url ??
      item.primary_location?.pdf_url ??
      item.primary_location?.landing_page_url
  );
}

function pickOpenAlexPdfUrl(item: OpenAlexWork): string {
  if (!item.open_access?.is_oa) {
    return "";
  }

  const candidates = [
    item.primary_location?.pdf_url,
    ...(item.locations ?? []).map((location) => location.pdf_url)
  ];

  return normalizeWhitespace(candidates.find(Boolean) ?? "");
}
