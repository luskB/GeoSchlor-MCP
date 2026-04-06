const DOI_PATTERN = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i;

export function normalizeWhitespace(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeDoi(value: string | null | undefined): string | undefined {
  const match = normalizeWhitespace(value).match(DOI_PATTERN);
  return match?.[0]?.replace(/\.$/, "").toLowerCase();
}

export function extractYear(value: string | null | undefined): number | undefined {
  const match = normalizeWhitespace(value).match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : undefined;
}

export function safeFileName(value: string, fallback = "article"): string {
  const normalized = normalizeWhitespace(value)
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/[^\w.\-\u4e00-\u9fa5 ]+/g, "_")
    .trim()
    .replace(/\s+/g, "_");

  const safe = normalized.replace(/^_+|_+$/g, "");
  return (safe || fallback).slice(0, 140);
}

export function uniqueList(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeWhitespace(value)).filter(Boolean))];
}

export function stripHtmlTags(value: string | null | undefined): string {
  return normalizeWhitespace((value ?? "").replace(/<[^>]+>/g, " "));
}
