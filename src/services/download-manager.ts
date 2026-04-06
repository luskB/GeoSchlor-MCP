import { resolve } from "node:path";
import PQueue from "p-queue";
import { JobStore } from "../storage/job-store.js";
import { DownloadAttempt, DownloadCandidate, DownloadFormat, DownloadJob, DownloadJobStatus, SourceId, ArticleRecord } from "../types.js";
import { safeFileName } from "../utils/text.js";
import { sha1 } from "../utils/hash.js";
import { SearchService, RecordLocator } from "./search-service.js";

export interface DownloadRequest extends RecordLocator {
  source: SourceId;
  outputDir?: string;
}

export class DownloadManager {
  private readonly queue = new PQueue({ concurrency: 2 });

  constructor(
    private readonly searchService: SearchService,
    private readonly jobStore: JobStore
  ) {}

  async downloadNow(request: DownloadRequest): Promise<DownloadJob> {
    const job = await this.createJob(request);
    return this.executeJob(job, request);
  }

  async queueDownload(request: DownloadRequest): Promise<DownloadJob> {
    const job = await this.createJob(request);
    void this.queue.add(async () => {
      await this.executeJob(job, request);
    });
    return job;
  }

  listJobs(limit = 20): DownloadJob[] {
    return this.jobStore.list().slice(0, limit);
  }

  getJob(id: string): DownloadJob | null {
    return this.jobStore.get(id);
  }

  private async createJob(request: DownloadRequest): Promise<DownloadJob> {
    const locatorKey = request.recordId ?? request.doi ?? request.detailUrl ?? "unknown";
    const timestamp = new Date().toISOString();
    const outputDir =
      request.outputDir ?? this.searchService.getProviderContext().config.downloadDir;
    const job: DownloadJob = {
      id: sha1(`${request.source}:${locatorKey}:${timestamp}`),
      source: request.source,
      recordId: request.recordId ?? locatorKey,
      title: request.recordId ?? request.doi ?? request.detailUrl ?? "pending",
      status: "queued",
      outputDir,
      createdAt: timestamp,
      updatedAt: timestamp,
      attempts: []
    };
    await this.jobStore.upsert(job);
    return job;
  }

  private async executeJob(
    job: DownloadJob,
    request: DownloadRequest
  ): Promise<DownloadJob> {
    const record = await this.searchService.resolveRecord(request.source, request);
    if (!record) {
      return this.finishJob(job, "failed", undefined, "Unable to resolve the requested record.");
    }

    job.title = record.title;
    job.recordId = record.id;
    job.status = "running";
    job.updatedAt = new Date().toISOString();
    await this.jobStore.upsert(job);

    const provider = this.searchService.getProvider(request.source);
    const context = this.searchService.getProviderContext();
    const candidates = await provider.resolveDownload(record, context);
    if (!candidates.length) {
      return this.finishJob(
        job,
        "failed",
        undefined,
        record.access === "subscription"
          ? "No open-access download candidate was found. This record appears to require publisher or institutional access."
          : "No downloadable candidate was found for this record."
      );
    }

    let authWasRequired = false;

    for (const candidate of candidates) {
      const attempt = beginAttempt(candidate);
      job.attempts.push(attempt);
      await this.jobStore.upsert(job);

      if (candidate.requiresAuth && !context.browser.hasState(request.source)) {
        authWasRequired = true;
        completeAttempt(
          attempt,
          "skipped",
          `This source needs a saved browser session. Run npm run auth:${request.source}.`
        );
        await this.jobStore.upsert(job);
        continue;
      }

      const destinationPath = buildDestinationPath(job.outputDir, record, candidate.format);
      const result =
        candidate.method === "http"
          ? await tryHttpDownload(context, request.source, candidate, destinationPath)
          : await context.browser.downloadWithSession(
              request.source,
              candidate.url,
              destinationPath,
              { referer: candidate.referer }
            );

      if (result.success) {
        completeAttempt(attempt, "success", result.message);
        job.filePath = destinationPath;
        return this.finishJob(job, "completed", destinationPath);
      }

      if (candidate.requiresAuth) {
        authWasRequired = true;
      }
      completeAttempt(attempt, "failed", result.message);
      await this.jobStore.upsert(job);
    }

    return this.finishJob(
      job,
      authWasRequired ? "needs_auth" : "failed",
      undefined,
      authWasRequired
        ? `All download attempts failed. Refresh the saved browser session for ${request.source}.`
        : "All download attempts failed."
    );
  }

  private async finishJob(
    job: DownloadJob,
    status: DownloadJobStatus,
    filePath?: string,
    error?: string
  ): Promise<DownloadJob> {
    job.status = status;
    job.filePath = filePath;
    job.error = error;
    job.updatedAt = new Date().toISOString();
    await this.jobStore.upsert(job);
    return job;
  }
}

async function tryHttpDownload(
  context: ReturnType<SearchService["getProviderContext"]>,
  source: SourceId,
  candidate: DownloadCandidate,
  destinationPath: string
): Promise<{ success: boolean; message: string }> {
  if (candidate.requiresAuth) {
    return context.browser.downloadWithSessionHttp(source, candidate.url, destinationPath, {
      referer: candidate.referer,
      headers: candidate.headers
    });
  }

  const response = await context.http.downloadToFile(candidate.url, destinationPath, {
    headers: {
      ...(candidate.referer ? { referer: candidate.referer } : {}),
      ...(candidate.headers ?? {})
    }
  });

  if (!response.ok) {
    return {
      success: false,
      message: `HTTP download failed with status ${response.status} for ${candidate.url}`
    };
  }

  if (!looksLikeDocument(response.buffer, response.contentType, candidate.format, candidate.url)) {
    return {
      success: false,
      message: `The server returned a non-document response for ${candidate.url}`
    };
  }

  return {
    success: true,
    message: `Downloaded with HTTP from ${candidate.url}`
  };
}

function looksLikeDocument(
  body: Buffer,
  contentType: string,
  format: DownloadFormat,
  url: string
): boolean {
  const text = /html|text/i.test(contentType) ? body.toString("utf8") : "";
  if (
    text.includes("安全验证") ||
    text.includes("Just a moment") ||
    text.includes("captcha")
  ) {
    return false;
  }

  if (format === "pdf") {
    return /pdf/i.test(contentType) || body.subarray(0, 4).toString() === "%PDF";
  }

  if (format === "caj") {
    return body.length > 1024 && !/html|text/i.test(contentType);
  }

  return body.length > 1024 && (!/html|text/i.test(contentType) || /\.pdf($|\?)/i.test(url));
}

function buildDestinationPath(
  outputDir: string,
  record: ArticleRecord,
  format: DownloadFormat
): string {
  const extension = format === "caj" ? "caj" : "pdf";
  const yearSuffix = record.year ? `_${record.year}` : "";
  return resolve(outputDir, `${safeFileName(record.title)}${yearSuffix}.${extension}`);
}

function beginAttempt(candidate: DownloadCandidate): DownloadAttempt {
  return {
    candidateId: candidate.id,
    label: candidate.label,
    method: candidate.method,
    url: candidate.url,
    startedAt: new Date().toISOString(),
    status: "skipped"
  };
}

function completeAttempt(
  attempt: DownloadAttempt,
  status: DownloadAttempt["status"],
  message: string
): void {
  attempt.status = status;
  attempt.message = message;
  attempt.finishedAt = new Date().toISOString();
}
