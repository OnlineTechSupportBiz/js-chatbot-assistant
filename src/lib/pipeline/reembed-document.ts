import type { DbClient } from "@/lib/db";
import type { Embeddings } from "@/lib/openai/client";
import { listChunksForReembed, updateChunkEmbeddings } from "@/repository/document-chunks";
import { markJobCompleted, markJobFailed } from "@/repository/document-jobs";

/**
 * Re-embed one document's existing chunks using the current embedding provider/model.
 * Unlike `trainDocument`, this does not re-parse (the chunk_text is already stored) —
 * it only regenerates the vector embedding, which is what changes when the embedding
 * model or provider is switched.
 */
export async function reembedDocument(db: DbClient, documentId: number, jobId: number, embedder: Embeddings): Promise<void> {
  try {
    const chunks = await listChunksForReembed(db, documentId);
    if (chunks.length === 0) {
      // Nothing to re-embed (e.g. a PageIndex document) — treat as done.
      await markJobCompleted(db, jobId);
      return;
    }

    const embeddings = await embedder.embedBatchAsJsonArray(chunks.map((c) => c.chunk_text));
    if (embeddings.length !== chunks.length) {
      await markJobFailed(db, jobId, "Re-embedding failed (embedding count mismatch).");
      return;
    }

    await updateChunkEmbeddings(db, chunks, embeddings);
    await markJobCompleted(db, jobId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markJobFailed(db, jobId, message);
  }
}