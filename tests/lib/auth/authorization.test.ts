import { describe, it, expect } from "vitest";
import { isAdmin, hasRole, isAuthenticated, hasPermission, sameAdmin } from "@/lib/auth/authorization";
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

const member: SessionUser = {
  user_id: 2,
  admin_id: 1,
  user_role: "user",
  user_name: "M",
  user_email: "m@x.com",
  email_verified_at: "2026-01-01T00:00:00.000Z",
  brand_name: "Acme",
  company_name: null,
  timezone: "UTC",
};

describe("isAdmin / hasRole / isAuthenticated", () => {
  it("identifies the admin role", () => {
    expect(isAdmin(admin)).toBe(true);
    expect(isAdmin(member)).toBe(false);
    expect(isAdmin(null)).toBe(false);
  });

  it("checks role membership", () => {
    expect(hasRole(admin, ["admin"])).toBe(true);
    expect(hasRole(member, ["admin", "user"])).toBe(true);
    expect(hasRole(member, ["admin"])).toBe(false);
    expect(hasRole(null, ["admin"])).toBe(false);
  });

  it("checks authentication", () => {
    expect(isAuthenticated(admin)).toBe(true);
    expect(isAuthenticated(null)).toBe(false);
  });
});

describe("hasPermission", () => {
  it("admin bypasses widget_* checks without touching the DB", async () => {
    const { db, calls } = fakeDb();
    expect(await hasPermission(db, admin, "widget_chat")).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("non-admin: non-widget permissions are granted (legacy pages are no-ops)", async () => {
    const { db, calls } = fakeDb();
    expect(await hasPermission(db, member, "manage_chatbots")).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("non-admin: widget_* goes through the DB toggle", async () => {
    const { db } = fakeDb((sql: string) => (/SELECT enabled/i.test(sql) ? [{ enabled: 1 }] : []));
    expect(await hasPermission(db, member, "widget_chat")).toBe(true);
    const off = fakeDb(() => []);
    expect(await hasPermission(off.db, member, "widget_chat")).toBe(false);
  });
});

describe("sameAdmin", () => {
  it("matches only the resource's own admin_id (no cross-tenant god-mode)", () => {
    expect(sameAdmin(admin, { admin_id: 1 })).toBe(true);
    expect(sameAdmin(admin, { admin_id: 999 })).toBe(false);
    expect(sameAdmin(member, { admin_id: 1 })).toBe(true);
    expect(sameAdmin(member, { admin_id: 2 })).toBe(false);
  });

  it("denies a null resource", () => {
    expect(sameAdmin(member, null)).toBe(false);
  });
});