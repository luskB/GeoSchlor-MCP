import { DownloadJob } from "../types.js";
import { readJsonIfExists, writeJson } from "../utils/files.js";

export class JobStore {
  private readonly jobs = new Map<string, DownloadJob>();

  constructor(private readonly path: string) {}

  async initialize(): Promise<void> {
    const saved = await readJsonIfExists<DownloadJob[]>(this.path);
    for (const job of saved ?? []) {
      this.jobs.set(job.id, job);
    }
  }

  list(): DownloadJob[] {
    return [...this.jobs.values()].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    );
  }

  get(id: string): DownloadJob | null {
    return this.jobs.get(id) ?? null;
  }

  async upsert(job: DownloadJob): Promise<void> {
    this.jobs.set(job.id, job);
    await this.flush();
  }

  private async flush(): Promise<void> {
    await writeJson(this.path, this.list());
  }
}
