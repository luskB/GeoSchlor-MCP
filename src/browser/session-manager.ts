import { existsSync, readFileSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  chromium,
  request as playwrightRequest,
  type APIRequestContext,
  type BrowserContext,
  type Page
} from "playwright";
import { AppConfig } from "../config.js";
import { AuthStatus, SourceId } from "../types.js";
import { ensureDir } from "../utils/files.js";

interface DownloadOptions {
  referer?: string;
  headers?: Record<string, string>;
}

interface SessionRequestOptions extends DownloadOptions {
  method?: "GET" | "POST";
  form?: Record<string, string>;
  data?: string;
  accept?: string;
}

interface DownloadResult {
  success: boolean;
  message: string;
  contentType?: string;
}

interface SessionRequestResult {
  ok: boolean;
  status: number;
  contentType: string;
  text: string;
  buffer: Buffer;
  url: string;
  headers: Record<string, string>;
}

interface CnkiCookieSignal {
  domain: string;
  name: string;
}

const CNKI_AUTH_COOKIE_NAMES = new Set([
  "Ecp_LoginStuts",
  "LID",
  "c_m_LinID",
  "Ecp_session"
]);

const CNKI_AUTH_POLL_INTERVAL_MS = 1000;

export class BrowserSessionManager {
  constructor(private readonly config: AppConfig) {}

  getAuthStatus(source: SourceId): AuthStatus {
    const statePath = this.getStatePath(source);
    if (source === "cnki" && existsSync(statePath)) {
      const savedCookies = readSavedCnkiCookies(statePath);
      if (savedCookies && hasCnkiAuthCookies(savedCookies)) {
        return {
          source,
          configured: true,
          statePath,
          notes: ["Saved CNKI browser state with detected login cookies found."]
        };
      }

      return {
        source,
        configured: false,
        statePath,
        notes: [
          "A CNKI browser state file exists, but no CNKI login cookies were detected.",
          'Run "npm run auth:cnki" again and complete the full CNKI login flow before the browser closes.'
        ]
      };
    }

    const missingNotes = getDefaultAuthNotes(source);

    return {
      source,
      configured: existsSync(statePath),
      statePath,
      notes: existsSync(statePath)
        ? ["Saved browser state found."]
        : missingNotes
    };
  }

  hasState(source: SourceId): boolean {
    return this.hasUsableState(source, this.getStatePath(source));
  }

  getStateVersion(source: SourceId): string {
    const statePath = this.getStatePath(source);
    if (!this.hasUsableState(source, statePath)) {
      return "missing";
    }

    try {
      const stat = statSync(statePath);
      return `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
    } catch {
      return "available";
    }
  }

  async withPage<T>(
    source: SourceId,
    action: (page: Page) => Promise<T>,
    options: { headless?: boolean } = {}
  ): Promise<T> {
    return this.withContext(
      source,
      async (context) => {
        const page = await context.newPage();
        page.setDefaultNavigationTimeout(this.config.browserNavigationTimeoutMs);
        return action(page);
      },
      options
    );
  }

  async requestWithSession(
    source: SourceId,
    url: string,
    options: SessionRequestOptions = {}
  ): Promise<SessionRequestResult> {
    return this.withRequestContext(source, async (requestContext) => {
      const headers = {
        ...(options.accept ? { accept: options.accept } : {}),
        ...(options.referer ? { referer: options.referer } : {}),
        ...(options.headers ?? {})
      };
      const requestOptions = {
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
        failOnStatusCode: false
      };
      const method = options.method ?? (options.form || options.data ? "POST" : "GET");
      const response =
        method === "POST"
          ? await requestContext.post(url, {
              ...requestOptions,
              ...(options.form ? { form: options.form } : {}),
              ...(options.data ? { data: options.data } : {})
            })
          : await requestContext.get(url, requestOptions);

      const buffer = Buffer.from(await response.body());
      const contentType = response.headers()["content-type"] ?? "";
      return {
        ok: response.ok(),
        status: response.status(),
        contentType,
        text: isTextLike(contentType) ? buffer.toString("utf8") : "",
        buffer,
        url: response.url(),
        headers: response.headers()
      };
    });
  }

  async downloadWithSessionHttp(
    source: SourceId,
    url: string,
    destinationPath: string,
    options: DownloadOptions = {}
  ): Promise<DownloadResult> {
    const response = await this.requestWithSession(source, url, {
      accept: "application/pdf,application/octet-stream,*/*",
      referer: options.referer,
      headers: options.headers
    });

    if (
      response.ok &&
      looksLikeDocument(response.buffer, response.contentType, url) &&
      !looksLikeChallenge(response.buffer, response.contentType)
    ) {
      await ensureDir(dirname(destinationPath));
      await writeFile(destinationPath, response.buffer);
      return {
        success: true,
        message: `Downloaded with saved session HTTP from ${url}`,
        contentType: response.contentType
      };
    }

    return {
      success: false,
      message: `Saved session HTTP request failed with status ${response.status} for ${url}`,
      contentType: response.contentType
    };
  }

  async downloadWithSession(
    source: SourceId,
    url: string,
    destinationPath: string,
    options: DownloadOptions = {}
  ): Promise<DownloadResult> {
    return this.withContext(source, async (context) => {
      const response = await context.request.get(url, {
        headers: {
          ...(options.referer ? { referer: options.referer } : {})
        },
        failOnStatusCode: false
      });

      const body = Buffer.from(await response.body());
      const contentType = response.headers()["content-type"] ?? "";
      if (
        response.ok() &&
        looksLikeDocument(body, contentType, url) &&
        !looksLikeChallenge(body, contentType)
      ) {
        await ensureDir(dirname(destinationPath));
        await writeFile(destinationPath, body);
        return {
          success: true,
          message: `Downloaded with browser session from ${url}`,
          contentType
        };
      }

      return {
        success: false,
        message: `Browser session request failed with status ${response.status()} for ${url}`,
        contentType
      };
    });
  }

  async bootstrap(source: SourceId, startUrl: string): Promise<string> {
    const browser = await chromium.launch({
      headless: false,
      channel:
        this.config.browserChannel === "chromium"
          ? undefined
          : this.config.browserChannel
    });

    const context = await browser.newContext({
      acceptDownloads: true,
      ...(this.getBrowserUserAgent()
        ? {
            userAgent: this.getBrowserUserAgent()
          }
        : {})
    });

    try {
      const page = await context.newPage();
      page.setDefaultNavigationTimeout(this.config.browserNavigationTimeoutMs);
      await page.goto(startUrl, { waitUntil: "domcontentloaded" });

      if (source === "cnki") {
        process.stdout.write(
          [
            "",
            "Opened cnki in a browser window.",
            "Complete the CNKI login flow, including campus SSO or captcha if prompted.",
            `The session will be saved automatically after login is detected (up to ${formatDuration(this.config.cnkiAuthTimeoutMs)}).`,
            ""
          ].join("\n")
        );

        await this.waitForCnkiLogin(context);
        process.stdout.write("Detected CNKI login session. Saving browser state...\n");
      } else {
        process.stdout.write(
          [
            "",
            `Opened ${source} in a browser window.`,
            "Log in and complete any captcha or challenge there.",
            "Press Enter in this terminal to save the session and close the browser.",
            ""
          ].join("\n")
        );

        await waitForEnter();
      }

      const path = this.getStatePath(source);
      await ensureDir(this.config.authDir);
      await context.storageState({ path });
      return path;
    } finally {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }

  private async withContext<T>(
    source: SourceId,
    action: (context: BrowserContext) => Promise<T>,
    options: { headless?: boolean } = {}
  ): Promise<T> {
    const browser = await chromium.launch({
      headless: options.headless ?? this.getDefaultHeadless(source),
      channel:
        this.config.browserChannel === "chromium"
          ? undefined
          : this.config.browserChannel
    });

    const statePath = this.getStatePath(source);
    const context = await browser.newContext({
      acceptDownloads: true,
      storageState: this.hasUsableState(source, statePath) ? statePath : undefined,
      ...(this.getBrowserUserAgent()
        ? {
            userAgent: this.getBrowserUserAgent()
          }
        : {})
    });

    try {
      return await action(context);
    } finally {
      await context.close();
      await browser.close();
    }
  }

  private async withRequestContext<T>(
    source: SourceId,
    action: (requestContext: APIRequestContext) => Promise<T>
  ): Promise<T> {
    const statePath = this.getStatePath(source);
    const requestContext = await playwrightRequest.newContext({
      storageState: this.hasUsableState(source, statePath) ? statePath : undefined,
      extraHTTPHeaders: {
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8"
      }
    });

    try {
      return await action(requestContext);
    } finally {
      await requestContext.dispose();
    }
  }

  private getStatePath(source: SourceId): string {
    switch (source) {
      case "cnki":
        return this.config.cnkiStatePath;
      case "geophysics":
        return this.config.geophysicsStatePath;
      default:
        return resolve(this.config.authDir, `${source}.json`);
    }
  }

  private getDefaultHeadless(source: SourceId): boolean {
    if (source === "cnki") {
      return this.config.cnkiBrowserHeadless;
    }
    return this.config.browserHeadless;
  }

  private hasUsableState(source: SourceId, statePath: string): boolean {
    if (!existsSync(statePath)) {
      return false;
    }

    if (source !== "cnki") {
      return true;
    }

    const savedCookies = readSavedCnkiCookies(statePath);
    return Boolean(savedCookies && hasCnkiAuthCookies(savedCookies));
  }

  private getBrowserUserAgent(): string | undefined {
    const configured =
      this.config.browserUserAgent ??
      (looksLikeBrowserUserAgent(this.config.userAgent) ? this.config.userAgent : undefined);

    return configured ? configured : undefined;
  }

  private async waitForCnkiLogin(context: BrowserContext): Promise<void> {
    const deadline = Date.now() + this.config.cnkiAuthTimeoutMs;

    while (Date.now() < deadline) {
      if (await this.isCnkiLoginDetected(context)) {
        return;
      }
      await delay(CNKI_AUTH_POLL_INTERVAL_MS);
    }

    throw new Error(
      `Timed out after ${formatDuration(this.config.cnkiAuthTimeoutMs)} while waiting for CNKI login to be detected. No browser state was saved.`
    );
  }

  private async isCnkiLoginDetected(context: BrowserContext): Promise<boolean> {
    const cookies = await context.cookies();
    return hasCnkiAuthCookies(
      cookies.map((cookie) => ({ domain: cookie.domain, name: cookie.name }))
    );
  }
}

function getDefaultAuthNotes(source: SourceId): string[] {
  switch (source) {
    case "geophysics":
      return [
        "No saved browser state found.",
        "GEOPHYSICS search does not require login.",
        "A saved session is only optional if you already have publisher or institutional access and want to try the publisher page directly."
      ];
    case "petrophysics":
    case "onepetro":
      return [
        "No saved browser state found.",
        `${source.toUpperCase()} search uses public metadata and does not require login by default.`
      ];
    case "wanfang":
    case "vip":
      return [
        "No saved browser state found.",
        `${source === "wanfang" ? "Wanfang" : "CQVIP"} search works without login.`,
        `A saved session is only optional if you already have access and want to try protected download flows via "npm run auth:${source}".`
      ];
    case "cnki":
    default:
      return [
        "No saved browser state found.",
        `Run "npm run auth:${source}" before protected search or download flows.`
      ];
  }
}

export function hasCnkiAuthCookies(cookies: CnkiCookieSignal[]): boolean {
  const matchedNames = new Set(
    cookies
      .filter(
        (cookie) =>
          isCnkiHost(cookie.domain) && CNKI_AUTH_COOKIE_NAMES.has(cookie.name)
      )
      .map((cookie) => cookie.name)
  );

  return matchedNames.has("Ecp_LoginStuts") || matchedNames.size >= 2;
}

function isCnkiHost(hostOrDomain: string): boolean {
  const normalized = hostOrDomain.replace(/^\./, "").toLowerCase();
  return normalized === "cnki.net" || normalized.endsWith(".cnki.net");
}

function readSavedCnkiCookies(statePath: string): CnkiCookieSignal[] | null {
  try {
    const raw = JSON.parse(readFileSync(statePath, "utf8")) as {
      cookies?: Array<{ domain?: string; name?: string }>;
    };
    return (raw.cookies ?? [])
      .filter(
        (cookie): cookie is { domain: string; name: string } =>
          typeof cookie.domain === "string" && typeof cookie.name === "string"
      )
      .map((cookie) => ({ domain: cookie.domain, name: cookie.name }));
  } catch {
    return null;
  }
}

function looksLikeDocument(
  body: Buffer,
  contentType: string,
  url: string
): boolean {
  if (/pdf/i.test(contentType) || body.subarray(0, 4).toString() === "%PDF") {
    return true;
  }

  if (/octet-stream|caj/i.test(contentType) || /\.caj($|\?)/i.test(url)) {
    return body.length > 1024;
  }

  return false;
}

function looksLikeChallenge(body: Buffer, contentType: string): boolean {
  if (!/html|text/i.test(contentType)) {
    return false;
  }

  const text = body.toString("utf8");
  return (
    text.includes("安全验证") ||
    text.includes("Just a moment") ||
    text.includes("cf-mitigated") ||
    text.includes("captcha")
  );
}

function isTextLike(contentType: string): boolean {
  return /(json|text|xml|html|javascript)/i.test(contentType);
}

function looksLikeBrowserUserAgent(value: string): boolean {
  return /(mozilla|chrome|safari|firefox|edg)/i.test(value);
}

function formatDuration(durationMs: number): string {
  if (durationMs % 60000 === 0) {
    const minutes = durationMs / 60000;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  const seconds = Math.ceil(durationMs / 1000);
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => {
      process.stdin.pause();
      resolve();
    });
  });
}
