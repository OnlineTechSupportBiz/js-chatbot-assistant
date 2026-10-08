import { describe, it, expect } from "vitest";
import { createDocument, recordStrategy, markIndexed, deleteDocument } from "@/repository/documents";
import { fakeDb } from "../helpers";

describe("documents repository", () => {
  it("createDocument inserts with status default 'uploaded'", async () => {
    const { db, calls } = fakeDb(() => [{ id: 11 }]);
    const id = await createDocument(db, {
      adminId: 1, chatbotId: 3, filename: "stored.pdf", originalName: "orig.pdf",
      mimeType: "application/pdf", filePath: "/tmp/x", fileSize: 123, uploadedBy: 1,
    });
    expect(id).toBe(11);
    expect(calls[0].values).toEqual([1, 3, "stored.pdf", "orig.pdf", "application/pdf", "/tmp/x", 123, "uploaded", 1]);
  });

  it("recordStrategy upserts on document_id", async () => {
    const { db, calls } = fakeDb();
    await recordStrategy(db, 1, 3, 11, "orig.pdf", "traditional_rag");
    expect(calls[0].sql).toContain("ON CONFLICT (document_id) DO UPDATE SET strategy = $5");
    expect(calls[0].values).toEqual([1, 3, 11, "orig.pdf", "traditional_rag"]);
  });

  it("markIndexed sets chunk_count from document_chunks", async () => {
    const { db, calls } = fakeDb();
    await markIndexed(db, 11);
    expect(calls[0].sql).toContain("chunk_count = (SELECT COUNT(*) FROM document_chunks WHERE document_id = $1)");
    expect(calls[0].sql).toContain("status = 'indexed'");
  });

  it("deleteDocument removes chunks, page-index nodes, and the doc", async () => {
    const { db, calls } = fakeDb();
    await deleteDocument(db, 11);
    expect(calls.map((c) => c.sql)).toEqual([
      expect.stringContaining("DELETE FROM document_chunks"),
      expect.stringContaining("DELETE FROM document_page_index"),
      expect.stringContaining("DELETE FROM documents WHERE id = $1"),
    ]);
  });
});