import { describe, it, expect } from "vitest";
import { canAccessChatbot } from "@/lib/chatbot/access";
import type { SessionUser } from "@/lib/auth/session";
import type { ChatbotRow } from "@/repository/chatbots";

const chatbot: ChatbotRow = {
  id: 10, admin_id: 1, created_by: 5, name: "Bot", industry: null, system_prompt: null,
  model_config: null, styling: null, status: "active", lead_capture_enabled: 0,
  daily_token_budget: null, rate_limit_per_session: null, rate_limit_per_ip: null, rate_limit_per_token: null, allowed_domains: null, widget_token: "tok",
  max_message_length: null, max_messages_per_conversation: null, retrieval_strategy: "traditional_rag",
  created_at: "x", updated_at: "y",
};

const owner: SessionUser = { user_id: 1, admin_id: 1, user_role: "admin", user_name: "A", user_email: "a@x.com", email_verified_at: "2026-01-01T00:00:00.000Z", brand_name: "Acme", company_name: null, timezone: "UTC" };
const otherUser: SessionUser = { user_id: 2, admin_id: 2, user_role: "admin", user_name: "B", user_email: "b@x.com", email_verified_at: "2026-01-01T00:00:00.000Z", brand_name: "B", company_name: null, timezone: "UTC" };

describe("canAccessChatbot", () => {
  it("grants access when the chatbot is in the user's own tenant (admin_id match)", () => {
    expect(canAccessChatbot(chatbot, owner)).toBe(true); // admin_id 1 === 1
  });

  it("denies cross-tenant access (admin_id mismatch)", () => {
    expect(canAccessChatbot(chatbot, otherUser)).toBe(false); // admin_id 2 !== 1
  });

  it("ignores created_by for access (only the tenant id matters)", () => {
    const sameTenantDifferentId: SessionUser = { ...owner, user_id: 99 };
    expect(canAccessChatbot(chatbot, sameTenantDifferentId)).toBe(true);
  });
});