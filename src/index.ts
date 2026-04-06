import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BrowserSessionManager } from "./browser/session-manager.js";
import { loadConfig } from "./config.js";
import { HttpClient } from "./http/http-client.js";
import { ProviderAuthError } from "./providers/base.js";
import { CnkiProvider } from "./providers/cnki-provider.js";
import { GeophysicsProvider } from "./providers/geophysics-provider.js";
import { OnePetroProvider } from "./providers/onepetro-provider.js";
import { PetrophysicsProvider } from "./providers/petrophysics-provider.js";
import { VipProvider } from "./providers/vip-provider.js";
import { WanfangProvider } from "./providers/wanfang-provider.js";
import { DownloadManager } from "./services/download-manager.js";
import { SearchService } from "./services/search-service.js";
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
    new WanfangProvider(),
    new VipProvider()
  ]
);
const downloadManager = new DownloadManager(searchService, jobStore);

const server = new McpServer({
  name: "GeoScholar",
  version: "0.1.0"
});

async function runSearchTool(input: {
  source?:
    | "all"
    | "cnki"
    | "geophysics"
    | "petrophysics"
    | "onepetro"
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
      query: input.query,
      mode: input.mode ?? "keyword",
      maxResults: input.maxResults ?? 10,
      expandBilingual: input.expandBilingual,
      enrichResults: input.enrichResults,
      filters: {
        yearFrom: input.yearFrom,
        yearTo: input.yearTo,
        journal: input.journal,
        sortBy: input.sortBy,
        resourceCode: input.resourceCode
      }
    });
    return textResult(result);
  } catch (error) {
    return errorResult(error);
  }
}

server.tool(
  "search_literature",
  "Search CNKI, GEOPHYSICS, Petrophysics, OnePetro, Wanfang, CQVIP, or all of them together. CNKI still depends on a saved session; the other sources now prefer direct protocol or metadata flows.",
  {
    source: z
      .enum([
        "all",
        "cnki",
        "geophysics",
        "petrophysics",
        "onepetro",
        "wanfang",
        "vip"
      ])
      .optional(),
    query: z.string().min(1),
    mode: z.enum(["keyword", "title", "author", "doi", "journal"]).optional(),
    maxResults: z.number().int().min(1).max(50).optional(),
    expandBilingual: z.boolean().optional(),
    enrichResults: z.boolean().optional(),
    yearFrom: z.number().int().optional(),
    yearTo: z.number().int().optional(),
    journal: z.string().optional(),
    sortBy: z.enum(["relevance", "published"]).optional(),
    resourceCode: z.string().optional()
  },
  runSearchTool
);

server.tool(
  "search_cnki",
  "Search journal literature on CNKI using the official web search flow.",
  {
    query: z.string().min(1),
    mode: z.enum(["keyword", "title", "author", "doi", "journal"]).optional(),
    maxResults: z.number().int().min(1).max(50).optional(),
    expandBilingual: z.boolean().optional(),
    enrichResults: z.boolean().optional(),
    resourceCode: z.string().optional()
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
  "Search the journal GEOPHYSICS with public metadata. The provider uses Crossref as the main source and enriches records with OpenAlex and optional Unpaywall OA links.",
  {
    query: z.string().min(1),
    mode: z.enum(["keyword", "title", "author", "doi", "journal"]).optional(),
    maxResults: z.number().int().min(1).max(50).optional(),
    expandBilingual: z.boolean().optional(),
    enrichResults: z.boolean().optional(),
    yearFrom: z.number().int().optional(),
    yearTo: z.number().int().optional(),
    sortBy: z.enum(["relevance", "published"]).optional()
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
  "Search Petrophysics (the SPWLA journal) with Crossref/OpenAlex metadata and OA enrichment.",
  {
    query: z.string().min(1),
    mode: z.enum(["keyword", "title", "author", "doi", "journal"]).optional(),
    maxResults: z.number().int().min(1).max(50).optional(),
    expandBilingual: z.boolean().optional(),
    enrichResults: z.boolean().optional(),
    yearFrom: z.number().int().optional(),
    yearTo: z.number().int().optional(),
    sortBy: z.enum(["relevance", "published"]).optional()
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
  "Search petroleum-engineering literature associated with OnePetro / SPE-style DOI families using public metadata.",
  {
    query: z.string().min(1),
    mode: z.enum(["keyword", "title", "author", "doi", "journal"]).optional(),
    maxResults: z.number().int().min(1).max(50).optional(),
    expandBilingual: z.boolean().optional(),
    enrichResults: z.boolean().optional(),
    yearFrom: z.number().int().optional(),
    yearTo: z.number().int().optional(),
    sortBy: z.enum(["relevance", "published"]).optional()
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
  "search_wanfang",
  "Search Wanfang with the official all-resources ranking used by the public site, backed by grpc-web search and rich metadata extraction.",
  {
    query: z.string().min(1),
    mode: z.enum(["keyword", "title", "author", "doi", "journal"]).optional(),
    maxResults: z.number().int().min(1).max(50).optional(),
    expandBilingual: z.boolean().optional(),
    enrichResults: z.boolean().optional()
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
  "Search CQVIP / 维普 with browser-assisted signed search requests and rich structured metadata extraction.",
  {
    query: z.string().min(1),
    mode: z.enum(["keyword", "title", "author", "doi", "journal"]).optional(),
    maxResults: z.number().int().min(1).max(50).optional(),
    expandBilingual: z.boolean().optional(),
    enrichResults: z.boolean().optional()
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
  "Search petroleum, logging, geology, and geophysics literature across all configured sources with bilingual expansion enabled by default.",
  {
    query: z.string().min(1),
    mode: z.enum(["keyword", "title", "author", "doi", "journal"]).optional(),
    maxResults: z.number().int().min(1).max(50).optional(),
    yearFrom: z.number().int().optional(),
    yearTo: z.number().int().optional(),
    journal: z.string().optional(),
    sortBy: z.enum(["relevance", "published"]).optional()
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
  "get_article_record",
  "Resolve a full article record from a prior search result id, a DOI, or a CNKI detail URL.",
  {
    source: z.enum([
      "cnki",
      "geophysics",
      "petrophysics",
      "onepetro",
      "wanfang",
      "vip"
    ]),
    recordId: z.string().optional(),
    doi: z.string().optional(),
    detailUrl: z.string().url().optional()
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
  "Download an article with compliant links only. For GEOPHYSICS, the server prefers OA or repository copies and only treats publisher pages as an optional fallback.",
  {
    source: z.enum([
      "cnki",
      "geophysics",
      "petrophysics",
      "onepetro",
      "wanfang",
      "vip"
    ]),
    recordId: z.string().optional(),
    doi: z.string().optional(),
    detailUrl: z.string().url().optional(),
    outputDir: z.string().optional()
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
  "Queue a background download job.",
  {
    source: z.enum([
      "cnki",
      "geophysics",
      "petrophysics",
      "onepetro",
      "wanfang",
      "vip"
    ]),
    recordId: z.string().optional(),
    doi: z.string().optional(),
    detailUrl: z.string().url().optional(),
    outputDir: z.string().optional()
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
  "List recent download jobs.",
  {
    limit: z.number().int().min(1).max(100).optional()
  },
  async (input) => textResult(downloadManager.listJobs(input.limit ?? 20))
);

server.tool(
  "get_download_job",
  "Get one download job by id.",
  {
    id: z.string().min(1)
  },
  async (input) =>
    textResult(downloadManager.getJob(input.id) ?? { error: "Job not found." })
);

server.tool(
  "get_auth_status",
  "Check whether saved browser sessions exist for all configured sources. CNKI usually needs this for protected access; other sources only need sessions for optional protected download attempts.",
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
  "Show the local run and authentication steps for this MCP server.",
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
        "GEOPHYSICS, Petrophysics, and OnePetro use public metadata and OA resolution by default.",
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
