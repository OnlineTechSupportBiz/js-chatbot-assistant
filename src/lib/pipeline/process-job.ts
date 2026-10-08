import type { DbClient } from "@/lib/db";
import type { LlamaParse } from "@/lib/llamaparse/client";
import type { Embeddings, OpenAIClientConfig } from "@/lib/openai/client";
import { resolveOpenAIConfig } from "@/lib/openai/client";
import { findDocumentById } from "@/repository/documents";
import { findChatbotById } from "@/repository/chatbots";
import { getApiKeys } from "@/repository/users";
import { markJobCompleted, markJobFailed } from "@/repository/document-jobs";
import { trainDocument } from "@/lib/pipeline/train-document";

/**
 * Processes one claimed document job: loads the document + chatbot, resolves the
 * owner's model settings, runs the training pipeline, and marks the job complete/failed.
 */

export interface ProcessJobDeps {
  makeLlama: (apiKey: string) => LlamaParse;
  makeEmbedder: (config: OpenAIClientConfig) => Embeddings;
}

export interface ClaimedJob {
  id: number;
  document_id: number;
}

export async function processDocumentJob(deps: ProcessJobDeps, db: DbClient, job: ClaimedJob): Promise<"completed" | "failed"> {
  const document = await findDocumentById(db, job.document_id);
  if (!document) {
    await markJobFailed(db, job.id, "Document not found");
    return "failed";
  }

  const chatbot = await findChatbotById(db, document.chatbot_id);
  if (!chatbot) {
    await markJobFailed(db, job.id, "Chatbot not found");
    return "failed";
  }

  const ownerId = chatbot.created_by ?? chatbot.admin_id;
  const keys = await getApiKeys(db, ownerId);

  if (!keys.llamacloud_api_key) {
    await markJobFailed(db, job.id, "LlamaCloud API key not configured");
    return "failed";
  }
  if (!keys.openai_api_key && !keys.embedding_api_key) {
    await markJobFailed(db, job.id, "OpenAI/embedding API key not configured");
    return "failed";
  }

  const llama = deps.makeLlama(keys.llamacloud_api_key);
  const embedder = deps.makeEmbedder(resolveOpenAIConfig(keys));

  try {
    await trainDocument({ db, llama, embedder, adminId: document.admin_id, chatbot, document, userId: ownerId });
    await markJobCompleted(db, job.id);
    return "completed";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markJobFailed(db, job.id, message);
    return "failed";
  }
}