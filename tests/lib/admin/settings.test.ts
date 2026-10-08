import { describe, it, expect } from "vitest";
import { getAdminSettings, updateAdminSettings } from "@/lib/admin/settings";
import type { SessionUser } from "@/lib/auth/session";
import { fakeDb } from "../../helpers";

const admin: SessionUser = {
  user_id: 1, admin_id: 1, user_role: "admin", user_name: "A", user_email: "a@x.com",
  email_verified_at: "2026-01-01T00:00:00.000Z",
  brand_name: "Acme", company_name: null, timezone: "UTC",
};

describe("getAdminSettings", () => {
  it("masks API keys server-side (never returns the raw key)", async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes("SELECT * FROM users WHERE id")) return [{ brand_name: "Acme", timezone: "America/New_York" }];
      if (sql.includes("openai_api_key")) return [{ openai_api_key: "sk-abcdef123456", llamacloud_api_key: null }];
      return [];
    });
    const s = await getAdminSettings(db, admin);
    expect(s.brand_name).toBe("Acme");
    expect(s.timezone).toBe("America/New_York");
    // The dropdown list is generated server-side: IANA value + human label,
    // "UTC" first (absent from Intl.supportedValuesOf, but the schema default).
    expect(s.timezones[0]).toEqual({ value: "UTC", label: "UTC (Coordinated Universal Time)" });
    expect(s.timezones.find((o) => o.value === "America/Phoenix")?.label).toBe("US Mountain (Phoenix — no DST)");
    expect(s.openai_api_key_hint).toBe("sk-...3456");
    expect(s.openai_api_key_hint).not.toContain("abcdef");
    expect(s.llamacloud_api_key_hint).toBeNull();
  });
});

describe("updateAdminSettings", () => {
  it("only writes API keys when a non-empty value is supplied", async () => {
    const { db, calls } = fakeDb();
    await updateAdminSettings(db, admin, { brand_name: "New", openai_api_key: "", llamacloud_api_key: "  " });
    // brand_name update happens, but no setApiKeys call for empty keys
    expect(calls.some((c) => c.sql.includes("brand_name = $1"))).toBe(true);
    expect(calls.some((c) => c.sql.includes("openai_api_key = $1"))).toBe(false);
    expect(calls.some((c) => c.sql.includes("llamacloud_api_key = $1"))).toBe(false);
  });

  it("writes a real key when provided", async () => {
    const { db, calls } = fakeDb();
    await updateAdminSettings(db, admin, { openai_api_key: "sk-real" });
    expect(calls.some((c) => c.sql.includes("openai_api_key = $1"))).toBe(true);
  });

  it("enqueues a re-embed when the embedding model changes", async () => {
    const { db, calls } = fakeDb((sql) => {
      if (sql.includes("SELECT openai_api_key")) {
        return [{ openai_api_key: null, llamacloud_api_key: null, llm_base_url: null, embedding_base_url: null, embedding_api_key: null, embedding_model: "text-embedding-3-small" }];
      }
      return [];
    });
    await updateAdminSettings(db, admin, { embedding_model: "text-embedding-3-large" });
    expect(calls.some((c) => c.sql.includes("INSERT INTO document_jobs"))).toBe(true);
  });

  it("does not re-embed when the embedding model is unchanged", async () => {
    const { db, calls } = fakeDb((sql) => {
      if (sql.includes("SELECT openai_api_key")) {
        return [{ openai_api_key: null, llamacloud_api_key: null, llm_base_url: null, embedding_base_url: null, embedding_api_key: null, embedding_model: "text-embedding-3-small" }];
      }
      return [];
    });
    await updateAdminSettings(db, admin, { embedding_model: "text-embedding-3-small" });
    expect(calls.some((c) => c.sql.includes("INSERT INTO document_jobs"))).toBe(false);
  });
});