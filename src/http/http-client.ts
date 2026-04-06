import { writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { AppConfig } from "../config.js";
import { ensureDir } from "../utils/files.js";

export interface HttpResult {
  ok: boolean;
  status: number;
  contentType: string;
  text: string;
  buffer: Buffer;
  url: string;
}

export class HttpClient {
  constructor(private readonly config: AppConfig) {}

  async getJson<T>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await this.request(url, {
      ...init,
      headers: {
        Accept: "application/json",
        ...this.defaultHeaders(),
        ...(init.headers ?? {})
      }
    });
    return JSON.parse(response.text) as T;
  }

  async getText(url: string, init: RequestInit = {}): Promise<string> {
    const response = await this.request(url, {
      ...init,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        ...this.defaultHeaders(),
        ...(init.headers ?? {})
      }
    });
    return response.text;
  }

  async downloadToFile(
    url: string,
    destinationPath: string,
    init: RequestInit = {}
  ): Promise<HttpResult> {
    const response = await this.request(url, {
      ...init,
      headers: {
        Accept: "application/pdf,application/octet-stream,*/*",
        ...this.defaultHeaders(),
        ...(init.headers ?? {})
      }
    });
    await ensureDir(dirname(destinationPath));
    await writeFile(destinationPath, response.buffer);
    return response;
  }

  async request(url: string, init: RequestInit = {}): Promise<HttpResult> {
    let lastError: unknown;

    for (let attempt = 0; attempt < this.config.requestRetryCount; attempt += 1) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          this.config.requestTimeoutMs
        );

        const response = await fetch(url, {
          ...init,
          signal: controller.signal
        });
        clearTimeout(timeout);

        const buffer = Buffer.from(await response.arrayBuffer());
        const contentType = response.headers.get("content-type") ?? "";
        const text = isTextLike(contentType) ? buffer.toString("utf8") : "";

        if (response.ok) {
          return {
            ok: true,
            status: response.status,
            contentType,
            text,
            buffer,
            url: response.url
          };
        }

        if (!shouldRetry(response.status) || attempt === this.config.requestRetryCount - 1) {
          return {
            ok: false,
            status: response.status,
            contentType,
            text,
            buffer,
            url: response.url
          };
        }
      } catch (error) {
        lastError = error;
        if (attempt === this.config.requestRetryCount - 1) {
          break;
        }
      }

      await sleep(this.config.requestRetryDelayMs * (attempt + 1));
    }

    throw new Error(
      `Request failed for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`
    );
  }

  private defaultHeaders(): Record<string, string> {
    return {
      "user-agent": this.config.userAgent,
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8"
    };
  }
}

function isTextLike(contentType: string): boolean {
  return /(json|text|xml|html|javascript)/i.test(contentType);
}

function shouldRetry(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
