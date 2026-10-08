import { describe, it, expect } from "vitest";
import { trainDocument, TrainDocumentError } from "@/lib/pipeline/train-document";
import type { Embeddings } from "@/lib/openai/client";
import type { ChatbotRow } from "@/repository/chatbots";
import type { DocumentRow } from "@/repository/documents";
import { fakeDb } from "../../helpers";

const chatbot: ChatbotRow = {
  id: 3, admin_id: 1, created_by: 1, name: "Bot", industry: null, system_prompt: null,
  model_config: { temperature: 0, max_tokens: 1024, model: "gpt-4.1-mini" }, styling: null,
  status: "active", lead_capture_enabled: 0, daily_token_budget: null, rate_limit_per_session: null, rate_limit_per_ip: null, rate_limit_per_token: null,
  allowed_domains: null, widget_token: "tok", max_message_length: null, max_messages_per_conversation: null,
  retrieval_strategy: "traditional_rag", created_at: "x", updated_at: "y",
};

const doc: DocumentRow = {
  id: 7, admin_id: 1, chatbot_id: 3, filename: "f.txt", original_name: "orig.txt",
  mime_type: "text/plain", file_path: "/tmp/orig.txt", file_size: 10, status: "uploaded",
  error_message: null, llamacloud_job_id: null, llamacloud_status: null, parsed_text: null,
  chunk_count: null, uploaded_by: 1, created_at: "x", updated_at: "y",
};

const embedder: Embeddings = {
  async embedAsJsonArray() { return "[1.0,2.0]"; },
  async embedBatchAsJsonArray(texts: string[]) { return texts.map(() => "[1.0,2.0]"); },
};

function auditActions(calls: { sql: string; values?: unknown[] }[]): string[] {
  return calls.filter((c) => c.sql.includes("INSERT INTO audit_logs")).map((c) => c.values?.[2] as string);
}

describe("trainDocument", () => {
  it("parses → chunks → embeds → indexes and logs train_document", async () => {
    const { db, calls } = fakeDb();
    const llama = { async parseFile() { return { status: "COMPLETED", markdown: "hello world", error: null }; } };
    const result = await trainDocument({ db, llama, embedder, adminId: 1, chatbot, document: doc, userId: 1 });

    expect(result).toEqual({ chunks: 1, strategy: "traditional_rag" });
    expect(calls.some((c) => c.sql.includes("parsed_text = $1"))).toBe(true); // saveParsedText
    expect(calls.some((c) => c.sql.includes("INSERT INTO document_chunks"))).toBe(true);
    expect(calls.some((c) => c.sql.includes("status = 'indexed'"))).toBe(true); // markIndexed
    expect(calls.some((c) => c.sql.includes("INSERT INTO document_strategies"))).toBe(true); // recordStrategy
    expect(auditActions(calls)).toContain("train_document");
  });

  it("marks failed (no audit) when the parse reports FAILED", async () => {
    const { db, calls } = fakeDb();
    const llama = { async parseFile() { return { status: "FAILED", markdown: null, error: "boom" }; } };
    await expect(trainDocument({ db, llama, embedder, adminId: 1, chatbot, document: doc, userId: 1 }))
      .rejects.toThrow("Document parsing failed: boom");
    expect(auditActions(calls)).not.toContain("train_document_failed"); // expected failure, no audit
    expect(calls.some((c) => c.sql.includes("SET status = $1") && c.values?.[0] === "failed")).toBe(true);
  });

  it("audits train_document_failed on an unexpected exception", async () => {
    const { db, calls } = fakeDb();
    const llama = { async parseFile() { throw new Error("network down"); } };
    await expect(trainDocument({ db, llama, embedder, adminId: 1, chatbot, document: doc, userId: 1 }))
      .rejects.toThrow("network down");
    expect(auditActions(calls)).toContain("train_document_failed");
  });

  it("rejects empty documents as a TrainDocumentError", async () => {
    const { db } = fakeDb();
    const llama = { async parseFile() { return { status: "COMPLETED", markdown: "", error: null }; } };
    await expect(trainDocument({ db, llama, embedder, adminId: 1, chatbot, document: doc, userId: 1 }))
      .rejects.toBeInstanceOf(TrainDocumentError);
  });

  it("builds a PageIndex tree for page_index documents", async () => {
    const { db, calls } = fakeDb();
    const llama = { async parseFile() { return { status: "COMPLETED", markdown: "# Intro\nFirst line\n\n## Details\nMore.\n", error: null }; } };
    const result = await trainDocument({
      db, llama, embedder, adminId: 1,
      chatbot: { ...chatbot, retrieval_strategy: "page_index" },
      document: doc, userId: 1,
    });
    expect(result.strategy).toBe("page_index");
    expect(result.chunks).toBeGreaterThan(0);
    expect(calls.some((c) => c.sql.includes("INSERT INTO document_page_index"))).toBe(true);
    expect(calls.some((c) => c.sql.includes("FROM document_page_index WHERE document_id"))).toBe(true); // markPageIndexed
    expect(calls.some((c) => c.sql.includes("INSERT INTO document_strategies"))).toBe(true);
  });

  it("marks page_index failed + no audit when no sections extracted", async () => {
    const { db, calls } = fakeDb();
    const llama = { async parseFile() { return { status: "COMPLETED", markdown: "", error: null }; } };
    await expect(
      trainDocument({ db, llama, embedder, adminId: 1, chatbot: { ...chatbot, retrieval_strategy: "page_index" }, document: doc, userId: 1 }),
    ).rejects.toThrow("No sections could be extracted from the document.");
    expect(auditActions(calls)).not.toContain("train_document_failed");
  });

  it("reuses stored parsed_text (no re-parse) and clears the prior index on reprocess", async () => {
    const { db, calls } = fakeDb();
    let parsed = false;
    const llama = { async parseFile() { parsed = true; return { status: "COMPLETED", markdown: "unused", error: null }; } };
    const reusedDoc = { ...doc, parsed_text: "already parsed body" };
    const result = await trainDocument({ db, llama, embedder, adminId: 1, chatbot, document: reusedDoc, userId: 1 });

    expect(result).toEqual({ chunks: 1, strategy: "traditional_rag" });
    expect(parsed).toBe(false); // skip LlamaCloud parse
    expect(calls.some((c) => c.sql.includes("DELETE FROM document_chunks"))).toBe(true);
    expect(calls.some((c) => c.sql.includes("DELETE FROM document_page_index"))).toBe(true);
  });
});