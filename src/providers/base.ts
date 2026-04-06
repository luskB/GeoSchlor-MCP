import { BrowserSessionManager } from "../browser/session-manager.js";
import { AppConfig } from "../config.js";
import { HttpClient } from "../http/http-client.js";
import { FileCache } from "../storage/file-cache.js";
import {
  ArticleRecord,
  DownloadCandidate,
  ProviderSearchResult,
  SearchRequest,
  SourceId
} from "../types.js";

export interface ProviderContext {
  config: AppConfig;
  http: HttpClient;
  cache: FileCache;
  browser: BrowserSessionManager;
}

export interface SearchProvider {
  readonly id: SourceId;
  search(request: SearchRequest, context: ProviderContext): Promise<ProviderSearchResult>;
  getRecord(locator: string, context: ProviderContext): Promise<ArticleRecord | null>;
  resolveDownload(
    record: ArticleRecord,
    context: ProviderContext
  ): Promise<DownloadCandidate[]>;
}

export class ProviderAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderAuthError";
  }
}
