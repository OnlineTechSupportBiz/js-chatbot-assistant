import { describe, it, expect } from "vitest";
import { RetrievalEngine, TraditionalRagStrategy, type RetrievalClient } from "@/lib/retrieval/engine";
import type { ChatbotRow } from "@/repository/chatbots";
import { fakeDb } from "../../helpers";

const chatbot: ChatbotRow = {
  id: 3, admin_id: 1, created_by: 1, name: "Bot", industry: null, system_prompt: null,
  model_config: { temperature: 0, max_tokens: 1024, model: "gpt-4.1-mini" }, styling: null,
  status: "active", lead_capture_enabled: 0, daily_token_budget: null, rate_limit_per_session: null, rate_limit_per_ip: null, rate_limit_per_token: null,
  allowed_domains: null, widget_token: "tok", max_message_length: null, max_messages_per_conversation: null,
  retrieval_strategy: "traditional_rag", created_at: "x", updated_at: "y",
};

function embedder(returns = "[0.1,0.2]"): RetrievalClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async embedAsJsonArray(text: string) {
      calls.push(text);
      return returns;
    },
    async embedBatchAsJsonArray(texts: string[]) {
      calls.push(...texts);
      return texts.map(() => returns);
    },
    async chatCompletion() {
      return { content: "[1,2]", total_tokens: 10 };
    },
  };
}

function dbWith(indexed: number, chunks: unknown[] = []) {
  const { db } = fakeDb((sql: string) => {
    if (sql.includes("status = 'indexed'") && sql.includes("FROM documents")) return [{ c: indexed }];
    if (sql.includes("<=> $1::vector")) return chunks;
    return [];
  });
  return db;
}

describe("TraditionalRagStrategy", () => {
  it("returns empty when no indexed documents", async () => {
    const e = embedder();
    const strategy = new TraditionalRagStrategy(e);
    const result = await strategy.retrieve({ db: dbWith(0), adminId: 1, chatbot, query: "q" });
    expect(result).toEqual({ context: "", source: "llm_only", chunksUsed: 0 });
    expect(e.calls).toHaveLength(0); // no embedding call
  });

  it("returns empty when search finds no chunks", async () => {
    const e = embedder();
    const strategy = new TraditionalRagStrategy(e);
    const result = await strategy.retrieve({ db: dbWith(1, []), adminId: 1, chatbot, query: "q" });
    expect(result.context).toBe("");
    expect(result.chunksUsed).toBe(0);
  });

  it("joins chunk texts and reports scores", async () => {
    const e = embedder();
    const strategy = new TraditionalRagStrategy(e);
    const result = await strategy.retrieve({
      db: dbWith(1, [
        { id: 1, chunk_text: "chunk one", distance: 0.2 },
        { id: 2, chunk_text: "chunk two", distance: 0.5 },
      ]),
      adminId: 1, chatbot, query: "hello",
    });
    expect(result.source).toBe("traditional_rag");
    expect(result.chunksUsed).toBe(2);
    expect(result.context).toBe("chunk one\n\n---\n\nchunk two");
    expect(result.metadata).toEqual({ scores: [0.8, 0.5] });
    expect(e.calls).toEqual(["hello"]);
  });
});

describe("RetrievalEngine", () => {
  it("dispatches traditional_rag by default", async () => {
    const e = embedder();
    const engine = new RetrievalEngine(e, e);
    const result = await engine.retrieve({ db: dbWith(0), adminId: 1, chatbot, query: "q" });
    expect(result.source).toBe("llm_only");
  });

  it("dispatches page_index (no page-indexed docs → empty)", async () => {
    const e = embedder();
    const engine = new RetrievalEngine(e, e);
    const result = await engine.retrieve({
      db: dbWith(0), adminId: 1,
      chatbot: { ...chatbot, retrieval_strategy: "page_index" },
      query: "q",
    });
    expect(result.context).toBe("");
    expect(result.chunksUsed).toBe(0);
  });
});