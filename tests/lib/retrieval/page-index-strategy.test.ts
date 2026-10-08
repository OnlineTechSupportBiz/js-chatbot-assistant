import { describe, it, expect } from "vitest";
import { PageIndexStrategy } from "@/lib/retrieval/page-index-strategy";
import type { ChatCompletions } from "@/lib/openai/client";
import type { ChatbotRow } from "@/repository/chatbots";
import { fakeDb } from "../../helpers";

const chatbot: ChatbotRow = {
  id: 3, admin_id: 1, created_by: 1, name: "Bot", industry: null, system_prompt: null,
  model_config: { temperature: 0, max_tokens: 1024, model: "gpt-4.1-mini" }, styling: null,
  status: "active", lead_capture_enabled: 0, daily_token_budget: null, rate_limit_per_session: null, rate_limit_per_ip: null, rate_limit_per_token: null,
  allowed_domains: null, widget_token: "tok", max_message_length: null, max_messages_per_conversation: null,
  retrieval_strategy: "page_index", created_at: "x", updated_at: "y",
};

const outline = [
  { id: 1, parent_id: null, document_id: 5, node_type: "section", heading: "Intro", heading_level: 1, node_order: 0 },
  { id: 2, parent_id: 1, document_id: 5, node_type: "subsection", heading: "Details", heading_level: 2, node_order: 1 },
];

const content = [
  { id: 1, heading: "Intro", content: "intro text", node_type: "section", document_id: 5 },
  { id: 2, heading: "Details", content: "detail text", node_type: "subsection", document_id: 5 },
];

function dbWith(opts: { count?: number; outline?: unknown[]; content?: unknown[] } = {}) {
  const { db, calls } = fakeDb((sql: string) => {
    if (sql.includes("COUNT(DISTINCT document_id)")) return [{ c: opts.count ?? 0 }];
    if (sql.includes("heading_level")) return opts.outline ?? [];
    if (sql.includes("id IN")) return opts.content ?? [];
    return [];
  });
  return { db, calls };
}

const fakeOpenai: ChatCompletions = { async chatCompletion() { return { content: "[1, 2]", total_tokens: 50 }; } };

describe("PageIndexStrategy", () => {
  it("returns empty when no page-indexed documents", async () => {
    const strategy = new PageIndexStrategy(fakeOpenai);
    const result = await strategy.retrieve({ db: dbWith({ count: 0 }).db, adminId: 1, chatbot, query: "q" });
    expect(result).toEqual({ context: "", source: "llm_only", chunksUsed: 0 });
  });

  it("navigates the outline via the LLM and formats section content", async () => {
    const strategy = new PageIndexStrategy(fakeOpenai);
    const result = await strategy.retrieve({
      db: dbWith({ count: 1, outline, content }).db,
      adminId: 1, chatbot, query: "tell me about details",
    });
    expect(result.source).toBe("page_index");
    expect(result.chunksUsed).toBe(2);
    expect(result.context).toBe("## Intro\n\nintro text\n\n---\n\n## Details\n\ndetail text");
    expect(result.metadata).toEqual({ node_ids: [1, 2] });
  });

  it("returns empty when the LLM selects no sections", async () => {
    const noop: ChatCompletions = { async chatCompletion() { return { content: "[]", total_tokens: 5 }; } };
    const strategy = new PageIndexStrategy(noop);
    const result = await strategy.retrieve({ db: dbWith({ count: 1, outline }).db, adminId: 1, chatbot, query: "q" });
    expect(result.context).toBe("");
    expect(result.chunksUsed).toBe(0);
  });

  it("returns empty when the LLM returns invalid JSON", async () => {
    const bad: ChatCompletions = { async chatCompletion() { return { content: "no ids here", total_tokens: 5 }; } };
    const strategy = new PageIndexStrategy(bad);
    const result = await strategy.retrieve({ db: dbWith({ count: 1, outline }).db, adminId: 1, chatbot, query: "q" });
    expect(result.context).toBe("");
  });
});