import { describe, it, expect } from "vitest";
import { hashToken } from "@/lib/tokens";

describe("hashToken (SEC-17)", () => {
  it("is a 64-character hex SHA-256 digest, the width of every token column", () => {
    const digest = hashToken("a".repeat(64));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    // sessions.id, password_resets.token, magic_links.token and
    // users.email_verify_token are all varchar(64) — a wider digest would silently
    // truncate or fail on write.
    expect(digest.length).toBe(64);
  });

  it("is deterministic and never returns the input", () => {
    expect(hashToken("tok")).toBe(hashToken("tok"));
    expect(hashToken("tok")).not.toBe("tok");
    expect(hashToken("tok")).not.toContain("tok");
  });

  it("separates tokens that differ only slightly", () => {
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });
});
