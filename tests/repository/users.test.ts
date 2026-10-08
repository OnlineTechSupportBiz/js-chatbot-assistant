import { describe, it, expect } from "vitest";
import {
  findUserByEmail,
  findUserByVerifyToken,
  setEmailVerifyToken,
  generateSlug,
  createSelfAdmin,
  verifyEmail,
  incrementFailedAttempts,
  resetFailedAttempts,
  lockAccount,
  unlockAccount,
  updateUser,
  getApiKeys,
  setApiKeys,
  getLlmModels,
  setLlmModels,
} from "@/repository/users";
import { hashToken } from "@/lib/tokens";
import { fakeDb } from "../helpers";

describe("findUserByEmail", () => {
  it("lowercases and trims the email", async () => {
    const { db, calls } = fakeDb(() => [{ id: 1 }]);
    await findUserByEmail(db, "  User@Example.COM ");
    expect(calls[0].sql).toContain("WHERE email = $1");
    expect(calls[0].values).toEqual(["user@example.com"]);
  });

  it("returns null when no row", async () => {
    const { db } = fakeDb(() => []);
    expect(await findUserByEmail(db, "a@x.com")).toBeNull();
  });
});

describe("findUserByVerifyToken", () => {
  it("queries the email_verify_token column with the digest of the raw token", async () => {
    const { db, calls } = fakeDb(() => [{ id: 5 }]);
    await findUserByVerifyToken(db, "tok123");
    expect(calls[0].sql).toContain("WHERE email_verify_token = $1");
    expect(calls[0].values).toEqual([hashToken("tok123")]);
  });
});

describe("setEmailVerifyToken", () => {
  it("stores only the digest of the emailed token", async () => {
    const { db, calls } = fakeDb();
    await setEmailVerifyToken(db, 5, "raw-token");
    expect(calls[0].sql).toContain("SET email_verify_token = $2");
    expect(calls[0].values).toEqual([5, hashToken("raw-token")]);
    expect(calls[0].values).not.toContain("raw-token");
  });
});

describe("generateSlug", () => {
  it("lowercases and converts non-alphanumerics to dashes", () => {
    expect(generateSlug("My Company & Co.")).toBe("my-company-co");
  });

  it("falls back to 'user' when empty", () => {
    expect(generateSlug("!!")).toBe("user");
  });
});

describe("createSelfAdmin", () => {
  it("allocates the id from the sequence and inserts role='admin' with admin_id = id", async () => {
    const { db, calls } = fakeDb((sql) => (sql.includes("nextval") ? [{ id: 42 }] : []));
    const id = await createSelfAdmin(db, {
      email: "a@x.com",
      name: "A",
      passwordHash: "hash",
      emailVerifyToken: "tok",
    });
    expect(id).toBe(42);
    expect(calls[0].sql).toContain("nextval");
    const insert = calls.find((c) => c.sql.includes("INSERT INTO users"));
    expect(insert?.sql).toContain("'admin'");
    expect(insert?.values).toEqual([42, "A", "a@x.com", "hash", null, "Chatbot Assistant", hashToken("tok")]);
  });
});

describe("lockout helpers", () => {
  it("verifyEmail clears token and sets verified_at", async () => {
    const { db, calls } = fakeDb();
    await verifyEmail(db, 3);
    expect(calls[0].sql).toContain("email_verified_at = NOW(), email_verify_token = NULL");
    expect(calls[0].values).toEqual([3]);
  });

  it("incrementFailedAttempts increments", async () => {
    const { db, calls } = fakeDb();
    await incrementFailedAttempts(db, 3);
    expect(calls[0].sql).toContain("failed_attempts = failed_attempts + 1");
  });

  it("resetFailedAttempts zeroes attempts and clears lock", async () => {
    const { db, calls } = fakeDb();
    await resetFailedAttempts(db, 3);
    expect(calls[0].sql).toContain("failed_attempts = 0, locked_until = NULL");
  });

  it("lockAccount locks for N minutes", async () => {
    const { db, calls } = fakeDb();
    await lockAccount(db, 3, 15);
    expect(calls[0].sql).toContain("INTERVAL '1 minute'");
    expect(calls[0].values).toEqual([3, 15]);
  });

  it("unlockAccount clears lock", async () => {
    const { db, calls } = fakeDb();
    await unlockAccount(db, 3);
    expect(calls[0].sql).toContain("is_locked = 0");
  });
});

describe("updateUser", () => {
  it("builds a dynamic SET clause", async () => {
    const { db, calls } = fakeDb();
    await updateUser(db, 9, { brand_name: "Acme", timezone: "UTC" });
    expect(calls[0].sql).toContain("SET brand_name = $1, timezone = $2");
    expect(calls[0].values).toEqual(["Acme", "UTC", 9]);
  });

  it("is a no-op for empty fields", async () => {
    const { db, calls } = fakeDb();
    await updateUser(db, 9, {});
    expect(calls).toHaveLength(0);
  });
});

describe("getApiKeys / setApiKeys", () => {
  it("getApiKeys returns stored keys or nulls", async () => {
    const { db } = fakeDb((sql: string) => (/SELECT openai_api_key/i.test(sql) ? [{ openai_api_key: "sk-1", llamacloud_api_key: null }] : []));
    expect(await getApiKeys(db, 1)).toEqual({ openai_api_key: "sk-1", llamacloud_api_key: null });
  });

  it("setApiKeys clears empty values to null", async () => {
    const { db, calls } = fakeDb();
    await setApiKeys(db, 1, { openai_api_key: "sk-abc", llamacloud_api_key: "" });
    expect(calls[0].sql).toContain("openai_api_key = $1");
    expect(calls[0].values).toEqual(["sk-abc", null, 1]);
  });

  it("setApiKeys only updates provided fields", async () => {
    const { db, calls } = fakeDb();
    await setApiKeys(db, 1, { llamacloud_api_key: "llk-x" });
    expect(calls[0].sql).toContain("llamacloud_api_key = $1");
    expect(calls[0].sql).not.toContain("openai_api_key");
  });
});

describe("getLlmModels / setLlmModels", () => {
  it("returns an empty list when unset", async () => {
    const { db } = fakeDb(() => [{ llm_models: null }]);
    expect(await getLlmModels(db, 1)).toEqual([]);
  });

  it("reads a JSONB array already decoded by pg", async () => {
    const entry = { name: "a", base_url: "x", api_key: "k", model: "m" };
    const { db } = fakeDb(() => [{ llm_models: [entry] }]);
    expect(await getLlmModels(db, 1)).toEqual([entry]);
  });

  it("tolerates a string-serialized array", async () => {
    const entry = { name: "a", base_url: "x", api_key: "k", model: "m" };
    const { db } = fakeDb(() => [{ llm_models: JSON.stringify([entry]) }]);
    expect(await getLlmModels(db, 1)).toEqual([entry]);
  });

  it("writes the list as JSON", async () => {
    const entry = { name: "a", base_url: "x", api_key: "k", model: "m" };
    const { db, calls } = fakeDb();
    await setLlmModels(db, 1, [entry]);
    expect(calls[0].sql).toContain("llm_models = $1");
    expect(calls[0].values?.[0]).toBe(JSON.stringify([entry]));
  });
});