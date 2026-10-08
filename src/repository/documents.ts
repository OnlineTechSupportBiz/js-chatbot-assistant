import type { DbClient } from "@/lib/db";

/**
 * Document model — port of PHP `Model/Document` (documents table + document_strategies).
 */

export type DocumentStatus =
  | "uploaded"
  | "parsing"
  | "parsed"
  | "chunking"
  | "embedding"
  | "indexed"
  | "failed";

export interface DocumentRow {
  id: number;
  admin_id: number;
  chatbot_id: number;
  filename: string;
  original_name: string;
  mime_type: string | null;
  file_path: string | null;
  file_size: number | null;
  status: DocumentStatus;
  error_message: string | null;
  llamacloud_job_id: string | null;
  llamacloud_status: string | null;
  parsed_text: string | null;
  chunk_count: number | null;
  uploaded_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface NewDocument {
  adminId: number;
  chatbotId: number;
  filename: string;
  originalName: string;
  mimeType: string | null;
  filePath: string | null;
  fileSize: number | null;
  status?: DocumentStatus;
  uploadedBy: number;
}

export async function createDocument(db: DbClient, input: NewDocument): Promise<number> {
  const r = await db.query(
    `INSERT INTO documents
       (admin_id, chatbot_id, filename, original_name, mime_type, file_path, file_size, status, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      input.adminId,
      input.chatbotId,
      input.filename,
      input.originalName,
      input.mimeType ?? null,
      input.filePath ?? null,
      input.fileSize ?? null,
      input.status ?? "uploaded",
      input.uploadedBy,
    ],
  );
  return Number(r.rows[0].id);
}

export async function findDocumentById(db: DbClient, id: number): Promise<DocumentRow | null> {
  const r = await db.query("SELECT * FROM documents WHERE id = $1", [id]);
  return (r.rows[0] as DocumentRow) ?? null;
}

export async function findByChatbot(db: DbClient, adminId: number, chatbotId: number): Promise<DocumentRow[]> {
  const r = await db.query(
    "SELECT * FROM documents WHERE admin_id = $1 AND chatbot_id = $2 ORDER BY created_at DESC",
    [adminId, chatbotId],
  );
  return r.rows as DocumentRow[];
}

export async function findByOriginalName(db: DbClient, adminId: number, chatbotId: number, originalName: string): Promise<DocumentRow | null> {
  const r = await db.query(
    "SELECT * FROM documents WHERE admin_id = $1 AND chatbot_id = $2 AND original_name = $3",
    [adminId, chatbotId, originalName],
  );
  return (r.rows[0] as DocumentRow) ?? null;
}

export async function existsByOriginalName(db: DbClient, adminId: number, chatbotId: number, originalName: string): Promise<boolean> {
  const r = await db.query(
    "SELECT COUNT(*) AS c FROM documents WHERE admin_id = $1 AND chatbot_id = $2 AND original_name = $3",
    [adminId, chatbotId, originalName],
  );
  return Number(r.rows[0]?.c ?? 0) > 0;
}

export async function findStrategyByOriginalName(db: DbClient, chatbotId: number, originalName: string): Promise<{ document_id: number; strategy: string } | null> {
  const r = await db.query(
    "SELECT document_id, strategy FROM document_strategies WHERE chatbot_id = $1 AND original_name = $2 LIMIT 1",
    [chatbotId, originalName],
  );
  return (r.rows[0] as { document_id: number; strategy: string }) ?? null;
}

export async function findStrategiesByChatbot(db: DbClient, chatbotId: number): Promise<Record<number, string>> {
  const r = await db.query("SELECT document_id, strategy FROM document_strategies WHERE chatbot_id = $1", [chatbotId]);
  const map: Record<number, string> = {};
  for (const row of r.rows as Array<{ document_id: number; strategy: string }>) {
    map[row.document_id] = row.strategy;
  }
  return map;
}

export async function recordStrategy(db: DbClient, adminId: number, chatbotId: number, documentId: number, originalName: string, strategy: string): Promise<void> {
  await db.query(
    `INSERT INTO document_strategies (admin_id, chatbot_id, document_id, original_name, strategy)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (document_id) DO UPDATE SET strategy = $5`,
    [adminId, chatbotId, documentId, originalName, strategy],
  );
}

export async function countIndexedByChatbot(db: DbClient, adminId: number, chatbotId: number): Promise<number> {
  const r = await db.query(
    "SELECT COUNT(*) AS c FROM documents WHERE admin_id = $1 AND chatbot_id = $2 AND status = 'indexed'",
    [adminId, chatbotId],
  );
  return Number(r.rows[0]?.c ?? 0);
}

export async function countByAdmin(db: DbClient, adminId: number): Promise<number> {
  const r = await db.query("SELECT COUNT(*) AS c FROM documents WHERE admin_id = $1", [adminId]);
  return Number(r.rows[0]?.c ?? 0);
}

export async function countByUser(db: DbClient, userId: number): Promise<number> {
  const r = await db.query(
    `SELECT COUNT(*) AS c FROM documents d INNER JOIN chatbots c ON c.id = d.chatbot_id WHERE c.created_by = $1`,
    [userId],
  );
  return Number(r.rows[0]?.c ?? 0);
}

export async function totalChunksByChatbot(db: DbClient, adminId: number, chatbotId: number): Promise<number> {
  const r = await db.query(
    "SELECT COALESCE(SUM(chunk_count), 0) AS t FROM documents WHERE admin_id = $1 AND chatbot_id = $2 AND status = 'indexed'",
    [adminId, chatbotId],
  );
  return Number(r.rows[0]?.t ?? 0);
}

export async function patchDocumentStatus(db: DbClient, documentId: number, status: DocumentStatus): Promise<void> {
  await db.query("UPDATE documents SET status = $1 WHERE id = $2", [status, documentId]);
}

export async function saveParsedText(db: DbClient, documentId: number, parsedText: string): Promise<void> {
  await db.query("UPDATE documents SET status = 'parsed', parsed_text = $1 WHERE id = $2", [parsedText, documentId]);
}

export async function markIndexed(db: DbClient, documentId: number): Promise<void> {
  await db.query(
    `UPDATE documents SET status = 'indexed', chunk_count = (SELECT COUNT(*) FROM document_chunks WHERE document_id = $1) WHERE id = $2`,
    [documentId, documentId],
  );
}

export async function markPageIndexed(db: DbClient, documentId: number): Promise<void> {
  await db.query(
    `UPDATE documents SET status = 'indexed', chunk_count = (SELECT COUNT(*) FROM document_page_index WHERE document_id = $1) WHERE id = $2`,
    [documentId, documentId],
  );
}

export async function totalFileSizeByChatbot(db: DbClient, adminId: number, chatbotId: number): Promise<number> {
  const r = await db.query(
    "SELECT COALESCE(SUM(file_size), 0) AS t FROM documents WHERE admin_id = $1 AND chatbot_id = $2",
    [adminId, chatbotId],
  );
  return Number(r.rows[0]?.t ?? 0);
}

export async function vectorStorageByChatbot(db: DbClient, adminId: number, chatbotId: number): Promise<number> {
  const r = await db.query(
    "SELECT COALESCE(SUM(pg_column_size(embedding)), 0) AS t FROM document_chunks WHERE admin_id = $1 AND chatbot_id = $2",
    [adminId, chatbotId],
  );
  return Number(r.rows[0]?.t ?? 0);
}

/** Delete a document plus its chunks and page-index nodes (PHP Document::delete). */
export async function deleteDocument(db: DbClient, documentId: number): Promise<void> {
  await db.query("DELETE FROM document_chunks WHERE document_id = $1", [documentId]);
  await db.query("DELETE FROM document_page_index WHERE document_id = $1", [documentId]);
  await db.query("DELETE FROM documents WHERE id = $1", [documentId]);
}

/** Wipe every document (and its index/jobs/strategies) for a chatbot. */
export async function deleteAllByChatbot(db: DbClient, adminId: number, chatbotId: number): Promise<void> {
  await db.query(
    "DELETE FROM document_jobs WHERE document_id IN (SELECT id FROM documents WHERE admin_id = $1 AND chatbot_id = $2)",
    [adminId, chatbotId],
  );
  await db.query("DELETE FROM document_strategies WHERE admin_id = $1 AND chatbot_id = $2", [adminId, chatbotId]);
  await db.query("DELETE FROM document_chunks WHERE admin_id = $1 AND chatbot_id = $2", [adminId, chatbotId]);
  await db.query("DELETE FROM document_page_index WHERE admin_id = $1 AND chatbot_id = $2", [adminId, chatbotId]);
  await db.query("DELETE FROM documents WHERE admin_id = $1 AND chatbot_id = $2", [adminId, chatbotId]);
}