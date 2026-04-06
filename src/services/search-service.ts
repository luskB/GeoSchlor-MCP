import { BrowserSessionManager } from "../browser/session-manager.js";
import { AppConfig } from "../config.js";
import { HttpClient } from "../http/http-client.js";
import { SearchProvider, ProviderContext } from "../providers/base.js";
import { FileCache } from "../storage/file-cache.js";
import {
  mergeArticleRecordList,
  needsAcademicEnrichment
} from "../utils/article-records.js";
import {
  buildQueryVariants,
  prioritizeQueryVariants
} from "../utils/query-expansion.js";
import {
  AggregatedSearchResult,
  ArticleRecord,
  SearchFilters,
  SearchRequest,
  SourceId
} from "../types.js";

const RECORD_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface RecordLocator {
  recordId?: string;
  doi?: string;
  detailUrl?: string;
}

export class SearchService {
  private readonly providerContext: ProviderContext;
  private readonly providers: Map<SourceId, SearchProvider>;

  constructor(
    config: AppConfig,
    http: HttpClient,
    cache: FileCache,
    browser: BrowserSessionManager,
    providers: SearchProvider[]
  ) {
    this.providerContext = {
      config,
      http,
      cache,
      browser
    };
    this.providers = new Map(providers.map((provider) => [provider.id, provider]));
  }

  getProvider(source: SourceId): SearchProvider {
    const provider = this.providers.get(source);
    if (!provider) {
      throw new Error(`Unknown provider: ${source}`);
    }
    return provider;
  }

  async search(request: SearchRequest): Promise<AggregatedSearchResult> {
    const sources =
      request.source === "all" ? [...this.providers.keys()] : [request.source];
    const queryVariants =
      request.expandBilingual === false
        ? [request.query]
        : buildQueryVariants(request.query, request.mode);

    const results = await Promise.all(
      sources.map(async (source) => {
        const { items, notes } = await this.searchSourceWithVariants(
          source,
          request,
          queryVariants
        );
        for (const item of items) {
          await this.saveRecord(item);
        }
        return {
          source,
          items,
          notes,
          total: items.length
        };
      })
    );

    return {
      query: request.query,
      mode: request.mode,
      queryVariants,
      sources: results,
      total: results.reduce((sum, result) => sum + result.items.length, 0)
    };
  }

  async resolveRecord(source: SourceId, locator: RecordLocator): Promise<ArticleRecord | null> {
    if (locator.recordId) {
      const cached = await this.providerContext.cache.get<ArticleRecord>(
        `records/${source}`,
        locator.recordId
      );
      if (cached) {
        return cached;
      }
    }

    const provider = this.getProvider(source);
    const fallbackLocator = locator.doi ?? locator.detailUrl;
    if (!fallbackLocator) {
      return null;
    }

    const record = await provider.getRecord(fallbackLocator, this.providerContext);
    if (record) {
      await this.saveRecord(record);
    }
    return record;
  }

  getProviderContext(): ProviderContext {
    return this.providerContext;
  }

  private async saveRecord(record: ArticleRecord): Promise<void> {
    await this.providerContext.cache.set(
      `records/${record.source}`,
      record.id,
      record,
      RECORD_TTL_MS
    );
  }

  private async searchSourceWithVariants(
    source: SourceId,
    request: SearchRequest,
    queryVariants: string[]
  ): Promise<{ items: ArticleRecord[]; notes?: string[] }> {
    const provider = this.getProvider(source);
    const prioritizedVariants = prioritizeQueryVariants(source, queryVariants);
    const mergedItems: ArticleRecord[] = [];
    const collectedNotes: string[] = [];
    let lastError: unknown;

    for (const variant of prioritizedVariants) {
      try {
        const raw = await provider.search(
          {
            ...request,
            source,
            query: variant,
            expandBilingual: false
          },
          this.providerContext
        );
        mergedItems.push(...raw.items);
        collectedNotes.push(...(raw.notes ?? []));
        const filtered = applyCommonFilters(
          mergeArticleRecordList(mergedItems),
          request.filters
        );
        if (filtered.length >= request.maxResults) {
          break;
        }
      } catch (error) {
        lastError = error;
      }
    }

    if (!mergedItems.length && lastError) {
      throw lastError;
    }

    let items = applyCommonFilters(mergeArticleRecordList(mergedItems), request.filters).slice(
      0,
      request.maxResults
    );

    if (request.enrichResults !== false) {
      items = await this.enrichSearchItems(source, items);
    }

    return {
      items,
      notes: uniqueNotes([
        ...collectedNotes,
        ...buildSearchNotes(source, queryVariants, request.expandBilingual !== false)
      ])
    };
  }

  private async enrichSearchItems(
    source: SourceId,
    items: ArticleRecord[]
  ): Promise<ArticleRecord[]> {
    const provider = this.getProvider(source);
    const enrichmentLimit = Math.min(this.providerContext.config.searchEnrichmentLimit, items.length);

    const enriched = await Promise.all(
      items.map(async (item, index) => {
        if (index >= enrichmentLimit || !needsAcademicEnrichment(item)) {
          return item;
        }

        const locator = item.detailUrl ?? item.doi ?? item.id;
        try {
          const record = await provider.getRecord(locator, this.providerContext);
          return record ? mergeArticleRecordList([item, record])[0] : item;
        } catch {
          return item;
        }
      })
    );

    return mergeArticleRecordList(enriched);
  }
}

function applyCommonFilters(
  items: ArticleRecord[],
  filters: SearchFilters | undefined
): ArticleRecord[] {
  if (!filters) {
    return items;
  }

  return items.filter((item) => {
    if (filters.yearFrom && item.year && item.year < filters.yearFrom) {
      return false;
    }
    if (filters.yearTo && item.year && item.year > filters.yearTo) {
      return false;
    }
    if (
      filters.journal &&
      item.journal &&
      !item.journal.toLowerCase().includes(filters.journal.toLowerCase())
    ) {
      return false;
    }
    return true;
  });
}

function buildSearchNotes(
  source: SourceId,
  queryVariants: string[],
  expanded: boolean
) : string[] {
  if (!expanded || queryVariants.length <= 1) {
    return [];
  }

  return [
    `${source} search used bilingual query expansion.`,
    `Query variants: ${queryVariants.join(" | ")}`
  ];
}

function uniqueNotes(notes: string[]): string[] | undefined {
  const values = [...new Set(notes.filter(Boolean))];
  return values.length ? values : undefined;
}
