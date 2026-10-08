import { describe, it, expect } from "vitest";
import { updateBrandName, updateTimezone } from "@/lib/admin/admin";
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

describe("admin settings service", () => {
  // The registration toggle is gone from this service: it wrote the
  // platform-wide `registration_enabled` row, which no account owns in the
  // solo-admin model. `ALLOW_REGISTRATION` in the environment owns it now, and
  // tests/lib/config.test.ts covers it.
  it("updateBrandName / updateTimezone write to the actor's own row", async () => {
    const b = fakeDb();
    await updateBrandName(b.db, admin, "New Brand");
    expect(b.calls.some((c) => c.sql.includes("brand_name = $1") && c.values?.[0] === "New Brand")).toBe(true);

    const t = fakeDb();
    await updateTimezone(t.db, admin, "America/New_York");
    expect(t.calls.some((c) => c.sql.includes("timezone = $1") && c.values?.[0] === "America/New_York")).toBe(true);
  });
});