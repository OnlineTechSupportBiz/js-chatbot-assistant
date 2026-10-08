import { describe, it, expect } from "vitest";
import {
  generateSessionId,
  generateCsrfToken,
  csrfMatches,
  buildSessionUser,
  sessionCookieAttributes,
  SESSION_COOKIE_NAME,
  REMEMBER_TTL_SECONDS,
} from "@/lib/auth/session";

describe("generateSessionId / generateCsrfToken", () => {
  it("produces 64-hex tokens", () => {
    expect(generateSessionId()).toMatch(/^[0-9a-f]{64}$/);
    expect(generateCsrfToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("are unique across calls", () => {
    expect(generateSessionId()).not.toBe(generateSessionId());
    expect(generateCsrfToken()).not.toBe(generateCsrfToken());
  });
});

describe("csrfMatches", () => {
  it("matches equal tokens and rejects differences (constant-time)", () => {
    expect(csrfMatches("abc", "abc")).toBe(true);
    expect(csrfMatches("abc", "abd")).toBe(false);
  });

  it("rejects missing/empty tokens", () => {
    expect(csrfMatches(undefined, "x")).toBe(false);
    expect(csrfMatches("x", null)).toBe(false);
    expect(csrfMatches("", "")).toBe(false);
  });
});

describe("buildSessionUser", () => {
  it("maps user columns to the session shape with defaults", () => {
    expect(
      buildSessionUser({ id: 1, admin_id: 1, role: "admin", name: "A", email: "a@x.com" }),
    ).toEqual({
      user_id: 1,
      admin_id: 1,
      user_role: "admin",
      user_name: "A",
      user_email: "a@x.com",
      email_verified_at: null,
      brand_name: "Chatbot Assistant",
      company_name: null,
      timezone: "UTC",
    });
  });

  it("carries the email-verified timestamp through to the session", () => {
    const verified = buildSessionUser({
      id: 2,
      admin_id: 2,
      role: "admin",
      name: "B",
      email: "b@x.com",
      email_verified_at: "2026-01-01T00:00:00.000Z",
    });
    expect(verified.email_verified_at).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("sessionCookieAttributes", () => {
  it("is HttpOnly + SameSite=Lax, secure-only on HTTPS", () => {
    const c = sessionCookieAttributes("id", { remember: false, lifetimeMinutes: 1440, secure: true });
    expect(c.name).toBe(SESSION_COOKIE_NAME);
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe("lax");
    expect(c.secure).toBe(true);
    expect(c.path).toBe("/");
    expect(c.maxAge).toBe(1440 * 60);
  });

  it("leaves secure=false when not HTTPS", () => {
    expect(sessionCookieAttributes("id", { remember: false, lifetimeMinutes: 120, secure: false }).secure).toBe(false);
  });

  it("uses the 30-day TTL for remember-me", () => {
    expect(sessionCookieAttributes("id", { remember: true, lifetimeMinutes: 100, secure: false }).maxAge).toBe(
      REMEMBER_TTL_SECONDS,
    );
  });
});