import { describe, it, expect } from "vitest";
import { processDocumentJob } from "@/lib/pipeline/process-job";
import type { LlamaParse } from "@/lib/llamaparse/client";
import type { Embeddings } from "@/lib/openai/client";
import { fakeDb } from "../../helpers";

const doc = {
  id: 7, admin_id: 1, chatbot_id: 3, filename: "f.txt", original_name: "orig.txt",
  mime_type: "text/plain", file_path: "/tmp/f.txt", file_size: 10, status: "uploaded",
  error_message: null, llamacloud_job_id: null, llamacloud_status: null, parsed_text: null,
  chunk_count: null, uploaded_by: 1, created_at: "x", updated_at: "y",
};

const chatbot = {
  id: 3, admin_id: 1, created_by: 1, name: "Bot", industry: null, system_prompt: null,
  model_config: null, styling: null, status: "active", lead_capture_enabled: 0,
  daily_token_budget: null, rate_limit_per_session: null, allowed_domains: null, widget_token: "t",
  max_message_length: null, max_messages_per_conversation: null, retrieval_strategy: "traditional_rag",
  created_at: "x", updated_at: "y",
};

function keys(openai: string | null, llama: string | null) {
  return { openai_api_key: openai, llamacloud_api_key: llama };
}

function dbWith(opts: { openai?: string | null; llama?: string | null; docFound?: boolean }) {
  const openai = opts.openai === undefined ? "sk" : opts.openai;
  const llama = opts.llama === undefined ? "llk" : opts.llama;
  const { db, calls } = fakeDb((sql: string) => {
    if (sql.includes("SELECT * FROM documents WHERE id = $1")) return opts.docFound === false ? [] : [doc];
    if (sql.includes("SELECT * FROM chatbots WHERE id = $1")) return [chatbot];
    if (sql.includes("SELECT openai_api_key, llamacloud_api_key")) return [keys(openai, llama)];
    return [];
  });
  return { db, calls };
}

const okLlama: LlamaParse = { async parseFile() { return { status: "COMPLETED", markdown: "hello", error: null }; } };
const okEmbedder: Embeddings = {
  async embedAsJsonArray() { return "[1.0]"; },
  async embedBatchAsJsonArray(t: string[]) { return t.map(() => "[1.0]"); },
};

function jobFailures(calls: { sql: string; values?: unknown[] }[]): string[] {
  return calls
    .filter((c) => c.sql.includes("status = 'failed'") && c.sql.includes("document_jobs"))
    .map((c) => c.values?.[0] as string);
}

describe("processDocumentJob", () => {
  it("runs the pipeline and marks the job complete", async () => {
    const { db, calls } = dbWith({});
    await processDocumentJob(
      { makeLlama: () => okLlama, makeEmbedder: () => okEmbedder },
      db,
      { id: 5, document_id: 7 },
    );
    expect(calls.some((c) => c.sql.includes("INSERT INTO document_chunks"))).toBe(true);
    expect(calls.some((c) => c.sql.includes("UPDATE document_jobs SET status = 'completed'"))).toBe(true);
  });

  it("fails the job when the document is missing", async () => {
    const { db, calls } = dbWith({ docFound: false });
    await processDocumentJob({ makeLlama: () => okLlama, makeEmbedder: () => okEmbedder }, db, { id: 5, document_id: 7 });
    expect(jobFailures(calls)).toEqual(["Document not found"]);
  });

  it("fails when LlamaCloud key is missing", async () => {
    const { db, calls } = dbWith({ llama: null });
    await processDocumentJob({ makeLlama: () => okLlama, makeEmbedder: () => okEmbedder }, db, { id: 5, document_id: 7 });
    expect(jobFailures(calls)).toEqual(["LlamaCloud API key not configured"]);
  });

  it("fails when OpenAI/embedding key is missing", async () => {
    const { db, calls } = dbWith({ openai: null });
    await processDocumentJob({ makeLlama: () => okLlama, makeEmbedder: () => okEmbedder }, db, { id: 5, document_id: 7 });
    expect(jobFailures(calls)).toEqual(["OpenAI/embedding API key not configured"]);
  });

  it("marks the job failed when training throws", async () => {
    const { db, calls } = dbWith({});
    const badLlama: LlamaParse = { async parseFile() { throw new Error("net fail"); } };
    await processDocumentJob({ makeLlama: () => badLlama, makeEmbedder: () => okEmbedder }, db, { id: 5, document_id: 7 });
    expect(jobFailures(calls)).toEqual(["net fail"]);
  });
});