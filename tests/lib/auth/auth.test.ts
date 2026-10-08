import { describe, it, expect } from "vitest";
import {
  login,
  register,
  verifyEmailToken,
  requestPasswordReset,
  resetPassword,
  requestMagicLink,
  verifyMagicLink,
  completeMfaEnrollment,
  consumeRecoveryCode,
} from "@/lib/auth/auth";
import { hashPassword, hashRecoveryCode } from "@/lib/auth/crypto";
import { generateTotpToken, generateTotpSecret } from "@/lib/auth/totp";
import type { UserRow } from "@/repository/users";
import { fakeDb } from "../../helpers";

function mkUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: 7,
    admin_id: 7,
    name: "Admin",
    company_name: null,
    brand_name: "Acme",
    slug: "acme",
    is_active: 1,
    email: "a@x.com",
    password_hash: "hash",
    role: "admin",
    email_verified_at: "2026-01-01 00:00:00",
    email_verify_token: null,
    mfa_secret: null,
    mfa_enabled: 0,
    mfa_recovery_codes: null,
    openai_api_key: null,
    llamacloud_api_key: null,
    llm_base_url: null,
    embedding_base_url: null,
    embedding_api_key: null,
    embedding_model: null,
    llm_models: null,
    is_locked: 0,
    locked_until: null,
    failed_attempts: 0,
    last_login_at: null,
    timezone: "UTC",
    created_at: "2026-01-01 00:00:00",
    updated_at: "2026-01-01 00:00:00",
    ...overrides,
  };
}

function responder(user: UserRow | null, rateCount = 0): (sql: string) => unknown[] {
  return (sql: string) => {
    if (sql.includes("FROM users WHERE email")) return user ? [user] : [];
    if (sql.includes("FROM rate_limits") && sql.includes("SELECT COUNT")) return [{ cnt: rateCount }];
    if (sql.includes("RETURNING id")) return [{ id: 5 }];
    // The failed-attempt counter is incremented by the database and its new value
    // is returned, so the fake has to model the RETURNING clause.
    if (sql.includes("failed_attempts = failed_attempts + 1"))
      return [{ failed_attempts: (user?.failed_attempts ?? 0) + 1 }];
    if (sql.includes("SELECT (is_locked")) return [{ locked: true }];
    if (sql.includes("WHERE role = 'admin'")) return user ? [user] : [];
    if (sql.includes("FROM users WHERE email_verify_token")) return user ? [user] : [];
    return [];
  };
}

function auditActions(calls: { sql: string; values?: unknown[] }[]): string[] {
  return calls
    .filter((c) => c.sql.includes("INSERT INTO audit_logs"))
    .map((c) => c.values?.[2] as string);
}

describe("login", () => {
  it("succeeds and resets attempts + clears rate limit + logs 'login'", async () => {
    const user = mkUser({ password_hash: await hashPassword("correct") });
    const { db, calls } = fakeDb(responder(user));
    const r = await login(db, { email: "a@x.com", password: "correct", remember: false, ip: "1.2.3.4" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.user.user_email).toBe("a@x.com");
      expect(r.needsMfa).toBe(false);
    }
    const sqls = calls.map((c) => c.sql);
    expect(sqls.some((s) => s.includes("failed_attempts = 0, locked_until = NULL"))).toBe(true);
    expect(sqls.some((s) => s.includes("last_login_at = NOW()"))).toBe(true);
    expect(auditActions(calls)).toContain("login");
  });

  it("rejects a wrong password (<threshold) and logs login_failed", async () => {
    const user = mkUser({ password_hash: await hashPassword("correct"), failed_attempts: 1 });
    const { db, calls } = fakeDb(responder(user));
    const r = await login(db, { email: "a@x.com", password: "wrong", remember: false, ip: "1.2.3.4" });
    expect(r).toEqual({ ok: false, status: 401, error: "Invalid email or password." });
    expect(calls.some((c) => c.sql.includes("failed_attempts = failed_attempts + 1"))).toBe(true);
    expect(auditActions(calls)).toContain("login_failed");
  });

  it("locks the account on the 5th failed attempt", async () => {
    const user = mkUser({ password_hash: await hashPassword("correct"), failed_attempts: 4 });
    const { db, calls } = fakeDb(responder(user));
    const r = await login(db, { email: "a@x.com", password: "wrong", remember: false, ip: "1.2.3.4" });
    expect(r.ok).toBe(false);
    expect(calls.some((c) => c.sql.includes("failed_attempts = failed_attempts + 1"))).toBe(true);
    expect(calls.some((c) => c.sql.includes("is_locked = 1, locked_until"))).toBe(true);
    expect(auditActions(calls)).toContain("account_locked");
    expect(auditActions(calls)).toContain("login_failed");
  });

  it("rejects a currently-locked account", async () => {
    const user = mkUser({ password_hash: await hashPassword("correct"), is_locked: 1 });
    const { db, calls } = fakeDb(responder(user));
    const r = await login(db, { email: "a@x.com", password: "correct", remember: false, ip: "1.2.3.4" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(429);
    expect(auditActions(calls)).toContain("login_locked");
  });

  it("rejects an inactive account with the same 401 as a bad password", async () => {
    const user = mkUser({ password_hash: await hashPassword("correct"), is_active: 0 });
    const { db, calls } = fakeDb(responder(user));
    const r = await login(db, { email: "a@x.com", password: "correct", remember: false, ip: "1.2.3.4" });
    expect(r.ok).toBe(false);
    // A distinct status/message here was an account-enumeration oracle: 403 proved
    // the address exists. The audit trail still records the real reason.
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.error).toBe("Invalid email or password.");
    }
    expect(auditActions(calls)).toContain("login_disabled");
  });

  it("rejects an unverified account", async () => {
    const user = mkUser({ password_hash: await hashPassword("correct"), email_verified_at: null });
    const { db, calls } = fakeDb(responder(user));
    const r = await login(db, { email: "a@x.com", password: "correct", remember: false, ip: "1.2.3.4" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
    expect(auditActions(calls)).toContain("login_unverified");
  });

  it("flags needsMfa when MFA is enabled", async () => {
    const user = mkUser({ password_hash: await hashPassword("correct"), mfa_enabled: 1, mfa_secret: "SECRET" });
    const { db } = fakeDb(responder(user));
    const r = await login(db, { email: "a@x.com", password: "correct", remember: false, ip: "1.2.3.4" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.needsMfa).toBe(true);
  });

  it("rejects when the per-IP rate limit is exceeded", async () => {
    const user = mkUser({ password_hash: await hashPassword("correct") });
    const { db } = fakeDb(responder(user, 10));
    const r = await login(db, { email: "a@x.com", password: "correct", remember: false, ip: "1.2.3.4" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(429);
  });

  it("rejects an unknown email with a generic 401", async () => {
    const { db } = fakeDb(responder(null));
    const r = await login(db, { email: "nobody@x.com", password: "x", remember: false, ip: "1.2.3.4" });
    expect(r).toEqual({ ok: false, status: 401, error: "Invalid email or password." });
  });
});

describe("register", () => {
  it("creates a self-admin account (role='admin', admin_id = own id) and grants widget permissions", async () => {
    const { db, calls } = fakeDb((sql: string) => {
      if (sql.includes("nextval")) return [{ id: 42 }];
      if (sql.includes("FROM users WHERE email")) return []; // no duplicate
      return [];
    });
    const r = await register(db, { name: "New", email: "new@x.com", password: "password1", ip: "1.2.3.4" });
    expect(r.ok).toBe(true);
    if (r.ok && r.kind === "created") {
      expect(r.verifyToken).toMatch(/^[0-9a-f]{64}$/);
      expect(r.user.user_role).toBe("admin");
      expect(r.user.admin_id).toBe(42);
      // Registration does not verify the address, and the admin area checks this.
      expect(r.user.email_verified_at).toBeNull();
    } else {
      throw new Error("expected a created account");
    }
    const permInserts = calls.filter((c) => c.sql.includes("INSERT INTO user_permissions"));
    expect(permInserts).toHaveLength(2);
    expect(auditActions(calls)).toContain("register");
  });

  it("rejects a password shorter than the minimum (PHP parity)", async () => {
    const { db, calls } = fakeDb(responder(null));
    const r = await register(db, { name: "New", email: "new@x.com", password: "short1", ip: "1.2.3.4" });
    expect(r).toEqual({ ok: false, status: 400, error: "Password must be at least 8 characters." });
    // Rejected before any account row or token is created.
    expect(calls.some((c) => c.sql.includes("nextval"))).toBe(false);
    expect(calls.some((c) => c.sql.includes("INSERT INTO users"))).toBe(false);
  });

  it("rejects an over-long password instead of hashing it", async () => {
    const { db, calls } = fakeDb(responder(null));
    const r = await register(db, { name: "New", email: "new@x.com", password: "x".repeat(201), ip: "1.2.3.4" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Password must be at most 200 characters.");
    expect(calls.some((c) => c.sql.includes("INSERT INTO users"))).toBe(false);
  });

  it("rejects a malformed email address", async () => {
    const { db } = fakeDb(responder(null));
    const r = await register(db, { name: "New", email: "not-an-email", password: "password1", ip: "1.2.3.4" });
    expect(r).toEqual({ ok: false, status: 400, error: "Please enter a valid email address." });
  });

  it("answers a duplicate email identically to a signup, creating nothing", async () => {
    const { db, calls } = fakeDb(responder(mkUser()));
    const r = await register(db, { name: "Dup", email: "a@x.com", password: "password1", ip: "1.2.3.4" });
    // Not an error: the route answers the same both ways so signup cannot be used
    // to enumerate registered addresses.
    expect(r).toEqual({ ok: true, kind: "exists", email: "a@x.com" });
    expect(calls.some((c) => c.sql.includes("nextval"))).toBe(false);
    expect(calls.some((c) => c.sql.includes("INSERT INTO users"))).toBe(false);
  });
});

describe("password reset", () => {
  it("enforces the password policy on reset too", async () => {
    const { db, calls } = fakeDb(() => []);
    const r = await resetPassword(db, "a@x.com", "tok", "short");
    expect(r).toEqual({ ok: false, status: 400, error: "Password must be at least 8 characters." });
    expect(calls.some((c) => c.sql.includes("UPDATE users SET password_hash"))).toBe(false);
  });

  it("revokes existing sessions once the password changes", async () => {
    const user = mkUser();
    const { db, calls } = fakeDb((sql: string) => {
      if (sql.includes("FROM password_resets")) return [{ email: "a@x.com", token: "tok", used: 0, expires_at: "x", created_at: "x" }];
      if (sql.includes("FROM users WHERE email")) return [user];
      return [];
    });
    const r = await resetPassword(db, "a@x.com", "tok", "brandnewpassword");
    expect(r.ok).toBe(true);
    // A session captured before the reset must not outlive it.
    const revoke = calls.find((c) => c.sql.includes("DELETE FROM sessions"));
    expect(revoke).toBeDefined();
    expect(revoke?.values).toEqual([user.id]);
  });
});

describe("email verification", () => {
  it("verifies a valid token", async () => {
    const user = mkUser({ email_verify_token: "tok" });
    const { db, calls } = fakeDb((sql) => (sql.includes("email_verify_token") ? [user] : []));
    const r = await verifyEmailToken(db, "tok");
    expect(r.ok).toBe(true);
    expect(calls.some((c) => c.sql.includes("email_verified_at = NOW(), email_verify_token = NULL"))).toBe(true);
  });

  it("rejects an invalid token", async () => {
    const { db } = fakeDb(() => []);
    const r = await verifyEmailToken(db, "bad");
    expect(r.ok).toBe(false);
  });
});

describe("password reset", () => {
  it("issues no token for an unknown email (anti-enumeration)", async () => {
    const { db } = fakeDb(() => []);
    const r = await requestPasswordReset(db, "unknown@x.com");
    expect(r.token).toBe("");
  });

  it("rejects an invalid reset token", async () => {
    const { db } = fakeDb(() => []);
    const r = await resetPassword(db, "a@x.com", "badtoken", "newpassword");
    expect(r.ok).toBe(false);
  });
});

describe("magic links", () => {
  it("issues no token for an unknown email", async () => {
    const { db } = fakeDb(() => []);
    const r = await requestMagicLink(db, "unknown@x.com");
    expect(r.token).toBe("");
  });

  it("rejects an invalid magic link", async () => {
    const { db } = fakeDb(() => []);
    const r = await verifyMagicLink(db, "badtoken");
    expect(r.ok).toBe(false);
  });
});

describe("MFA", () => {
  it("rejects enrollment with a wrong code", async () => {
    const { db } = fakeDb(() => []);
    const r = await completeMfaEnrollment(db, 7, generateTotpSecret(), ["A-B"], "000000");
    expect(r.ok).toBe(false);
  });

  it("consumeRecoveryCode accepts a valid code once and removes it", async () => {
    const code = "ABC12-9XYZZ";
    const user = mkUser({ mfa_recovery_codes: JSON.stringify([hashRecoveryCode(code), hashRecoveryCode("OTHER-OTHER")]) });
    const { db, calls } = fakeDb((sql) => (sql.includes("SELECT * FROM users WHERE id") ? [user] : []));
    const first = await consumeRecoveryCode(db, 7, code.toLowerCase());
    expect(first.success).toBe(true);
    expect(first.remaining).toBe(1);
    expect(calls.some((c) => c.sql.includes("mfa_recovery_codes = $1"))).toBe(true);
  });

  it("consumeRecoveryCode rejects an invalid code", async () => {
    const user = mkUser({ mfa_recovery_codes: JSON.stringify([hashRecoveryCode("ABC12-9XYZZ")]) });
    const { db } = fakeDb((sql) => (sql.includes("SELECT * FROM users WHERE id") ? [user] : []));
    const r = await consumeRecoveryCode(db, 7, "WRONG-00000");
    expect(r.success).toBe(false);
  });
});

describe("MFA TOTP round-trip", () => {
  it("verifyMfaChallenge validates a real token against the secret", async () => {
    const { verifyMfaChallenge } = await import("@/lib/auth/auth");
    const secret = (await import("@/lib/auth/totp")).generateTotpSecret();
    expect(verifyMfaChallenge(secret, generateTotpToken(secret))).toBe(true);
    expect(verifyMfaChallenge(secret, "000000")).toBe(false);
  });
});