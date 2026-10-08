import { readFile } from "node:fs/promises";
import { basename } from "node:path";

/**
 * LlamaParseClient — port of PHP `Service/LlamaParseClient` (LlamaCloud Parse REST API).
 * The pipeline depends on the narrow `LlamaParse` interface so tests inject a fake.
 */

export interface ParseResult {
  job_id?: string;
  markdown: string | null;
  status: string;
  error: string | null;
}

export interface LlamaParse {
  parseFile(filePath: string | null, mimeType: string | null, tier?: string, maxPollSeconds?: number): Promise<ParseResult>;
}

/**
 * Extract {status, markdown, error_message} from a LlamaCloud poll response,
 * handling the several markdown shapes the API may return (top-level string,
 * result.markdown, or markdown.pages[]). Pure so it can be unit-tested.
 */
export function parsePollResult(data: Record<string, unknown>): {
  status: string;
  markdown: string | null;
  error_message: string | null;
} {
  const job = (data.job ?? {}) as Record<string, unknown>;
  const status = (job.status as string) ?? "PENDING";
  const errorMessage = (job.error_message as string | null) ?? null;

  let markdown = "";
  if (typeof data.markdown === "string") {
    markdown = data.markdown;
  } else {
    const result = data.result as Record<string, unknown> | undefined;
    if (result && typeof result.markdown === "string") {
      markdown = result.markdown;
    } else if (data.markdown && typeof data.markdown === "object") {
      const pages = (data.markdown as Record<string, unknown>).pages;
      if (Array.isArray(pages)) {
        markdown = pages
          .map((p) => (p as Record<string, unknown>).markdown)
          .filter((m): m is string => typeof m === "string")
          .join("\n\n");
      }
    }
  }
  if (markdown === "") {
    const result = data.result as Record<string, unknown> | undefined;
    markdown = (result?.text as string) ?? (data.text as string) ?? "";
  }

  return { status, markdown: markdown || null, error_message: errorMessage };
}

export class LlamaParseClient implements LlamaParse {
  private readonly baseUrl: string;

  constructor(private readonly apiKey: string, baseUrl = "https://api.cloud.llamaindex.ai") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Accept: "application/json", Authorization: `Bearer ${this.apiKey}`, ...extra };
  }

  async uploadFile(filePath: string, mimeType: string): Promise<string> {
    const data = await readFile(filePath);
    const form = new FormData();
    form.append("purpose", "parse");
    form.append("file", new Blob([data], { type: mimeType }), basename(filePath));

    const resp = await fetch(`${this.baseUrl}/api/v1/beta/files`, {
      method: "POST",
      headers: this.headers(),
      body: form,
    });

    if (!resp.ok) {
      throw new Error(`LlamaParse upload failed (HTTP ${resp.status})`);
    }
    const body = (await resp.json()) as { id?: string };
    if (!body.id) {
      throw new Error("LlamaParse upload: missing file ID in response");
    }
    return body.id;
  }

  async startParseJob(fileId: string, tier = "cost_effective"): Promise<{ job_id: string; status: string }> {
    const resp = await fetch(`${this.baseUrl}/api/v2/parse`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ file_id: fileId, tier, version: "latest" }),
    });

    if (!resp.ok) {
      throw new Error(`LlamaParse start job failed (HTTP ${resp.status})`);
    }
    const body = (await resp.json()) as { id?: string; status?: string };
    if (!body.id) {
      throw new Error("LlamaParse start job: missing job ID in response");
    }
    return { job_id: body.id, status: body.status ?? "PENDING" };
  }

  async pollJob(jobId: string): Promise<{ status: string; markdown: string | null; error_message: string | null }> {
    const resp = await fetch(`${this.baseUrl}/api/v2/parse/${encodeURIComponent(jobId)}?expand=markdown`, {
      headers: this.headers(),
    });

    if (!resp.ok) {
      return { status: "FAILED", markdown: null, error_message: `HTTP ${resp.status}` };
    }

    const data = (await resp.json()) as Record<string, unknown>;
    return parsePollResult(data);
  }

  async parseFile(filePath: string | null, mimeType: string | null, tier = "cost_effective", maxPollSeconds = 600): Promise<ParseResult> {
    if (!filePath) {
      return { markdown: null, status: "FAILED", error: "No file path" };
    }
    const fileId = await this.uploadFile(filePath, mimeType ?? "application/octet-stream");
    const job = await this.startParseJob(fileId, tier);
    const jobId = job.job_id;

    const start = Date.now();
    while (true) {
      if ((Date.now() - start) / 1000 > maxPollSeconds) {
        return { job_id: jobId, markdown: null, status: "TIMEOUT", error: `Poll timed out after ${maxPollSeconds}s` };
      }
      await new Promise((r) => setTimeout(r, 2000));
      const result = await this.pollJob(jobId);

      if (result.status === "COMPLETED") {
        return { job_id: jobId, markdown: result.markdown, status: "COMPLETED", error: null };
      }
      if (result.status === "FAILED") {
        return { job_id: jobId, markdown: null, status: "FAILED", error: result.error_message ?? "Parse job failed" };
      }
      // PENDING or RUNNING — keep polling
    }
  }
}