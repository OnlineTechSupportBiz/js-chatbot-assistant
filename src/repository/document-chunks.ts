import type { DbClient } from "@/lib/db";

/**
 * DocumentChunk model — port of PHP `Model/DocumentChunk`. Embeddings are stored
 * as pgvector VECTOR(1536) cast from JSON-array strings via `::vector`.
 */

export interface ChunkInput {
  chunk_index: number;
  chunk_text: string;
  embedding: string; // JSON array string, e.g. "[0.1,-0.2,...]"
}

export interface ChunkMatch {
  id: number;
  chunk_text: string;
  score: number;
}

/**
 * The knowledge base's stored vectors have a different width than the embedding
 * the configured model just produced.
 *
 * This is what replacing the old `EMBEDDING_DIMENSIONS` env gate with something
 * honest looks like: the width is the tenant's choice (they configure their own
 * embedding provider), so nothing should hardcode it — but pgvector's `<=>` cannot
 * compare vectors of different lengths, and the raw failure ("different vector
 * dimensions 1024 and 1536") arrives from deep inside the query with no hint of
 * what to do about it. Raised at search time against the chatbot's OWN stored
 * data, so it needs no configuration and cannot be wrong.
 */
export class EmbeddingDimensionMismatchError extends Error {
  constructor(
    readonly storedDimensions: number,
    readonly queryDimensions: number,
  ) {
    super(
      `This chatbot's indexed documents hold ${storedDimensions}-dimension embeddings, ` +
        `but the configured embedding model returns ${queryDimensions}. Re-index the ` +
        `documents (Documents → Reprocess all) after changing the embedding model or ` +
        `provider.`,
    );
    this.name = "EmbeddingDimensionMismatchError";
  }
}

export async function insertChunkBatch(
  db: DbClient,
  adminId: number,
  chatbotId: number,
  documentId: number,
  chunks: ChunkInput[],
): Promise<void> {
  if (chunks.length === 0) return;

  // Build a single multi-row INSERT with per-row ::vector casts.
  const values: string[] = [];
  const params: unknown[] = [];
  chunks.forEach((chunk, i) => {
    const base = i * 6;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::vector)`);
    params.push(adminId, chatbotId, documentId, chunk.chunk_index, chunk.chunk_text, chunk.embedding);
  });

  await db.query(
    `INSERT INTO document_chunks (admin_id, chatbot_id, document_id, chunk_index, chunk_text, embedding) VALUES ${values.join(", ")}`,
    params,
  );
}

export async function deleteByDocument(db: DbClient, documentId: number): Promise<void> {
  await db.query("DELETE FROM document_chunks WHERE document_id = $1", [documentId]);
}

export interface ReembedChunk {
  id: number;
  chunk_text: string;
}

/** Read a document's chunks (id + text) so their embeddings can be regenerated. */
export async function listChunksForReembed(db: DbClient, documentId: number): Promise<ReembedChunk[]> {
  const r = await db.query(
    "SELECT id, chunk_text FROM document_chunks WHERE document_id = $1 ORDER BY chunk_index",
    [documentId],
  );
  return r.rows as ReembedChunk[];
}

/** Overwrite a set of chunk embeddings (index-aligned with a prior listChunksForReembed). */
export async function updateChunkEmbeddings(db: DbClient, chunks: ReembedChunk[], embeddings: string[]): Promise<void> {
  for (let i = 0; i < chunks.length; i++) {
    await db.query("UPDATE document_chunks SET embedding = $1::vector WHERE id = $2", [embeddings[i], chunks[i].id]);
  }
}

export async function countByDocument(db: DbClient, documentId: number): Promise<number> {
  const r = await db.query("SELECT COUNT(*) AS c FROM document_chunks WHERE document_id = $1", [documentId]);
  return Number(r.rows[0]?.c ?? 0);
}

/**
 * Cosine similarity search (pgvector `<=>`), ordered nearest-first.
 * score = 1 - distance (distance 0 for identical, 1 for orthogonal), rounded to 6.
 *
 * Throws `EmbeddingDimensionMismatchError` when the stored vectors were produced by
 * a different embedding model than the one now configured.
 */
export async function searchByEmbedding(
  db: DbClient,
  adminId: number,
  chatbotId: number,
  queryEmbeddingJson: string,
  topK = 5,
): Promise<ChunkMatch[]> {
  // Compare the query vector's width with what is actually stored before running
  // the distance query: pgvector raises "different vector dimensions" and returns
  // nothing useful, so the check has to happen first (see the error class above).
  const dims = await db.query(
    `SELECT vector_dims(embedding) AS stored, vector_dims($1::vector) AS query
       FROM document_chunks
      WHERE admin_id = $2 AND chatbot_id = $3
      LIMIT 1`,
    [queryEmbeddingJson, adminId, chatbotId],
  );
  const dimRow = dims.rows[0] as { stored: number; query: number } | undefined;
  if (dimRow) {
    const stored = Number(dimRow.stored);
    const query = Number(dimRow.query);
    if (stored !== query) {
      throw new EmbeddingDimensionMismatchError(stored, query);
    }
  }

  const r = await db.query(
    `SELECT id, chunk_text, embedding <=> $1::vector AS distance
     FROM document_chunks
     WHERE admin_id = $2 AND chatbot_id = $3
     ORDER BY embedding <=> $4::vector
     LIMIT $5`,
    [queryEmbeddingJson, adminId, chatbotId, queryEmbeddingJson, topK],
  );

  return (r.rows as Array<{ id: number; chunk_text: string; distance: number }>).map((row) => ({
    id: Number(row.id),
    chunk_text: row.chunk_text,
    score: Math.round((1.0 - Number(row.distance)) * 1e6) / 1e6,
  }));
}