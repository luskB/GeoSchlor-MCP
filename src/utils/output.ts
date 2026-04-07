import { AggregatedSearchResult, ArticleRecord, ProviderSearchResult } from "../types.js";
import { normalizeWhitespace, stripHtmlTags, uniqueList } from "./text.js";

const ABSTRACT_PREVIEW_LIMIT = 320;
const NOTES_LIMIT = 2;
const NOTE_LENGTH_LIMIT = 180;
const INSTITUTIONS_LIMIT = 3;
const QUERY_VARIANTS_LIMIT = 3;

export function sanitizeForToolOutput<T>(value: T): T {
  if (isAggregatedSearchResult(value)) {
    return sanitizeAggregatedSearchResult(value) as T;
  }

  return sanitizeValue(value) as T;
}

function sanitizeAggregatedSearchResult(value: AggregatedSearchResult): unknown {
  return sanitizeValue({
    query: value.query,
    mode: value.mode,
    queryVariants: sanitizeQueryVariants(value.queryVariants),
    total: value.total,
    sources: value.sources.map((source) => sanitizeProviderSearchResult(source))
  });
}

function sanitizeProviderSearchResult(source: ProviderSearchResult): unknown {
  return {
    source: source.source,
    total: source.total,
    items: source.items.map((item) => sanitizeSearchRecord(item)),
    notes: sanitizeNotes(source.notes)
  };
}

function sanitizeSearchRecord(item: ArticleRecord): unknown {
  return sanitizeValue({
    id: item.id,
    source: item.source,
    title: cleanInlineText(item.title),
    authors: sanitizeStringList(item.authors),
    journal: cleanInlineText(item.journal),
    year: item.year,
    volume: cleanInlineText(item.volume),
    issue: cleanInlineText(item.issue),
    pages: cleanInlineText(item.pages),
    doi: cleanInlineText(item.doi),
    abstract: buildAbstractPreview(item.abstract),
    keywords: sanitizeStringList(item.keywords),
    institutions: sanitizeInstitutions(item.institutions),
    language: cleanInlineText(item.language),
    publisher: cleanInlineText(item.publisher),
    publicationDate: cleanInlineText(item.publicationDate),
    citationCount: item.citationCount,
    referenceCount: item.referenceCount,
    sourceType: cleanInlineText(item.sourceType),
    detailUrl: cleanInlineText(item.detailUrl),
    pdfUrl: cleanInlineText(item.pdfUrl),
    oaUrl: cleanInlineText(item.oaUrl),
    oaStatus: cleanInlineText(item.oaStatus),
    access: item.access
  });
}

function sanitizeNotes(notes: string[] | undefined): string[] | undefined {
  const cleaned = uniqueList(
    (notes ?? [])
      .map((note) => truncateText(cleanInlineText(note), NOTE_LENGTH_LIMIT))
      .filter(Boolean) as string[]
  ).slice(0, NOTES_LIMIT);

  return cleaned.length ? cleaned : undefined;
}

function sanitizeQueryVariants(variants: string[] | undefined): string[] | undefined {
  const cleaned = uniqueList(
    (variants ?? []).map((variant) => cleanInlineText(variant)).filter(Boolean) as string[]
  ).slice(0, QUERY_VARIANTS_LIMIT);

  return cleaned.length ? cleaned : undefined;
}

function sanitizeInstitutions(values: string[] | undefined): string[] | undefined {
  const cleaned = uniqueList(
    (values ?? [])
      .map((value) => cleanInstitution(value))
      .filter(Boolean) as string[]
  ).slice(0, INSTITUTIONS_LIMIT);

  return cleaned.length ? cleaned : undefined;
}

function sanitizeStringList(values: string[] | undefined, limit?: number): string[] | undefined {
  const cleaned = uniqueList(
    (values ?? []).map((value) => cleanInlineText(value)).filter(Boolean) as string[]
  );
  const limited = typeof limit === "number" ? cleaned.slice(0, limit) : cleaned;
  return limited.length ? limited : undefined;
}

function buildAbstractPreview(value: string | undefined): string | undefined {
  const cleaned = cleanInlineText(value)
    ?.replace(/^(abstract|摘要)[:：]?\s*/i, "")
    .trim();

  if (!cleaned) {
    return undefined;
  }

  return truncateText(cleaned, ABSTRACT_PREVIEW_LIMIT);
}

function cleanInstitution(value: string | undefined): string | undefined {
  const cleaned = cleanInlineText(value)
    ?.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, " ")
    .replace(/\(\s*corresponding author\s*\)/gi, " ")
    .replace(/\bcorresponding author\b/gi, " ");

  return normalizeWhitespace(cleaned);
}

function cleanInlineText(value: string | undefined): string | undefined {
  const cleaned = stripHtmlTags(value);
  return cleaned || undefined;
}

function truncateText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) {
    return undefined;
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function isAggregatedSearchResult(value: unknown): value is AggregatedSearchResult {
  return Boolean(
    value &&
      typeof value === "object" &&
      "query" in value &&
      "mode" in value &&
      "sources" in value &&
      Array.isArray((value as AggregatedSearchResult).sources)
  );
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeValue(item))
      .filter((item) => item !== undefined);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const entries = Object.entries(value)
    .filter(([key, nestedValue]) => key !== "raw" && !shouldOmitValue(nestedValue))
    .map(([key, nestedValue]) => [key, sanitizeValue(nestedValue)] as const)
    .filter(([, nestedValue]) => !shouldOmitValue(nestedValue));

  return Object.fromEntries(entries);
}

function shouldOmitValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") {
    return true;
  }

  if (Array.isArray(value) && value.length === 0) {
    return true;
  }

  if (typeof value === "object" && value && Object.keys(value).length === 0) {
    return true;
  }

  return false;
}
