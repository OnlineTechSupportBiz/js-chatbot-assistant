import { describe, it, expect } from "vitest";
import { reembedDocument } from "@/lib/pipeline/reembed-document";
import type { Embeddings } from "@/lib/openai/client";
import { fakeDb } from "../../helpers";

const okEmbedder: Embeddings = {
  async embedAsJsonArray() { return "[1.0]"; },
  async embedBatchAsJsonArray(t: string[]) { return t.map(() => "[1.0]"); },
};

describe("reembedDocument", () => {
  it("re-embeds existing chunks and marks the job complete", async () => {
    const { db, calls } = fakeDb((sql: string) => {
      if (sql.includes("SELECT id, chunk_text FROM document_chunks")) {
        return [{ id: 1, chunk_text: "a" }, { id: 2, chunk_text: "b" }];
      }
      return [];
    });
    await reembedDocument(db, 7, 9, okEmbedder);
    expect(calls.some((c) => c.sql.includes("UPDATE document_chunks SET embedding"))).toBe(true);
    expect(calls.some((c) => c.sql.includes("UPDATE document_jobs SET status = 'completed'"))).toBe(true);
  });

  it("marks the job complete when there is nothing to re-embed", async () => {
    const { db, calls } = fakeDb(() => []);
    await reembedDocument(db, 7, 9, okEmbedder);
    expect(calls.some((c) => c.sql.includes("UPDATE document_jobs SET status = 'completed'"))).toBe(true);
    expect(calls.some((c) => c.sql.includes("UPDATE document_chunks SET embedding"))).toBe(false);
  });
});