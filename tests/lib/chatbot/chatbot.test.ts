import { describe, it, expect } from "vitest";
import {
  processAllowedDomains,
  parseNullableInt,
  parseTokenBudget,
  parseRateLimitPerSession,
  buildModelConfig,
  buildStyling,
  storeChatbot,
  cloneChatbot,
} from "@/lib/chatbot/chatbot";
import type { SessionUser } from "@/lib/auth/session";
import { fakeDb } from "../../helpers";

const admin: SessionUser = {
  user_id: 1,
  admin_id: 1,
  user_role: "admin",
  user_name: "A",
  user_email: "a@x.com",
  email_verified_at: "2026-01-01T00:00:00.000Z",
  brand_name: "Acme",
  company_name: null,
  timezone: "UTC",
};

describe("processAllowedDomains", () => {
  it("returns null for empty input", () => {
    expect(processAllowedDomains(null)).toBeNull();
    expect(processAllowedDomains("  ")).toBeNull();
  });

  it("normalizes full URLs (lowercase, strips scheme/path/default ports)", () => {
    expect(processAllowedDomains("https://Example.COM/path\nhttp://foo.com:80/x")).toBe(
      "example.com\nfoo.com",
    );
  });

  it("preserves explicit non-default ports and wildcard ports", () => {
    expect(processAllowedDomains("example.com:3000\nexample.com:*")).toBe("example.com:3000\nexample.com:*");
  });

  it("strips paths from bare domains and lowercases", () => {
    expect(processAllowedDomains("Foo.Com/bar?x=1")).toBe("foo.com");
  });

  it("drops invalid entries and returns null when none remain", () => {
    expect(processAllowedDomains("!!!")).toBeNull();
    expect(processAllowedDomains("a.com\n!!!\nb.org")).toBe("a.com\nb.org");
  });
});

describe("numeric parsing", () => {
  it("parseNullableInt: empty/non-numeric → null, digits → int", () => {
    expect(parseNullableInt("")).toBeNull();
    expect(parseNullableInt(null)).toBeNull();
    expect(parseNullableInt("abc")).toBeNull();
    expect(parseNullableInt(" 123 ")).toBe(123);
  });

  it("parseTokenBudget: digit-strip, <100 → null", () => {
    expect(parseTokenBudget("")).toBeNull();
    expect(parseTokenBudget("99")).toBeNull();
    expect(parseTokenBudget("$1,000")).toBe(1000);
  });

  it("parseRateLimitPerSession: digit-strip, <1 → null", () => {
    expect(parseRateLimitPerSession("")).toBeNull();
    expect(parseRateLimitPerSession("0")).toBeNull();
    expect(parseRateLimitPerSession("5")).toBe(5);
  });
});

describe("buildModelConfig / buildStyling", () => {
  it("applies defaults", () => {
    expect(buildModelConfig({ name: "x" })).toEqual({ temperature: 0.0, max_tokens: 1024, model: "gpt-4.1-mini" });
  });

  it("treats '0' as the default for numeric fields (PHP ?: semantics)", () => {
    expect(buildModelConfig({ name: "x", maxTokens: "0" }).max_tokens).toBe(1024);
    expect(buildModelConfig({ name: "x", temperature: "0" }).temperature).toBe(0.0);
    expect(buildModelConfig({ name: "x", maxTokens: "500" }).max_tokens).toBe(500);
  });

  it("buildStyling applies all 13 defaults", () => {
    expect(buildStyling({ name: "x" })).toEqual({
      primary_color: "#0d6efd",
      header_text_color: "#ffffff",
      header_gradient_to: "",
      accent_color: "",
      header_icon: "",
      header_subtitle: "",
      placeholder_icon: "",
      placeholder_title: "",
      placeholder_text: "",
      position: "bottom-right",
      bot_name: "Assistant",
      widget_theme: "",
      panel_theme: "light",
    });
  });
});

describe("storeChatbot / cloneChatbot orchestration", () => {
  function auditActions(calls: { sql: string; values?: unknown[] }[]): string[] {
    return calls.filter((c) => c.sql.includes("INSERT INTO audit_logs")).map((c) => c.values?.[2] as string);
  }

  it("storeChatbot creates + logs create_chatbot", async () => {
    const { db, calls } = fakeDb((sql: string) => (/RETURNING id/i.test(sql) ? [{ id: 7 }] : []));
    const id = await storeChatbot(db, admin, { name: "My Bot", allowedDomains: "example.com" });
    expect(id).toBe(7);
    expect(calls.some((c) => c.sql.includes("INSERT INTO chatbots"))).toBe(true);
    // New chatbots get sensible cost defaults (never unlimited).
    const insert = calls.find((c) => c.sql.includes("INSERT INTO chatbots"));
    expect(insert?.values).toContain(1000000);
    expect(insert?.values).toContain(30);
    expect(insert?.values).toContain(2000);
    expect(insert?.values).toContain(50);
    expect(auditActions(calls)).toContain("create_chatbot");
  });

  it("cloneChatbot clones + logs clone_chatbot", async () => {
    const source = {
      id: 1, admin_id: 1, created_by: 1, name: "Orig", industry: null, system_prompt: null,
      model_config: null, styling: null, status: "active", lead_capture_enabled: 0,
      daily_token_budget: null, rate_limit_per_session: null, allowed_domains: null,
      widget_token: "tok", max_message_length: null, max_messages_per_conversation: null,
      retrieval_strategy: "traditional_rag", created_at: "x", updated_at: "y",
    };
    const { db, calls } = fakeDb((sql: string) =>
      /SELECT \* FROM chatbots WHERE id = \$1/.test(sql) ? [source] : [{ id: 12 }],
    );
    const newId = await cloneChatbot(db, admin, 1, "Copy");
    expect(newId).toBe(12);
    expect(auditActions(calls)).toContain("clone_chatbot");
  });
});