import { describe, it, expect } from "vitest";
import { enqueueDocumentJob, claimNextJob, markJobCompleted, markJobFailed, enqueueReembedForAdmin, reEnqueueIncompleteReembed, getReindexStatus, enqueueReprocessForChatbot } from "@/repository/document-jobs";
import { fakeDb } from "../helpers";

describe("document-jobs queue", () => {
  it("enqueue inserts a queued job", async () => {
    const { db, calls } = fakeDb(() => [{ id: 9 }]);
    expect(await enqueueDocumentJob(db, 42)).toBe(9);
    expect(calls[0].sql).toContain("INSERT INTO document_jobs (document_id) VALUES ($1)");
    expect(calls[0].values).toEqual([42]);
  });

  it("claimNextJob uses SKIP LOCKED and increments attempts", async () => {
    const { db, calls } = fakeDb(() => [{ id: 5, document_id: 42, status: "processing", attempts: 1 }]);
    const job = await claimNextJob(db);
    expect(job?.id).toBe(5);
    expect(calls[0].sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(calls[0].sql).toContain("attempts = attempts + 1");
    expect(calls[0].sql).toContain("status IN ('queued', 'failed') AND attempts < max_attempts");
  });

  it("claimNextJob returns null when nothing is ready", async () => {
    const db = { query: async () => ({ rows: [], rowCount: 0 }), release: () => {} };
    expect(await claimNextJob(db)).toBeNull();
  });

  it("markJobCompleted / markJobFailed write the correct status", async () => {
    const done = fakeDb();
    await markJobCompleted(done.db, 5);
    expect(done.calls[0].sql).toContain("status = 'completed'");

    const failed = fakeDb();
    await markJobFailed(failed.db, 5, "boom");
    expect(failed.calls[0].sql).toContain("status = 'failed'");
    expect(failed.calls[0].values).toEqual(["boom", 5]);
  });
});

describe("enqueueReembedForAdmin", () => {
  it("inserts re-embed jobs tagged with a shared batch id", async () => {
    const { db, calls } = fakeDb();
    const result = await enqueueReembedForAdmin(db, 1);
    expect(result.batchId).toBeTruthy();
    expect(calls[0].sql).toContain("INSERT INTO document_jobs (document_id, job_type, batch_id)");
    expect(calls[0].values).toEqual([1, result.batchId]);
  });
});

describe("getReindexStatus", () => {
  it("returns a null batch when no re-embed jobs exist", async () => {
    const { db } = fakeDb(() => []);
    const s = await getReindexStatus(db, 1);
    expect(s.batchId).toBeNull();
    expect(s.total).toBe(0);
  });

  it("aggregates the latest batch's per-document status", async () => {
    const { db } = fakeDb((sql: string) => {
      if (sql.includes("SELECT dj.batch_id")) return [{ batch_id: "batch-1" }];
      if (sql.includes("SELECT dj.document_id")) {
        return [
          { document_id: 1, name: "a.pdf", status: "completed", error_message: null },
          { document_id: 2, name: "b.pdf", status: "failed", error_message: "boom" },
          { document_id: 3, name: "c.pdf", status: "processing", error_message: null },
        ];
      }
      return [];
    });
    const s = await getReindexStatus(db, 1);
    expect(s.batchId).toBe("batch-1");
    expect(s.total).toBe(3);
    expect(s.completed).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.processing).toBe(1);
    expect(s.inProgress).toBe(true);
    expect(s.documents[1].error_message).toBe("boom");
  });

  it("marks a fully-completed batch as not in progress", async () => {
    const { db } = fakeDb((sql: string) => {
      if (sql.includes("SELECT dj.batch_id")) return [{ batch_id: "batch-2" }];
      return [{ document_id: 1, name: "a.pdf", status: "completed", error_message: null }];
    });
    const s = await getReindexStatus(db, 1);
    expect(s.inProgress).toBe(false);
    expect(s.completed).toBe(1);
  });
});

describe("reEnqueueIncompleteReembed", () => {
  it("re-queues only documents without a queued/processing/completed job", async () => {
    const { db, calls } = fakeDb();
    const result = await reEnqueueIncompleteReembed(db, 1);
    expect(result.batchId).toBeTruthy();
    expect(calls[0].sql).toContain("status IN ('queued', 'processing', 'completed')");
  });
});

describe("enqueueReprocessForChatbot", () => {
  it("inserts a train job per document of the chatbot", async () => {
    const { db, calls } = fakeDb();
    await enqueueReprocessForChatbot(db, 1, 9);
    expect(calls[0].sql).toContain("INSERT INTO document_jobs (document_id, job_type)");
    expect(calls[0].sql).toContain("SELECT d.id, 'train' FROM documents d");
    expect(calls[0].values).toEqual([1, 9]);
  });
});