import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export interface AppConfig {
  dataDir: string;
  cacheDir: string;
  authDir: string;
  diagnosticLogPath: string;
  downloadDir: string;
  jobStorePath: string;
  searchCacheTtlMs: number;
  searchEnrichmentLimit: number;
  requestTimeoutMs: number;
  requestRetryCount: number;
  requestRetryDelayMs: number;
  browserChannel: "chrome" | "msedge" | "chromium";
  browserHeadless: boolean;
  browserUserAgent?: string;
  cnkiBrowserHeadless: boolean;
  cnkiRuntimeMode: "auto" | "http_only" | "headed";
  browserNavigationTimeoutMs: number;
  cnkiAuthTimeoutMs: number;
  cnkiStatePath: string;
  geophysicsStatePath: string;
  geophysicsIssn: string;
  petrophysicsIssn: string;
  unpaywallEmail?: string;
  openAlexMailto?: string;
  userAgent: string;
}

const moduleDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(moduleDir, "..");
const explicitBaseDir = process.env.CNKI_MCP_BASE_DIR
  ? resolve(process.env.CNKI_MCP_BASE_DIR)
  : undefined;
const dotenvPath = findDotenvPath();
if (dotenvPath) {
  dotenv.config({ path: dotenvPath });
} else {
  dotenv.config();
}

const appBaseDir = explicitBaseDir ?? projectRoot;

function getNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  return raw.toLowerCase() === "true";
}

function getBrowserChannel(): AppConfig["browserChannel"] {
  const raw = process.env.CNKI_MCP_BROWSER_CHANNEL;
  if (raw === "chrome" || raw === "msedge" || raw === "chromium") {
    return raw;
  }
  return "msedge";
}

function getCnkiRuntimeMode(): AppConfig["cnkiRuntimeMode"] {
  const raw = process.env.CNKI_MCP_CNKI_RUNTIME_MODE;
  if (raw === "auto" || raw === "http_only" || raw === "headed") {
    return raw;
  }
  return "auto";
}

export function loadConfig(): AppConfig {
  const dataDir = resolve(appBaseDir, process.env.CNKI_MCP_DATA_DIR ?? ".mcp-data");
  const authDir = resolve(dataDir, "auth");
  return {
    dataDir,
    cacheDir: resolve(dataDir, "cache"),
    authDir,
    diagnosticLogPath: resolve(dataDir, "logs", "diagnostics.log"),
    downloadDir: resolve(appBaseDir, process.env.CNKI_MCP_DOWNLOAD_DIR ?? "downloads"),
    jobStorePath: resolve(dataDir, "jobs.json"),
    searchCacheTtlMs: getNumber("CNKI_MCP_CACHE_TTL_MINUTES", 720) * 60 * 1000,
    searchEnrichmentLimit: getNumber("CNKI_MCP_SEARCH_ENRICHMENT_LIMIT", 5),
    requestTimeoutMs: getNumber("CNKI_MCP_REQUEST_TIMEOUT_MS", 30000),
    requestRetryCount: getNumber("CNKI_MCP_REQUEST_RETRY_COUNT", 3),
    requestRetryDelayMs: getNumber("CNKI_MCP_REQUEST_RETRY_DELAY_MS", 1000),
    browserChannel: getBrowserChannel(),
    browserHeadless: getBoolean("CNKI_MCP_BROWSER_HEADLESS", true),
    browserUserAgent: process.env.CNKI_MCP_BROWSER_USER_AGENT,
    cnkiBrowserHeadless: getBoolean("CNKI_MCP_CNKI_BROWSER_HEADLESS", false),
    cnkiRuntimeMode: getCnkiRuntimeMode(),
    browserNavigationTimeoutMs: getNumber(
      "CNKI_MCP_BROWSER_NAVIGATION_TIMEOUT_MS",
      45000
    ),
    cnkiAuthTimeoutMs: getNumber("CNKI_MCP_CNKI_AUTH_TIMEOUT_MS", 10 * 60 * 1000),
    cnkiStatePath: resolve(authDir, "cnki.json"),
    geophysicsStatePath: resolve(authDir, "geophysics.json"),
    geophysicsIssn: process.env.CNKI_MCP_GEOPHYSICS_ISSN ?? "0016-8033",
    petrophysicsIssn: process.env.CNKI_MCP_PETROPHYSICS_ISSN ?? "1529-9074",
    unpaywallEmail: process.env.CNKI_MCP_UNPAYWALL_EMAIL,
    openAlexMailto: process.env.CNKI_MCP_OPENALEX_MAILTO,
    userAgent:
      process.env.CNKI_MCP_USER_AGENT ??
      "geoscholar-mcp/0.1.0 (+https://modelcontextprotocol.io)"
  };
}

function findDotenvPath(): string | undefined {
  const candidates = [
    explicitBaseDir ? resolve(explicitBaseDir, ".env") : undefined,
    resolve(projectRoot, ".env"),
    resolve(process.cwd(), ".env")
  ].filter((candidate, index, all): candidate is string =>
    Boolean(candidate) && all.indexOf(candidate) === index
  );

  return candidates.find((candidate) => existsSync(candidate));
}
