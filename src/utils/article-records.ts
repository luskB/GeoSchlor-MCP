import { ArticleRecord } from "../types.js";
import { normalizeDoi, normalizeWhitespace, uniqueList } from "./text.js";

export function uniqueRecordKey(record: Pick<ArticleRecord, "doi" | "title">): string {
  return normalizeDoi(record.doi) ?? normalizeWhitespace(record.title).toLowerCase();
}

export function mergeArticleRecordList(records: ArticleRecord[]): ArticleRecord[] {
  const merged = new Map<string, ArticleRecord>();

  for (const record of records) {
    const key = uniqueRecordKey(record);
    const existing = merged.get(key);
    merged.set(key, existing ? mergeArticleRecords(existing, record) : record);
  }

  return [...merged.values()];
}

export function mergeArticleRecords(
  base: ArticleRecord,
  incoming: ArticleRecord
): ArticleRecord {
  const merged: ArticleRecord = {
    ...base,
    title: pickPreferred(base.title, incoming.title) ?? base.title,
    authors: uniqueList([...(base.authors ?? []), ...(incoming.authors ?? [])]),
    journal: pickPreferred(base.journal, incoming.journal),
    year: base.year ?? incoming.year,
    volume: pickPreferred(base.volume, incoming.volume),
    issue: pickPreferred(base.issue, incoming.issue),
    pages: pickPreferred(base.pages, incoming.pages),
    doi: normalizeDoi(base.doi) ?? normalizeDoi(incoming.doi),
    abstract: pickPreferred(base.abstract, incoming.abstract),
    keywords: uniqueList([...(base.keywords ?? []), ...(incoming.keywords ?? [])]),
    institutions: uniqueList([
      ...(base.institutions ?? []),
      ...(incoming.institutions ?? [])
    ]),
    language: pickPreferred(base.language, incoming.language),
    publisher: pickPreferred(base.publisher, incoming.publisher),
    publicationDate: pickPreferred(base.publicationDate, incoming.publicationDate),
    citationCount: pickNumber(base.citationCount, incoming.citationCount),
    referenceCount: pickNumber(base.referenceCount, incoming.referenceCount),
    sourceType: pickPreferred(base.sourceType, incoming.sourceType),
    issn: uniqueList([...(base.issn ?? []), ...(incoming.issn ?? [])]),
    subjects: uniqueList([...(base.subjects ?? []), ...(incoming.subjects ?? [])]),
    detailUrl: pickPreferred(base.detailUrl, incoming.detailUrl),
    downloadUrl: pickPreferred(base.downloadUrl, incoming.downloadUrl),
    pdfUrl: pickPreferred(base.pdfUrl, incoming.pdfUrl),
    oaUrl: pickPreferred(base.oaUrl, incoming.oaUrl),
    oaStatus: pickPreferred(base.oaStatus, incoming.oaStatus),
    access: mergeAccess(base, incoming),
    snippets: uniqueList([...(base.snippets ?? []), ...(incoming.snippets ?? [])]),
    raw: {
      ...(base.raw ?? {}),
      ...(incoming.raw ?? {})
    }
  };

  return merged;
}

export function needsAcademicEnrichment(record: ArticleRecord): boolean {
  return !Boolean(
    normalizeWhitespace(record.abstract) &&
      record.keywords?.length &&
      record.doi &&
      (record.institutions?.length || record.citationCount !== undefined)
  );
}

function pickPreferred(
  primary: string | undefined,
  fallback: string | undefined
): string | undefined {
  const normalizedPrimary = normalizeWhitespace(primary);
  if (normalizedPrimary) {
    return normalizedPrimary;
  }

  const normalizedFallback = normalizeWhitespace(fallback);
  return normalizedFallback || undefined;
}

function pickNumber(primary: number | undefined, fallback: number | undefined) {
  return primary ?? fallback;
}

function mergeAccess(base: ArticleRecord, incoming: ArticleRecord) {
  if (base.oaUrl || incoming.oaUrl) {
    return "open" as const;
  }
  if (base.access === "open" || incoming.access === "open") {
    return "open" as const;
  }
  if (base.access === "session_required" || incoming.access === "session_required") {
    return "session_required" as const;
  }
  if (base.access === "subscription" || incoming.access === "subscription") {
    return "subscription" as const;
  }
  return "unknown" as const;
}
