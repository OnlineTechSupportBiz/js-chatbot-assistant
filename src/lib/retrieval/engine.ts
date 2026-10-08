import type { DbClient } from "@/lib/db";
import type { ChatbotRow } from "@/repository/chatbots";
import type { Embeddings, ChatCompletions } from "@/lib/openai/client";
import { countIndexedByChatbot } from "@/repository/documents";
import { searchByEmbedding } from "@/repository/document-chunks";
import { PageIndexStrategy } from "@/lib/retrieval/page-index-strategy";

/**
 * Retrieval engine — port of the PHP retrieval layer (`RetrievalEngine`,
 * `TraditionalRagStrategy`, `PageIndexStrategy`, `RetrievalResult`). Dispatches
 * on the chatbot's `retrieval_strategy`.
 */

export interface RetrievalResult {
  context: string;
  source: "traditional_rag" | "page_index" | "llm_only";
  chunksUsed: number;
  metadata?: Record<string, unknown>;
}

export interface RetrievalDeps {
  db: DbClient;
  adminId: number;
  chatbot: ChatbotRow;
  query: string;
  options?: { top_k?: number; max_nodes?: number };
}

export interface RetrievalStrategy {
  retrieve(deps: RetrievalDeps): Promise<RetrievalResult>;
}

/** The full OpenAI client (embeddings + chat) both strategies need. */
export type RetrievalClient = Embeddings & ChatCompletions;

const EMPTY: RetrievalResult = { context: "", source: "llm_only", chunksUsed: 0 };

export class TraditionalRagStrategy implements RetrievalStrategy {
  constructor(private readonly embedder: Embeddings) {}

  async retrieve({ db, adminId, chatbot, query, options }: RetrievalDeps): Promise<RetrievalResult> {
    const chatbotId = chatbot.id;

    const indexed = await countIndexedByChatbot(db, adminId, chatbotId);
    if (indexed <= 0) return EMPTY;

    const queryEmbedding = await this.embedder.embedAsJsonArray(query);
    const topK = options?.top_k ?? 5;
    const chunks = await searchByEmbedding(db, adminId, chatbotId, queryEmbedding, topK);
    if (chunks.length === 0) return EMPTY;

    const context = chunks.map((c) => c.chunk_text).join("\n\n---\n\n");

    return {
      context,
      source: "traditional_rag",
      chunksUsed: chunks.length,
      metadata: { scores: chunks.map((c) => c.score) },
    };
  }
}

export class RetrievalEngine {
  private readonly strategies = new Map<string, RetrievalStrategy>();

  constructor(
    private readonly embedder: Embeddings,
    private readonly chat: ChatCompletions,
  ) {}

  async retrieve(deps: RetrievalDeps): Promise<RetrievalResult> {
    return this.getStrategy(deps.chatbot.retrieval_strategy ?? "traditional_rag").retrieve(deps);
  }

  private getStrategy(name: string): RetrievalStrategy {
    if (!this.strategies.has(name)) {
      this.strategies.set(name, name === "page_index" ? new PageIndexStrategy(this.chat) : new TraditionalRagStrategy(this.embedder));
    }
    // the entry was just set above, so it is always present
    return this.strategies.get(name)!;
  }
}