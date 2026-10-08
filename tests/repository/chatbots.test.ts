import { describe, it, expect } from "vitest";
import { createChatbot, findByWidgetToken, findActiveByAdmin, cloneChatbot, generateWidgetToken, updateChatbot } from "@/repository/chatbots";
import { fakeDb } from "../helpers";

describe("chatbots repository", () => {
  it("generateWidgetToken returns a 64-hex token", () => {
    expect(generateWidgetToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("findByWidgetToken requires active status", async () => {
    const { db, calls } = fakeDb(() => [{ id: 1 }]);
    await findByWidgetToken(db, "tok");
    expect(calls[0].sql).toContain("widget_token = $1 AND status = 'active'");
    expect(calls[0].values).toEqual(["tok"]);
  });

  it("findActiveByAdmin filters status='active'", async () => {
    const { db, calls } = fakeDb(() => []);
    await findActiveByAdmin(db, 7);
    expect(calls[0].sql).toContain("admin_id = $1 AND status = 'active'");
  });

  it("createChatbot JSON-encodes model_config/styling and mints a widget token", async () => {
    const { db, calls } = fakeDb(() => [{ id: 42 }]);
    const id = await createChatbot(db, {
      adminId: 1,
      createdBy: 1,
      name: "Bot",
      modelConfig: { temperature: 0.1, max_tokens: 500, model: "gpt-4.1-mini" },
      styling: { primary_color: "#fff", header_text_color: "#000", header_gradient_to: "", accent_color: "", header_icon: "", header_subtitle: "", placeholder_icon: "", placeholder_title: "", placeholder_text: "", position: "bottom-right", bot_name: "B", widget_theme: "", panel_theme: "light" },
    });
    expect(id).toBe(42);
    expect(calls[0].sql).toContain("INSERT INTO chatbots");
    const values = calls[0].values as unknown[];
    // model_config (index 6) and styling (index 7) are JSON strings
    expect(typeof values[5]).toBe("string");
    expect(JSON.parse(values[5] as string).temperature).toBe(0.1);
    // widget token (index 12) is a 64-hex string
    expect(values[12]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("updateChatbot JSON-encodes model_config/styling fields", async () => {
    const { db, calls } = fakeDb();
    await updateChatbot(db, 3, { model_config: { temperature: 0.5, max_tokens: 100, model: "x" } });
    expect(calls[0].sql).toContain("model_config = $1");
    expect(JSON.parse(calls[0].values?.[0] as string).temperature).toBe(0.5);
  });

  it("cloneChatbot throws when the source is missing", async () => {
    const { db } = fakeDb(() => []);
    await expect(cloneChatbot(db, 999, "Clone")).rejects.toThrow("Source chatbot not found");
  });

  it("cloneChatbot copies fields with a fresh token and new name", async () => {
    const source = {
      id: 1, admin_id: 5, created_by: 6, name: "Orig", industry: "Healthcare", system_prompt: "p",
      model_config: { temperature: 0, max_tokens: 100, model: "m" }, styling: null, status: "active",
      lead_capture_enabled: 1, daily_token_budget: 1000, rate_limit_per_session: 3, allowed_domains: "a.com",
      widget_token: "old", max_message_length: 100, max_messages_per_conversation: null, retrieval_strategy: "page_index",
      created_at: "x", updated_at: "y",
    };
    const { db, calls } = fakeDb((sql: string) => (/SELECT \* FROM chatbots WHERE id = \$1/.test(sql) ? [source] : [{ id: 99 }]));
    const newId = await cloneChatbot(db, 1, "Clone");
    expect(newId).toBe(99);
    const insert = calls.find((c) => c.sql.includes("INSERT INTO chatbots"));
    expect(insert?.values?.[2]).toBe("Clone"); // name
    expect(insert?.values?.[15]).toBe("page_index"); // retrieval_strategy
  });
});