import { describe, it, expect } from "vitest";
import { storeQuickAnswer, updateQuickAnswer, deleteQuickAnswer, reorderQuickAnswers, ValidationError } from "@/lib/admin/quick-answers";
import type { SessionUser } from "@/lib/auth/session";
import { fakeDb } from "../../helpers";

const admin: SessionUser = {
  user_id: 1, admin_id: 1, user_role: "admin", user_name: "A", user_email: "a@x.com",
  email_verified_at: "2026-01-01T00:00:00.000Z",
  brand_name: "Acme", company_name: null, timezone: "UTC",
};

function auditActions(calls: { sql: string; values?: unknown[] }[]): Array<{ action: string; entityId: unknown; oldValue: unknown; newValue: unknown }> {
  return calls
    .filter((c) => c.sql.includes("INSERT INTO audit_logs"))
    .map((c) => ({ action: c.values?.[2] as string, entityId: c.values?.[4], oldValue: c.values?.[5], newValue: c.values?.[6] }));
}

describe("storeQuickAnswer", () => {
  it("trims and validates trigger/answer", async () => {
    const { db } = fakeDb(() => [{ id: 3 }]);
    await expect(storeQuickAnswer(db, admin, 10, { trigger: "  ", answer: "x" })).rejects.toBeInstanceOf(ValidationError);
    await expect(storeQuickAnswer(db, admin, 10, { trigger: "hours", answer: "" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("inserts with priority 0 / active 1 and logs create_quick_answer", async () => {
    const { db, calls } = fakeDb(() => [{ id: 7 }]);
    const id = await storeQuickAnswer(db, admin, 10, { trigger: "  Hours  ", answer: "9-5" });
    expect(id).toBe(7);
    const insert = calls.find((c) => c.sql.includes("INSERT INTO quick_answers"));
    expect(insert?.values?.[2]).toBe("Hours"); // trimmed
    expect(insert?.values?.[4]).toBe(0); // priority
    expect(insert?.values?.[5]).toBe(1); // is_active
    const audits = auditActions(calls);
    expect(audits[0].action).toBe("create_quick_answer");
    expect(JSON.parse(audits[0].newValue as string)).toEqual({ chatbot_id: 10, trigger: "Hours" });
  });
});

describe("updateQuickAnswer", () => {
  it("updates and logs old/new trigger", async () => {
    const { db, calls } = fakeDb((sql: string) => {
      if (sql.includes("SELECT * FROM quick_answers WHERE id = $1")) return [{ id: 7, trigger: "old" }];
      return [];
    });
    await updateQuickAnswer(db, admin, 7, { trigger: "new", answer: "x", is_active: 0 });
    const audit = auditActions(calls).find((a) => a.action === "update_quick_answer");
    expect(audit).toBeDefined();
    expect(JSON.parse(audit!.oldValue as string)).toEqual({ trigger: "old" });
    expect(JSON.parse(audit!.newValue as string)).toEqual({ trigger: "new" });
  });
});

describe("deleteQuickAnswer", () => {
  it("deletes and logs the old trigger", async () => {
    const { db, calls } = fakeDb((sql: string) => {
      if (sql.includes("SELECT * FROM quick_answers WHERE id = $1")) return [{ id: 7, trigger: "bye" }];
      return [];
    });
    await deleteQuickAnswer(db, admin, 7);
    const audit = auditActions(calls).find((a) => a.action === "delete_quick_answer");
    expect(audit).toBeDefined();
    expect(JSON.parse(audit!.oldValue as string)).toEqual({ trigger: "bye" });
    expect(calls.some((c) => c.sql.includes("DELETE FROM quick_answers WHERE id = $1"))).toBe(true);
  });
});

describe("reorderQuickAnswers", () => {
  it("reorders and logs the count", async () => {
    const { db, calls } = fakeDb();
    await reorderQuickAnswers(db, admin, 10, [10, 20, 30]);
    expect(calls.some((c) => c.sql.includes("UPDATE quick_answers SET priority"))).toBe(true);
    const audit = auditActions(calls).find((a) => a.action === "reorder_quick_answers");
    expect(JSON.parse(audit!.newValue as string)).toEqual({ chatbot_id: 10, count: 3 });
  });
});