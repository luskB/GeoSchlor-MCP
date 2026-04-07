import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BrowserSessionManager } from "./browser/session-manager.js";
import { loadConfig } from "./config.js";
import { HttpClient } from "./http/http-client.js";
import { ProviderAuthError } from "./providers/base.js";
import { AapgProvider } from "./providers/aapg-provider.js";
import { CnkiProvider } from "./providers/cnki-provider.js";
import { EageProvider } from "./providers/eage-provider.js";
import { GeophysicsProvider } from "./providers/geophysics-provider.js";
import { OnePetroProvider } from "./providers/onepetro-provider.js";
import { PetrophysicsProvider } from "./providers/petrophysics-provider.js";
import { SpeProvider } from "./providers/spe-provider.js";
import { SpwlaProvider } from "./providers/spwla-provider.js";
import { VipProvider } from "./providers/vip-provider.js";
import { WanfangProvider } from "./providers/wanfang-provider.js";
import { DownloadManager } from "./services/download-manager.js";
import { SearchService } from "./services/search-service.js";
import { ScholarSearchService } from "./services/scholar-search-service.js";
import { FileCache } from "./storage/file-cache.js";
import { JobStore } from "./storage/job-store.js";
import { ensureDir } from "./utils/files.js";
import { sanitizeForToolOutput } from "./utils/output.js";

const config = loadConfig();
await Promise.all([
  ensureDir(config.dataDir),
  ensureDir(config.cacheDir),
  ensureDir(config.authDir),
  ensureDir(config.downloadDir)
]);

const http = new HttpClient(config);
const cache = new FileCache(config.cacheDir);
const browser = new BrowserSessionManager(config);
const jobStore = new JobStore(config.jobStorePath);
await jobStore.initialize();

const searchService = new SearchService(
  config,
  http,
  cache,
  browser,
  [
    new CnkiProvider(),
    new GeophysicsProvider(),
    new PetrophysicsProvider(),
    new OnePetroProvider(),
    new SpeProvider(),
    new SpwlaProvider(),
    new EageProvider(),
    new AapgProvider(),
    new WanfangProvider(),
    new VipProvider()
  ]
);
const scholarSearchService = new ScholarSearchService(config, http, cache);
const downloadManager = new DownloadManager(searchService, jobStore);

const server = new McpServer({
  name: "GeoScholar",
  version: "0.1.0"
});

const searchSourceSchema = z
  .enum([
    "all",
    "cnki",
    "geophysics",
    "petrophysics",
    "onepetro",
    "spe",
    "spwla",
    "eage",
    "aapg",
    "wanfang",
    "vip"
  ])
  .optional()
  .describe(
    "Target source to search. Use 'all' for a broad cross-source search. Allowed values: all, cnki, geophysics, petrophysics, onepetro, spe, spwla, eage, aapg, wanfang, vip."
  );

const providerSourceSchema = z
  .enum([
    "cnki",
    "geophysics",
    "petrophysics",
    "onepetro",
    "spe",
    "spwla",
    "eage",
    "aapg",
    "wanfang",
    "vip"
  ])
  .describe(
    "Source that owns the article or record. This must match the source where the article was searched or identified."
  );

const querySchema = z
  .string()
  .min(1)
  .describe(
    "Search input. Prefer a short topic phrase, title fragment, author name, journal name, or DOI, for example 'well logging', 'A quantitative characterization...', or '10.1190/geo-2025-0139'."
  );

const authorNameSchema = z
  .string()
  .min(1)
  .describe(
    "Scholar or author name to look up, for example '张凯' or 'Kai Zhang'. Use this tool when the user asks for a specific teacher, professor, researcher, or author."
  );

const institutionHintSchema = z
  .string()
  .optional()
  .describe(
    "Optional institution hint, for example '中国石油大学' or 'China University of Petroleum, East China'. Highly recommended for common names because it sharply improves author disambiguation."
  );

const topicHintSchema = z
  .string()
  .optional()
  .describe(
    "Optional research-topic hint, for example '测井', 'acoustic logging', or 'reservoir evaluation'. Use this when the user wants one scholar's papers in a specific direction."
  );

const searchModeSchema = z
  .enum(["keyword", "title", "author", "doi", "journal"])
  .optional()
  .describe(
    "How to interpret the query. Use 'keyword' by default. Use 'title' for title fragments, 'author' for author names, 'doi' only when the query is a DOI, and 'journal' for source/journal title matching."
  );

const maxResultsSchema = z
  .number()
  .int()
  .min(1)
  .max(50)
  .optional()
  .describe(
    "Maximum number of search results to return, between 1 and 50. Use 5 to 10 for a first pass unless the user explicitly wants more."
  );

const expandBilingualSchema = z
  .boolean()
  .optional()
  .describe(
    "Whether to automatically expand related Chinese and English query variants. Turn this on for mixed-language or bilingual research topics."
  );

const enrichResultsSchema = z
  .boolean()
  .optional()
  .describe(
    "Whether to enrich results with more metadata such as abstract, keywords, institutions, DOI, citation count, and detail links when available."
  );

const yearFromSchema = z
  .number()
  .int()
  .optional()
  .describe(
    "Inclusive start year filter. Use this together with yearTo when the user asks for recent papers or a specific time window."
  );

const yearToSchema = z
  .number()
  .int()
  .optional()
  .describe(
    "Inclusive end year filter. Use this together with yearFrom when the user asks for a bounded year range."
  );

const journalSchema = z
  .string()
  .optional()
  .describe(
    "Optional journal or source title filter. Use this only when the user explicitly wants one journal or publication title."
  );

const sortBySchema = z
  .enum(["relevance", "published"])
  .optional()
  .describe(
    "Sort order. Use 'relevance' for a normal topical search. Use 'published' when the user asks for the latest, newest, or most recent papers."
  );

const resourceCodeSchema = z
  .string()
  .optional()
  .describe(
    "Advanced CNKI-only resource code filter. Leave this empty unless you already know the exact CNKI resource category to use."
  );

const recordIdSchema = z
  .string()
  .optional()
  .describe(
    "Article id returned by a previous GeoScholar search result. Prefer this when you already have search output. Do not pass the article title here."
  );

const doiSchema = z
  .string()
  .optional()
  .describe(
    "Article DOI, for example '10.1190/geo-2025-0139'. Use this when a DOI is known and no record id is available."
  );

const detailUrlSchema = z
  .string()
  .url()
  .optional()
  .describe(
    "Full article detail URL from a supported source such as CNKI, Wanfang, VIP, or another GeoScholar source. Use this when a previous result already provides detailUrl."
  );

const outputDirSchema = z
  .string()
  .optional()
  .describe(
    "Optional local directory for downloaded files. Leave empty to use the server's default downloads directory."
  );

const jobsLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe(
    "Maximum number of recent download jobs to list, between 1 and 100. Default is 20."
  );

const jobIdSchema = z
  .string()
  .min(1)
  .describe(
    "Download job id returned by queue_download or download_article. Use this to inspect one job in detail."
  );

function cleanOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

async function runSearchTool(input: {
  source?:
    | "all"
    | "cnki"
    | "geophysics"
    | "petrophysics"
    | "onepetro"
    | "spe"
    | "spwla"
    | "eage"
    | "aapg"
    | "wanfang"
    | "vip";
  query: string;
  mode?: "keyword" | "title" | "author" | "doi" | "journal";
  maxResults?: number;
  expandBilingual?: boolean;
  enrichResults?: boolean;
  yearFrom?: number;
  yearTo?: number;
  journal?: string;
  sortBy?: "relevance" | "published";
  resourceCode?: string;
}) {
  try {
    const result = await searchService.search({
      source: input.source ?? "all",
      query: input.query.trim(),
      mode: input.mode ?? "keyword",
      maxResults: input.maxResults ?? 10,
      expandBilingual: input.expandBilingual,
      enrichResults: input.enrichResults,
      filters: {
        yearFrom: input.yearFrom,
        yearTo: input.yearTo,
        journal: cleanOptionalText(input.journal),
        sortBy: input.sortBy,
        resourceCode: cleanOptionalText(input.resourceCode)
      }
    });
    return textResult(result);
  } catch (error) {
    return errorResult(error);
  }
}

server.tool(
  "search_literature",
  "General-purpose multi-source literature search. Use this as the default entry point when the user did not name a single source. Returns grouped results from one or more sources. Prefer mode='keyword'. For latest or recent papers, set sortBy='published' and optionally yearFrom/yearTo. If the user is asking for a specific teacher, professor, or author together with institution or topic, prefer search_scholar_publications instead.",
  {
    source: searchSourceSchema,
    query: querySchema,
    mode: searchModeSchema,
    maxResults: maxResultsSchema,
    expandBilingual: expandBilingualSchema,
    enrichResults: enrichResultsSchema,
    yearFrom: yearFromSchema,
    yearTo: yearToSchema,
    journal: journalSchema,
    sortBy: sortBySchema,
    resourceCode: resourceCodeSchema
  },
  runSearchTool
);

server.tool(
  "search_cnki",
  "CNKI-specific search for Chinese academic literature. Use this when the user explicitly asks for CNKI or Chinese journal papers. Prefer mode='keyword'. Use mode='doi' only when the query itself is a DOI.",
  {
    query: querySchema,
    mode: searchModeSchema,
    maxResults: maxResultsSchema,
    expandBilingual: expandBilingualSchema,
    enrichResults: enrichResultsSchema,
    resourceCode: resourceCodeSchema
  },
  async (input) =>
    runSearchTool({
      source: "cnki",
      query: input.query,
      mode: input.mode,
      maxResults: input.maxResults,
      expandBilingual: input.expandBilingual,
      enrichResults: input.enrichResults,
      resourceCode: input.resourceCode
    })
);

server.tool(
  "search_geophysics",
  "Search only the journal GEOPHYSICS. Use this when the user explicitly wants results from GEOPHYSICS. For the newest papers, set sortBy='published' and optionally yearFrom/yearTo.",
  {
    query: querySchema,
    mode: searchModeSchema,
    maxResults: maxResultsSchema,
    expandBilingual: expandBilingualSchema,
    enrichResults: enrichResultsSchema,
    yearFrom: yearFromSchema,
    yearTo: yearToSchema,
    sortBy: sortBySchema
  },
  async (input) =>
    runSearchTool({
      source: "geophysics",
      query: input.query,
      mode: input.mode,
      maxResults: input.maxResults,
      expandBilingual: input.expandBilingual,
      enrichResults: input.enrichResults,
      yearFrom: input.yearFrom,
      yearTo: input.yearTo,
      sortBy: input.sortBy
    })
);

server.tool(
  "search_petrophysics",
  "Search only the journal Petrophysics (SPWLA). Use this when the user explicitly wants SPWLA or Petrophysics papers. For newest papers, set sortBy='published' and optionally yearFrom/yearTo.",
  {
    query: querySchema,
    mode: searchModeSchema,
    maxResults: maxResultsSchema,
    expandBilingual: expandBilingualSchema,
    enrichResults: enrichResultsSchema,
    yearFrom: yearFromSchema,
    yearTo: yearToSchema,
    sortBy: sortBySchema
  },
  async (input) =>
    runSearchTool({
      source: "petrophysics",
      query: input.query,
      mode: input.mode,
      maxResults: input.maxResults,
      expandBilingual: input.expandBilingual,
      enrichResults: input.enrichResults,
      yearFrom: input.yearFrom,
      yearTo: input.yearTo,
      sortBy: input.sortBy
    })
);

server.tool(
  "search_onepetro",
  "Search OnePetro-style petroleum engineering literature across the broader OnePetro-style metadata pool. Use this for a wide petroleum-engineering sweep or when the user names OnePetro itself. For narrower association-focused searches, prefer search_spe or search_spwla.",
  {
    query: querySchema,
    mode: searchModeSchema,
    maxResults: maxResultsSchema,
    expandBilingual: expandBilingualSchema,
    enrichResults: enrichResultsSchema,
    yearFrom: yearFromSchema,
    yearTo: yearToSchema,
    sortBy: sortBySchema
  },
  async (input) =>
    runSearchTool({
      source: "onepetro",
      query: input.query,
      mode: input.mode,
      maxResults: input.maxResults,
      expandBilingual: input.expandBilingual,
      enrichResults: input.enrichResults,
      yearFrom: input.yearFrom,
      yearTo: input.yearTo,
      sortBy: input.sortBy
    })
);

server.tool(
  "search_spe",
  "Search SPE literature using public metadata. Use this when the user explicitly wants Society of Petroleum Engineers papers, journals, or conference proceedings. For newest papers, set sortBy='published' and optionally yearFrom/yearTo.",
  {
    query: querySchema,
    mode: searchModeSchema,
    maxResults: maxResultsSchema,
    expandBilingual: expandBilingualSchema,
    enrichResults: enrichResultsSchema,
    yearFrom: yearFromSchema,
    yearTo: yearToSchema,
    sortBy: sortBySchema
  },
  async (input) =>
    runSearchTool({
      source: "spe",
      query: input.query,
      mode: input.mode,
      maxResults: input.maxResults,
      expandBilingual: input.expandBilingual,
      enrichResults: input.enrichResults,
      yearFrom: input.yearFrom,
      yearTo: input.yearTo,
      sortBy: input.sortBy
    })
);

server.tool(
  "search_spwla",
  "Search SPWLA literature using public metadata. Use this when the user wants SPWLA symposium, transaction, or broader SPWLA records beyond the Petrophysics journal. For the journal only, prefer search_petrophysics.",
  {
    query: querySchema,
    mode: searchModeSchema,
    maxResults: maxResultsSchema,
    expandBilingual: expandBilingualSchema,
    enrichResults: enrichResultsSchema,
    yearFrom: yearFromSchema,
    yearTo: yearToSchema,
    sortBy: sortBySchema
  },
  async (input) =>
    runSearchTool({
      source: "spwla",
      query: input.query,
      mode: input.mode,
      maxResults: input.maxResults,
      expandBilingual: input.expandBilingual,
      enrichResults: input.enrichResults,
      yearFrom: input.yearFrom,
      yearTo: input.yearTo,
      sortBy: input.sortBy
    })
);

server.tool(
  "search_eage",
  "Search EAGE / EarthDoc literature using public metadata. Use this for EAGE workshops, conference papers, EarthDoc records, and related geoscience proceedings. For newest papers, set sortBy='published' and optionally yearFrom/yearTo.",
  {
    query: querySchema,
    mode: searchModeSchema,
    maxResults: maxResultsSchema,
    expandBilingual: expandBilingualSchema,
    enrichResults: enrichResultsSchema,
    yearFrom: yearFromSchema,
    yearTo: yearToSchema,
    sortBy: sortBySchema
  },
  async (input) =>
    runSearchTool({
      source: "eage",
      query: input.query,
      mode: input.mode,
      maxResults: input.maxResults,
      expandBilingual: input.expandBilingual,
      enrichResults: input.enrichResults,
      yearFrom: input.yearFrom,
      yearTo: input.yearTo,
      sortBy: input.sortBy
    })
);

server.tool(
  "search_aapg",
  "Search AAPG literature using public metadata. Use this for AAPG Bulletin, Datapages-style records, and other AAPG-indexed results. For newest papers, set sortBy='published' and optionally yearFrom/yearTo.",
  {
    query: querySchema,
    mode: searchModeSchema,
    maxResults: maxResultsSchema,
    expandBilingual: expandBilingualSchema,
    enrichResults: enrichResultsSchema,
    yearFrom: yearFromSchema,
    yearTo: yearToSchema,
    sortBy: sortBySchema
  },
  async (input) =>
    runSearchTool({
      source: "aapg",
      query: input.query,
      mode: input.mode,
      maxResults: input.maxResults,
      expandBilingual: input.expandBilingual,
      enrichResults: input.enrichResults,
      yearFrom: input.yearFrom,
      yearTo: input.yearTo,
      sortBy: input.sortBy
    })
);

server.tool(
  "search_wanfang",
  "Search Wanfang using the same default all-resources ranking as the public Wanfang website. Use this when the user explicitly asks for Wanfang. Results may include journal papers, theses, and conference papers.",
  {
    query: querySchema,
    mode: searchModeSchema,
    maxResults: maxResultsSchema,
    expandBilingual: expandBilingualSchema,
    enrichResults: enrichResultsSchema
  },
  async (input) =>
    runSearchTool({
      source: "wanfang",
      query: input.query,
      mode: input.mode,
      maxResults: input.maxResults,
      expandBilingual: input.expandBilingual,
      enrichResults: input.enrichResults
    })
);

server.tool(
  "search_vip",
  "Search CQVIP / 维普 for Chinese literature. Use this when the user explicitly asks for VIP, CQVIP, or 维普.",
  {
    query: querySchema,
    mode: searchModeSchema,
    maxResults: maxResultsSchema,
    expandBilingual: expandBilingualSchema,
    enrichResults: enrichResultsSchema
  },
  async (input) =>
    runSearchTool({
      source: "vip",
      query: input.query,
      mode: input.mode,
      maxResults: input.maxResults,
      expandBilingual: input.expandBilingual,
      enrichResults: input.enrichResults
    })
);

server.tool(
  "search_petroleum_literature",
  "Recommended default search tool for petroleum, logging, geology, geophysics, and reservoir-evaluation topics. It searches across all configured sources with bilingual expansion and metadata enrichment already enabled, including CNKI, GEOPHYSICS, Petrophysics, OnePetro, SPE, SPWLA, EAGE, AAPG, Wanfang, and VIP. If the request is about one specific scholar or teacher plus institution/topic, prefer search_scholar_publications instead.",
  {
    query: querySchema,
    mode: searchModeSchema,
    maxResults: maxResultsSchema,
    yearFrom: yearFromSchema,
    yearTo: yearToSchema,
    journal: journalSchema,
    sortBy: sortBySchema
  },
  async (input) =>
    runSearchTool({
      source: "all",
      query: input.query,
      mode: input.mode,
      maxResults: input.maxResults,
      expandBilingual: true,
      enrichResults: true,
      yearFrom: input.yearFrom,
      yearTo: input.yearTo,
      journal: input.journal,
      sortBy: input.sortBy
    })
);

server.tool(
  "search_scholar_publications",
  "Best tool for professor, teacher, researcher, or author lookup when the user names a person together with institution, lab, department, or research direction. This is especially strong for English and international papers. Provide authorName, then add institution and topic whenever possible. Example fit: '中国石油大学张凯老师的测井论文'.",
  {
    authorName: authorNameSchema,
    institution: institutionHintSchema,
    topic: topicHintSchema,
    maxResults: maxResultsSchema,
    yearFrom: yearFromSchema,
    yearTo: yearToSchema
  },
  async (input) => {
    try {
      const result = await scholarSearchService.search({
        authorName: input.authorName,
        institution: cleanOptionalText(input.institution),
        topic: cleanOptionalText(input.topic),
        maxResults: input.maxResults ?? 10,
        yearFrom: input.yearFrom,
        yearTo: input.yearTo
      });
      return textResult(result);
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.tool(
  "get_article_record",
  "Fetch one enriched article record after search. Use exactly one locator: recordId from a previous search result, or doi, or detailUrl. Prefer recordId when you already have a search result.",
  {
    source: providerSourceSchema,
    recordId: recordIdSchema,
    doi: doiSchema,
    detailUrl: detailUrlSchema
  },
  async (input) => {
    try {
      const record = await searchService.resolveRecord(input.source, {
        recordId: input.recordId,
        doi: input.doi,
        detailUrl: input.detailUrl
      });
      return textResult(record ?? { error: "Record not found." });
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.tool(
  "download_article",
  "Download one article using compliant official or OA links. Usually call this after search or get_article_record. Provide source plus exactly one locator: recordId, doi, or detailUrl.",
  {
    source: providerSourceSchema,
    recordId: recordIdSchema,
    doi: doiSchema,
    detailUrl: detailUrlSchema,
    outputDir: outputDirSchema
  },
  async (input) => {
    try {
      const job = await downloadManager.downloadNow({
        source: input.source,
        recordId: input.recordId,
        doi: input.doi,
        detailUrl: input.detailUrl,
        outputDir: input.outputDir
      });
      return textResult(job);
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.tool(
  "queue_download",
  "Queue one background download job. Usually call this after search or get_article_record. Provide source plus exactly one locator: recordId, doi, or detailUrl.",
  {
    source: providerSourceSchema,
    recordId: recordIdSchema,
    doi: doiSchema,
    detailUrl: detailUrlSchema,
    outputDir: outputDirSchema
  },
  async (input) => {
    try {
      const job = await downloadManager.queueDownload({
        source: input.source,
        recordId: input.recordId,
        doi: input.doi,
        detailUrl: input.detailUrl,
        outputDir: input.outputDir
      });
      return textResult(job);
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.tool(
  "list_download_jobs",
  "List recent background download jobs. Use this after queue_download to monitor progress or to retrieve a job id for follow-up inspection.",
  {
    limit: jobsLimitSchema
  },
  async (input) => textResult(downloadManager.listJobs(input.limit ?? 20))
);

server.tool(
  "get_download_job",
  "Get one background download job by id. Use this to inspect completion status, file path, or download errors for a specific queued job.",
  {
    id: jobIdSchema
  },
  async (input) =>
    textResult(downloadManager.getJob(input.id) ?? { error: "Job not found." })
);

server.tool(
  "get_auth_status",
  "Check whether saved local browser sessions exist for supported sources. Use this before CNKI troubleshooting or before attempting protected downloads that may require a saved session.",
  {},
  async () =>
    textResult({
      cnki: browser.getAuthStatus("cnki"),
      geophysics: browser.getAuthStatus("geophysics"),
      petrophysics: browser.getAuthStatus("petrophysics"),
      onepetro: browser.getAuthStatus("onepetro"),
      wanfang: browser.getAuthStatus("wanfang"),
      vip: browser.getAuthStatus("vip")
    })
);

server.tool(
  "describe_local_setup",
  "Show local install, authentication, and run steps for GeoScholar. Use this when the user needs setup help, authentication guidance, or troubleshooting instructions.",
  {},
  async () =>
    textResult({
      install: ["npm.cmd install", "npm run build"],
      auth: [
        "npm run auth:cnki",
        "npm run auth:geophysics  # optional",
        "npm run auth:wanfang     # optional, only if you have access and want protected downloads",
        "npm run auth:vip         # optional, only if you have access and want protected downloads"
      ],
      run: ["npm run dev", "npm run start"],
      notes: [
        "CNKI search and download depend on a saved browser session because the official site uses verification pages.",
        "GEOPHYSICS, Petrophysics, OnePetro, SPE, SPWLA, EAGE, and AAPG use public metadata and OA resolution by default.",
        "Wanfang uses the official grpc-web protocol for search and detail lookup; CQVIP uses signed protocol requests.",
        "If no OA copy exists, metadata-first providers will clearly report that publisher or institutional access is required."
      ]
    })
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("GeoScholar is running on stdio");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(sanitizeForToolOutput(value), null, 2)
      }
    ]
  };
}

function errorResult(error: unknown) {
  const message =
    error instanceof ProviderAuthError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);

  return textResult({
    error: message
  });
}
