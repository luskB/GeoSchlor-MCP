export type SourceId =
  | "cnki"
  | "geophysics"
  | "petrophysics"
  | "onepetro"
  | "spe"
  | "spwla"
  | "eage"
  | "aapg"
  | "openalex"
  | "wanfang"
  | "vip";

export type SearchMode = "keyword" | "title" | "author" | "doi" | "journal";

export type AccessKind =
  | "open"
  | "session_required"
  | "subscription"
  | "unknown";

export type DownloadMethod = "http" | "browser";

export type DownloadFormat = "pdf" | "caj" | "html" | "unknown";

export type DownloadJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "needs_auth";

export interface SearchFilters {
  yearFrom?: number;
  yearTo?: number;
  journal?: string;
  volume?: string;
  issue?: string;
  resourceCode?: string;
  sortBy?: "relevance" | "published";
}

export interface SearchRequest {
  source: SourceId | "all";
  query: string;
  mode: SearchMode;
  maxResults: number;
  expandBilingual?: boolean;
  enrichResults?: boolean;
  filters?: SearchFilters;
}

export interface ArticleRecord {
  id: string;
  source: SourceId;
  title: string;
  authors: string[];
  journal?: string;
  year?: number;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  abstract?: string;
  keywords?: string[];
  institutions?: string[];
  language?: string;
  publisher?: string;
  publicationDate?: string;
  citationCount?: number;
  referenceCount?: number;
  sourceType?: string;
  issn?: string[];
  subjects?: string[];
  detailUrl?: string;
  downloadUrl?: string;
  pdfUrl?: string;
  oaUrl?: string;
  oaStatus?: string;
  access: AccessKind;
  snippets?: string[];
  raw?: Record<string, unknown>;
}

export interface ProviderSearchResult {
  source: SourceId;
  total: number;
  items: ArticleRecord[];
  notes?: string[];
}

export interface AggregatedSearchResult {
  query: string;
  mode: SearchMode;
  queryVariants?: string[];
  sources: ProviderSearchResult[];
  total: number;
}

export interface DownloadCandidate {
  id: string;
  source: SourceId;
  label: string;
  url: string;
  method: DownloadMethod;
  format: DownloadFormat;
  requiresAuth: boolean;
  referer?: string;
  headers?: Record<string, string>;
}

export interface DownloadAttempt {
  candidateId: string;
  label: string;
  method: DownloadMethod;
  url: string;
  startedAt: string;
  finishedAt?: string;
  status: "success" | "failed" | "skipped";
  message?: string;
}

export interface DownloadJob {
  id: string;
  source: SourceId;
  recordId: string;
  title: string;
  status: DownloadJobStatus;
  outputDir: string;
  createdAt: string;
  updatedAt: string;
  filePath?: string;
  error?: string;
  attempts: DownloadAttempt[];
}

export interface AuthStatus {
  source: SourceId;
  configured: boolean;
  statePath: string;
  notes: string[];
}
