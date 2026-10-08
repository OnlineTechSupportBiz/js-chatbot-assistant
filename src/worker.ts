/**
 * Document-training worker. A standalone process that polls the `document_jobs`
 * queue, claims one job at a time, and runs the training pipeline (or a re-embed)
 * without holding a request open.
 *
 *   npm run worker
 *
 * Run alongside the Next.js server (e.g. under systemd / a process manager).
 */
import { loadEnvFile } from "./lib/env-file";
import { getPool, withTransaction, withSessionAdminId } from "./lib/db";
import { claimNextJob, markJobFailed, requeueStaleJobs } from "./repository/document-jobs";
import { deleteExpiredSessions } from "./repository/sessions";
import { pruneExpiredReservations } from "./repository/token-reservations";
import { findDocumentById } from "./repository/documents";
import { findChatbotById } from "./repository/chatbots";
import { getApiKeys } from "./repository/users";
import { processDocumentJob } from "./lib/pipeline/process-job";
import { reembedDocument } from "./lib/pipeline/reembed-document";
import type { DocumentJobRow } from "./repository/document-jobs";
import type { DbClient } from "./lib/db";
import { LlamaParseClient } from "./lib/llamaparse/client";
import { OpenAIClient, resolveOpenAIConfig } from "./lib/openai/client";

// One env file for the whole project: `.env` (see the header in that file).
loadEnvFile(new URL("../.env", import.meta.url).pathname);

const POLL_MS = 2000;
const IDLE_MS = 2000;
/** A job claimed but not finished within this window is assumed abandoned. */
const STUCK_JOB_MINUTES = 15;
/** Housekeeping cadence for stuck jobs and expired sessions. */
const REAP_INTERVAL_MS = 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let lastReap = 0;

/**
 * Periodic housekeeping: requeue jobs abandoned by a dead worker, drop sessions
 * that are past their ceiling, and drop expired budget reservations.
 *
 * None of these tables is tenant-scoped here, so this runs with no admin context
 * (the policies' `current_admin_id() IS NULL` branch) — the same way the worker
 * already reads `document_jobs`.
 */
async function reap(): Promise<void> {
  const now = Date.now();
  if (now - lastReap < REAP_INTERVAL_MS) return;
  lastReap = now;
  try {
    const result = await withTransaction(async (db) => ({
      jobs: await requeueStaleJobs(db, STUCK_JOB_MINUTES),
      sessions: await deleteExpiredSessions(db),
      reservations: await pruneExpiredReservations(db),
    }));
    if (result.jobs > 0) console.log(`[worker] requeued ${result.jobs} stale job(s)`);
    if (result.sessions > 0) console.log(`[worker] removed ${result.sessions} expired session(s)`);
    if (result.reservations > 0)
      console.log(`[worker] released ${result.reservations} expired budget reservation(s)`);
  } catch (err) {
    console.error("[worker] housekeeping failed:", err);
  }
}

/**
 * Re-embed a document's existing chunks with the owner's current embedding provider.
 * Runs as a `reembed` document job (created when the embedding model changes).
 */
async function processReembedJob(db: DbClient, job: DocumentJobRow): Promise<void> {
  const document = await findDocumentById(db, job.document_id);
  if (!document) {
    await markJobFailed(db, job.id, "Document not found");
    return;
  }

  const chatbot = await findChatbotById(db, document.chatbot_id);
  const ownerId = chatbot?.created_by ?? chatbot?.admin_id ?? document.admin_id;
  const keys = await getApiKeys(db, ownerId);
  const embedder = new OpenAIClient(resolveOpenAIConfig(keys));

  await reembedDocument(db, document.id, job.id, embedder);
}

async function runOnce(): Promise<boolean> {
  // 1. Claim the next runnable job (short transaction for SKIP LOCKED).
  const job = await withTransaction((db) => claimNextJob(db));
  if (!job) return false;

  // 2. Resolve the tenant context from the document, then process (autocommit,
  //    session-scoped admin_id so we don't hold a transaction across the pipeline).
  const document = await withTransaction((db) => findDocumentById(db, job.document_id));
  const adminId = document?.admin_id ?? 0;

  await withSessionAdminId(adminId, async (db) => {
    if (job.job_type === "reembed") {
      await processReembedJob(db, job);
    } else {
      await processDocumentJob(
        {
          makeLlama: (key) => new LlamaParseClient(key),
          makeEmbedder: (config) => new OpenAIClient(config),
        },
        db,
        job,
      );
    }
  });
  return true;
}

async function main(): Promise<void> {
  console.log(`[worker] started (poll ${POLL_MS}ms)`);
  for (;;) {
    let worked = false;
    try {
      await reap();
      worked = await runOnce();
    } catch (err) {
      console.error("[worker] error:", err);
    }
    await sleep(worked ? 0 : IDLE_MS);
    void getPool(); // keep referenced (prevent tree-shake in some bundlers)
  }
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});