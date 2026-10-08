import { describe, it, expect } from "vitest";
import { createMagicLink, findValidMagicLink, markMagicLinkUsed, hasRecentMagicLink } from "@/repository/magic-links";
import { hashToken } from "@/lib/tokens";
import { fakeDb } from "../helpers";

describe("magic links", () => {
  it("createMagicLink stores token + computed expiry", async () => {
    const { db, calls } = fakeDb();
    await createMagicLink(db, "a@x.com", 7, "abc123", 900);
    expect(calls[0].sql).toContain("INSERT INTO magic_links");
    expect(calls[0].sql).toContain("NOW() + ($4::int * INTERVAL '1 second')");
    // The emailed token is a bearer credential: only its digest is stored (SEC-17).
    expect(calls[0].values).toEqual(["a@x.com", 7, hashToken("abc123"), 900]);
    expect(calls[0].values).not.toContain("abc123");
  });

  it("findValidMagicLink requires unexpired + unused", async () => {
    const { db, calls } = fakeDb(() => [{ token: "abc123" }]);
    await findValidMagicLink(db, "abc123");
    expect(calls[0].sql).toContain("expires_at > NOW() AND used_at IS NULL");
    expect(calls[0].values).toEqual([hashToken("abc123")]);
  });

  it("markMagicLinkUsed is guarded by used_at IS NULL", async () => {
    const { db, calls } = fakeDb();
    await markMagicLinkUsed(db, "abc123");
    expect(calls[0].sql).toContain("SET used_at = NOW()");
    expect(calls[0].sql).toContain("AND used_at IS NULL");
    expect(calls[0].values).toEqual([hashToken("abc123")]);
  });

  it("hasRecentMagicLink coerces the EXISTS result to boolean", async () => {
    const { db } = fakeDb(() => [{ exists: true }]);
    expect(await hasRecentMagicLink(db, "a@x.com")).toBe(true);
  });
});