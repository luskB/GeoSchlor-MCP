import { appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import { AppConfig } from "../config.js";
import { ensureDir } from "./files.js";

export interface DiagnosticLogEntry {
  scope: string;
  event: string;
  message: string;
  details?: Record<string, unknown>;
}

export async function writeDiagnosticLog(
  config: AppConfig,
  entry: DiagnosticLogEntry
): Promise<void> {
  try {
    await ensureDir(dirname(config.diagnosticLogPath));
    await appendFile(
      config.diagnosticLogPath,
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        ...entry
      })}\n`,
      "utf8"
    );
  } catch {
    // Diagnostics should never break the main workflow.
  }
}

export function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}
