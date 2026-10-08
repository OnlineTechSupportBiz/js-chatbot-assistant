import type { DbClient } from "@/lib/db";
import type { ChatbotRow } from "@/repository/chatbots";
import type { DocumentRow } from "@/repository/documents";
import type { LlamaParse } from "@/lib/llamaparse/client";
import type { Embeddings } from "@/lib/openai/client";
import { chunk } from "@/lib/retrieval/chunking";
import {
  patchDocumentStatus,
  saveParsedText,
  markIndexed,
  markPageIndexed,
  recordStrategy,
} from "@/repository/documents";
import { insertChunkBatch, deleteByDocument as deleteChunks } from "@/repository/document-chunks";
import { deleteByDocument as deletePageIndexNodes } from "@/repository/document-page-index";
import { buildPageIndex } from "@/lib/retrieval/page-index-builder";
import { logAudit } from "@/repository/audit-logs";

/**
 * Document training pipeline — port of PHP `DocumentController::train`:
 * parse (LlamaCloud) → chunk (500/50) → embed → index, branching on the chatbot's
 * retrieval strategy. Runs synchronously (the background-job runner wraps it).
 *
 * Audit semantics match PHP: an *expected* failure (parse reported FAILED, no
 * chunks, embedding count mismatch) marks the document `failed` but does NOT log
 * `train_document_failed`; only an *unexpected* exception does (via the catch).
 */

/** An expected, user-visible training failure (already marked `failed`, no audit). */
export class TrainDocumentError extends Error {}

export interface TrainDocumentDeps {
  db: DbClient;
  llama: LlamaParse;
  embedder: Embeddings;
  adminId: number;
  chatbot: ChatbotRow;
  document: DocumentRow;
  userId: number;
}

export interface TrainResult {
  chunks: number;
  strategy: "traditional_rag" | "page_index";
}

export async function trainDocument(deps: TrainDocumentDeps): Promise<TrainResult> {
  const { db, llama, embedder, adminId, chatbot, document, userId } = deps;
  const chatbotId = chatbot.id;
  const documentId = document.id;

  try {
    // Step 1: Parse — reuse the stored parsed_text on reprocess to skip LlamaCloud.
    let markdown: string;
    if (document.parsed_text != null && document.parsed_text !== "") {
      markdown = document.parsed_text;
    } else {
      await patchDocumentStatus(db, documentId, "parsing");
      const parseResult = await llama.parseFile(document.file_path, document.mime_type, "cost_effective");
      if (parseResult.status !== "COMPLETED" || parseResult.markdown === null) {
        await patchDocumentStatus(db, documentId, "failed");
        throw new TrainDocumentError(`Document parsing failed: ${parseResult.error ?? "Unknown parsing error"}`);
      }
      markdown = parseResult.markdown;
      await saveParsedText(db, documentId, markdown);
    }

    // Clear any prior index (chunks + page-index) so a reprocess or strategy
    // change is idempotent instead of stacking stale data.
    await deleteChunks(db, documentId);
    await deletePageIndexNodes(db, documentId);

    // Step 2: Branch on retrieval strategy
    const strategy = chatbot.retrieval_strategy ?? "traditional_rag";
    if (strategy === "page_index") {
      // ── PageIndex: build hierarchical tree from parsed text ──
      await patchDocumentStatus(db, documentId, "chunking");
      const nodeCount = await buildPageIndex(db, adminId, chatbotId, documentId, markdown);

      if (nodeCount === 0) {
        await patchDocumentStatus(db, documentId, "failed");
        throw new TrainDocumentError("No sections could be extracted from the document.");
      }

      await markPageIndexed(db, documentId);
      await recordStrategy(db, adminId, chatbotId, documentId, document.original_name, "page_index");

      await logAudit(db, {
        adminId, userId, action: "train_document", entityType: "document", entityId: documentId,
        newValue: { name: document.original_name, strategy: "page_index", nodes: nodeCount },
      });

      return { chunks: nodeCount, strategy: "page_index" };
    }

    // ── Traditional RAG: chunk → embed → insert ──
    await patchDocumentStatus(db, documentId, "chunking");
    const chunks = chunk(markdown, 500, 50);
    if (chunks.length === 0) {
      await patchDocumentStatus(db, documentId, "failed");
      throw new TrainDocumentError("No text chunks could be extracted from the document.");
    }

    await patchDocumentStatus(db, documentId, "embedding");
    const jsonArrays = await embedder.embedBatchAsJsonArray(chunks.map((c) => c.chunk_text));
    if (jsonArrays.length !== chunks.length) {
      await patchDocumentStatus(db, documentId, "failed");
      throw new TrainDocumentError("Embedding generation failed (count mismatch).");
    }

    const chunkData = chunks.map((c, i) => ({
      chunk_index: c.chunk_index,
      chunk_text: c.chunk_text,
      embedding: jsonArrays[i],
    }));
    await insertChunkBatch(db, adminId, chatbotId, documentId, chunkData);

    await markIndexed(db, documentId);
    await recordStrategy(db, adminId, chatbotId, documentId, document.original_name, "traditional_rag");

    await logAudit(db, {
      adminId, userId, action: "train_document", entityType: "document", entityId: documentId,
      newValue: { name: document.original_name, chunks: chunkData.length },
    });

    return { chunks: chunkData.length, strategy: "traditional_rag" };
  } catch (err) {
    if (err instanceof TrainDocumentError) {
      // Expected failure — status already 'failed', no train_document_failed audit.
      throw err;
    }
    // Unexpected exception — mark failed and audit, then rethrow.
    await patchDocumentStatus(db, documentId, "failed");
    const message = err instanceof Error ? err.message : String(err);
    await logAudit(db, {
      adminId, userId, action: "train_document_failed", entityType: "document", entityId: documentId,
      newValue: { name: document.original_name, error: message },
    });
    throw err;
  }
}