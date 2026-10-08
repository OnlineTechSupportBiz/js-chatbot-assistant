import { randomUUID } from "node:crypto";
import type { DbClient } from "@/lib/db";

/**
 * Document-job queue — port-specific, Postgres-backed work queue for the
 * document training pipeline. ENABLE-less (no RLS), like rate_limits.
 */

export type DocumentJobStatus = "queued" | "processing" | "completed" | "failed";
export type DocumentJobType = "train" | "reembed";

export interface DocumentJobRow {
  id: number;
  document_id: number;
  job_type: DocumentJobType;
  batch_id: string | null;
  status: DocumentJobStatus;
  attempts: number;
  max_attempts: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export async function enqueueDocumentJob(db: DbClient, documentId: number): Promise<number> {
  const r = await db.query(
    "INSERT INTO document_jobs (document_id) VALUES ($1) RETURNING id",
    [documentId],
  );
  return Number(r.rows[0].id);
}

/**
 * Re-enqueue a train job for every document of a chatbot, so they are
 * re-processed (re-chunked / re-indexed) against the chatbot's current retrieval
 * strategy and embedding config. Used when the strategy changes or on a manual
 * "reprocess all" action.
 */
export async function enqueueReprocessForChatbot(db: DbClient, adminId: number, chatbotId: number): Promise<number> {
  const r = await db.query(
    `INSERT INTO document_jobs (document_id, job_type)
     SELECT d.id, 'train' FROM documents d WHERE d.admin_id = $1 AND d.chatbot_id = $2`,
    [adminId, chatbotId],
  );
  return r.rowCount ?? 0;
}

/**
 * Enqueue one re-embed job per document that currently has chunks, so the worker can
 * re-run the embedding step against those documents' stored text using the current
 * embedding provider/model. All jobs share a `batch_id` so the admin UI can show
 * progress. Returns the batch id and the number of jobs enqueued.
 */
export async function enqueueReembedForAdmin(db: DbClient, adminId: number): Promise<{ batchId: string; count: number }> {
  const batchId = randomUUID();
  const r = await db.query(
    `INSERT INTO document_jobs (document_id, job_type, batch_id)
     SELECT DISTINCT document_id, 'reembed', $2 FROM document_chunks WHERE admin_id = $1`,
    [adminId, batchId],
  );
  return { batchId, count: r.rowCount ?? 0 };
}

/**
 * Re-enqueue re-embed jobs for documents whose re-embed never completed (failed or
 * stuck), skipping anything already queued/processing/completed. Used by the admin
 * "rerun" action. Returns the new batch id and count.
 */
export async function reEnqueueIncompleteReembed(db: DbClient, adminId: number): Promise<{ batchId: string; count: number }> {
  const batchId = randomUUID();
  const r = await db.query(
    `INSERT INTO document_jobs (document_id, job_type, batch_id)
     SELECT DISTINCT dc.document_id, 'reembed', $2
     FROM document_chunks dc
     WHERE dc.admin_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM document_jobs dj
         WHERE dj.document_id = dc.document_id
           AND dj.job_type = 'reembed'
           AND dj.status IN ('queued', 'processing', 'completed')
       )`,
    [adminId, batchId],
  );
  return { batchId, count: r.rowCount ?? 0 };
}

export interface ReindexDocumentStatus {
  document_id: number;
  name: string;
  status: DocumentJobStatus;
  error_message: string | null;
}

export interface ReindexStatus {
  batchId: string | null;
  total: number;
  completed: number;
  failed: number;
  queued: number;
  processing: number;
  inProgress: boolean;
  documents: ReindexDocumentStatus[];
}

/** Aggregate progress for the admin's most recent re-embed batch. */
export async function getReindexStatus(db: DbClient, adminId: number): Promise<ReindexStatus> {
  const batch = await db.query(
    `SELECT dj.batch_id
     FROM document_jobs dj
     JOIN documents d ON d.id = dj.document_id
     WHERE d.admin_id = $1 AND dj.job_type = 'reembed'
     ORDER BY dj.id DESC
     LIMIT 1`,
    [adminId],
  );
  const batchId: string | null = batch.rows[0]?.batch_id ?? null;

  const empty: ReindexStatus = { batchId: null, total: 0, completed: 0, failed: 0, queued: 0, processing: 0, inProgress: false, documents: [] };
  if (!batchId) return empty;

  const rows = await db.query(
    `SELECT dj.document_id, d.original_name AS name, dj.status, dj.error_message
     FROM document_jobs dj
     JOIN documents d ON d.id = dj.document_id
     WHERE d.admin_id = $1 AND dj.job_type = 'reembed' AND dj.batch_id = $2
     ORDER BY dj.id`,
    [adminId, batchId],
  );

  const documents: ReindexDocumentStatus[] = rows.rows.map((r) => ({
    document_id: Number(r.document_id),
    name: String(r.name ?? `document ${r.document_id}`),
    status: r.status as DocumentJobStatus,
    error_message: r.error_message ?? null,
  }));

  const count = (s: DocumentJobStatus) => documents.filter((d) => d.status === s).length;
  const queued = count("queued");
  const processing = count("processing");

  return {
    batchId,
    total: documents.length,
    completed: count("completed"),
    failed: count("failed"),
    queued,
    processing,
    inProgress: queued + processing > 0,
    documents,
  };
}

/**
 * Atomically claim the next runnable job (queued or failed-with-retries left),
 * marking it `processing` and incrementing attempts. `FOR UPDATE SKIP LOCKED`
 * lets multiple workers poll concurrently without double-claiming.
 */
export async function claimNextJob(db: DbClient): Promise<DocumentJobRow | null> {
  const r = await db.query(
    `WITH next AS (
       SELECT id FROM document_jobs
       WHERE status IN ('queued', 'failed') AND attempts < max_attempts
       ORDER BY id ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE document_jobs
     SET status = 'processing', attempts = attempts + 1, updated_at = NOW()
     FROM next
     WHERE document_jobs.id = next.id
     RETURNING document_jobs.*`,
  );
  return (r.rows[0] as DocumentJobRow) ?? null;
}

/**
 * Requeue jobs a worker claimed but never finished (crash, deploy, OOM).
 *
 * A job left in `processing` was invisible to every future claim — the claim
 * query only looks at `queued`/`failed` — so a single worker death stranded that
 * document half-trained forever, with no timeout and no way back. The window is
 * deliberately generous so a slow-but-alive pipeline is not stolen from mid-run.
 */
export async function requeueStaleJobs(db: DbClient, olderThanMinutes = 15): Promise<number> {
  const r = await db.query(
    `UPDATE document_jobs
        SET status = 'queued', updated_at = NOW(),
            error_message = COALESCE(error_message, 'Requeued: the worker stopped mid-job')
      WHERE status = 'processing'
        AND updated_at < NOW() - ($1::int * INTERVAL '1 minute')`,
    [olderThanMinutes],
  );
  return r.rowCount ?? 0;
}

/**
 * Atomically claim the next retryable train job for a specific chatbot (for the
 * inline "process now" fallback when the worker is not running). Mirrors
 * `claimNextJob` but scoped to the chatbot's documents.
 */
export async function claimNextTrainJobForChatbot(db: DbClient, adminId: number, chatbotId: number): Promise<DocumentJobRow | null> {
  const r = await db.query(
    `WITH next AS (
       SELECT dj.id FROM document_jobs dj
       JOIN documents d ON d.id = dj.document_id
       WHERE dj.status IN ('queued', 'failed') AND dj.attempts < dj.max_attempts
         AND dj.job_type = 'train'
         AND d.admin_id = $1 AND d.chatbot_id = $2
       ORDER BY dj.id ASC
       LIMIT 1
       FOR UPDATE OF dj SKIP LOCKED
     )
     UPDATE document_jobs dj
     SET status = 'processing', attempts = attempts + 1, updated_at = NOW()
     FROM next
     WHERE dj.id = next.id
     RETURNING dj.*`,
    [adminId, chatbotId],
  );
  return (r.rows[0] as DocumentJobRow) ?? null;
}

export async function markJobCompleted(db: DbClient, jobId: number): Promise<void> {
  await db.query(
    "UPDATE document_jobs SET status = 'completed', error_message = NULL, updated_at = NOW() WHERE id = $1",
    [jobId],
  );
}

export async function markJobFailed(db: DbClient, jobId: number, error: string): Promise<void> {
  await db.query(
    "UPDATE document_jobs SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2",
    [error, jobId],
  );
}