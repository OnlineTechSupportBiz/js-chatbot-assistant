import { describe, it, expect } from "vitest";
import { upsertPasswordReset, findValidPasswordReset, markPasswordResetUsed, hasActivePasswordReset } from "@/repository/password-resets";
import { hashToken } from "@/lib/tokens";
import { fakeDb } from "../helpers";

describe("password resets", () => {
  it("upsertPasswordReset uses ON CONFLICT (email) DO UPDATE", async () => {
    const { db, calls } = fakeDb();
    await upsertPasswordReset(db, "a@x.com", "tok", 3600);
    expect(calls[0].sql).toContain("ON CONFLICT (email) DO UPDATE");
    // A reset link is account takeover for whoever holds it, so the column holds a
    // digest — a database read must not yield a usable link (SEC-17).
    expect(calls[0].values).toEqual(["a@x.com", hashToken("tok"), 3600]);
    expect(calls[0].values).not.toContain("tok");
  });

  it("findValidPasswordReset requires valid + unused + unexpired", async () => {
    const { db, calls } = fakeDb(() => [{ email: "a@x.com" }]);
    await findValidPasswordReset(db, "a@x.com", "tok");
    expect(calls[0].sql).toContain("used = 0 AND expires_at > NOW()");
    expect(calls[0].values).toEqual(["a@x.com", hashToken("tok")]);
  });

  it("markPasswordResetUsed sets the used flag", async () => {
    const { db, calls } = fakeDb();
    await markPasswordResetUsed(db, "a@x.com");
    expect(calls[0].sql).toContain("SET used = 1");
  });

  it("hasActivePasswordReset returns boolean", async () => {
    const { db } = fakeDb(() => [{ exists: false }]);
    expect(await hasActivePasswordReset(db, "a@x.com")).toBe(false);
  });
});