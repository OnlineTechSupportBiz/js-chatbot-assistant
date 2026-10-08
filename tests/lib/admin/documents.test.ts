import { describe, it, expect } from "vitest";
import { uploadDocument, deleteDocumentWithFile, UploadError, MAX_FILE_SIZE } from "@/lib/admin/documents";
import type { Storage } from "@/lib/storage/storage";
import type { SessionUser } from "@/lib/auth/session";
import { fakeDb } from "../../helpers";

const admin: SessionUser = {
  user_id: 1, admin_id: 1, user_role: "admin", user_name: "A", user_email: "a@x.com",
  email_verified_at: "2026-01-01T00:00:00.000Z",
  brand_name: "Acme", company_name: null, timezone: "UTC",
};

const storage: Storage = {
  async save(_data, filename) { return `/uploads/${filename}`; },
  async remove() {},
};

function docDb(opts: { strategy?: unknown; existingDoc?: unknown } = {}) {
  const { db, calls } = fakeDb((sql: string) => {
    if (sql.includes("FROM document_strategies")) return opts.strategy ? [opts.strategy] : [];
    if (sql.includes("FROM documents WHERE admin_id")) return opts.existingDoc ? [opts.existingDoc] : [];
    if (sql.includes("INSERT INTO documents")) return [{ id: 9 }];
    if (sql.includes("INSERT INTO document_jobs")) return [{ id: 1 }];
    return [];
  });
  return { db, calls };
}

// "%PDF-1.4" — validateUpload checks magic bytes, not just the declared type.
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
const sample = { originalName: "guide.pdf", mimeType: "application/pdf", size: 1000, data: PDF_BYTES };

describe("uploadDocument", () => {
  it("stores, creates, audits, and enqueues a training job", async () => {
    const { db, calls } = docDb();
    const id = await uploadDocument(db, storage, admin, 3, "traditional_rag", sample);
    expect(id).toBe(9);
    expect(calls.some((c) => c.sql.includes("INSERT INTO documents"))).toBe(true);
    expect(calls.some((c) => c.sql.includes("INSERT INTO document_jobs"))).toBe(true);
    const audit = calls.find((c) => c.sql.includes("INSERT INTO audit_logs"));
    expect(audit?.values?.[2]).toBe("create_document");
  });

  it("rejects content that does not match its declared type", async () => {
    // A Content-Type is client-supplied: bytes labelled application/pdf that are
    // not a PDF (here: an ELF header) must not be stored and forwarded to the parser.
    const { db } = docDb();
    await expect(
      uploadDocument(db, storage, admin, 3, "traditional_rag", {
        ...sample,
        data: new Uint8Array([0x7f, 0x45, 0x4c, 0x46]),
      }),
    ).rejects.toThrow(/does not match its declared type/);
  });

  it("rejects an extension that contradicts the declared type", async () => {
    const { db } = docDb();
    await expect(
      uploadDocument(db, storage, admin, 3, "traditional_rag", { ...sample, originalName: "payload.exe" }),
    ).rejects.toThrow(/extension/);
  });

  it("accepts a plain-text file with a matching extension", async () => {
    const { db } = docDb();
    const text = { originalName: "notes.txt", mimeType: "text/plain", size: 12, data: new Uint8Array([104, 105]) };
    const id = await uploadDocument(db, storage, admin, 3, "traditional_rag", text);
    expect(id).toBe(9);
  });

  it("rejects binary bytes declared as text", async () => {
    const { db } = docDb();
    await expect(
      uploadDocument(db, storage, admin, 3, "traditional_rag", {
        originalName: "notes.txt",
        mimeType: "text/plain",
        size: 4,
        data: new Uint8Array([0x00, 0x01, 0x02, 0x03]),
      }),
    ).rejects.toThrow(/does not match its declared type/);
  });

  it("rejects unsupported MIME types", async () => {
    const { db } = docDb();
    await expect(uploadDocument(db, storage, admin, 3, "traditional_rag", { ...sample, mimeType: "image/png" }))
      .rejects.toBeInstanceOf(UploadError);
  });

  it("rejects files over 20 MB", async () => {
    const { db } = docDb();
    await expect(uploadDocument(db, storage, admin, 3, "traditional_rag", { ...sample, size: MAX_FILE_SIZE + 1 }))
      .rejects.toThrow(/20 MB/);
  });

  it("rejects a duplicate under the same strategy", async () => {
    const { db } = docDb({ strategy: { document_id: 5, strategy: "traditional_rag" } });
    await expect(uploadDocument(db, storage, admin, 3, "traditional_rag", sample))
      .rejects.toThrow(/already been uploaded/);
  });

  it("allows the same name under a different strategy", async () => {
    const { db } = docDb({ strategy: { document_id: 5, strategy: "page_index" } });
    const id = await uploadDocument(db, storage, admin, 3, "traditional_rag", sample);
    expect(id).toBe(9);
  });

  it("normalizes x-pdf to application/pdf", async () => {
    const { db, calls } = docDb();
    await uploadDocument(db, storage, admin, 3, "traditional_rag", { ...sample, mimeType: "application/x-pdf" });
    const insert = calls.find((c) => c.sql.includes("INSERT INTO documents"));
    expect(insert?.values?.[4]).toBe("application/pdf");
  });
});

describe("deleteDocumentWithFile", () => {
  it("removes the file, cascade-deletes, and audits", async () => {
    let removed: string | null = null;
    const rmStorage: Storage = { async save() { return "/x"; }, async remove(p) { removed = p; } };
    const { db, calls } = fakeDb((sql: string) => {
      if (sql.includes("SELECT * FROM documents WHERE id = $1")) return [{ id: 9, file_path: "/uploads/f.pdf", original_name: "f.pdf" }];
      return [];
    });
    await deleteDocumentWithFile(db, rmStorage, admin, 9);
    expect(removed).toBe("/uploads/f.pdf");
    expect(calls.some((c) => c.sql.includes("DELETE FROM document_chunks"))).toBe(true);
    expect(calls.some((c) => c.sql.includes("DELETE FROM documents WHERE id = $1"))).toBe(true);
    const audit = calls.find((c) => c.sql.includes("INSERT INTO audit_logs"));
    expect(audit?.values?.[2]).toBe("delete_document");
  });
});