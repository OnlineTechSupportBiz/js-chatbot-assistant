import { describe, it, expect } from "vitest";
import { createSession, findSessionById, updateSessionPayload, deleteSession, deleteSessionsByUserId } from "@/repository/sessions";
import { hashToken } from "@/lib/tokens";
import { fakeDb } from "../helpers";

describe("sessions repository", () => {
  it("createSession inserts id/user/admin/payload and a unix last_activity", async () => {
    const { db, calls } = fakeDb();
    await createSession(db, {
      id: "sess1",
      userId: 1,
      adminId: 1,
      ipAddress: "1.2.3.4",
      userAgent: "UA",
      payload: "{}",
    });
    expect(calls[0].sql).toContain("INSERT INTO sessions");
    // The session id IS the cookie value, so the row holds a digest: a database
    // read must not yield working session cookies for every logged-in user (SEC-17).
    expect(calls[0].values?.slice(0, 6)).toEqual([hashToken("sess1"), 1, 1, "1.2.3.4", "UA", "{}"]);
    expect(calls[0].values).not.toContain("sess1");
    expect(Number(calls[0].values?.[6])).toBeGreaterThan(0);
  });

  it("findSessionById looks the session up by digest", async () => {
    const { db, calls } = fakeDb((sql: string) => (/SELECT/.test(sql) ? [{ id: "digest" }] : []));
    expect((await findSessionById(db, "sess1"))?.id).toBe("digest");
    expect(calls[0].values).toEqual([hashToken("sess1")]);
    const empty = fakeDb(() => []);
    expect(await findSessionById(empty.db, "nope")).toBeNull();
  });

  it("updateSessionPayload touches last_activity", async () => {
    const { db, calls } = fakeDb();
    await updateSessionPayload(db, "sess1", '{"x":1}');
    expect(calls[0].sql).toContain("SET payload = $2, last_activity = $3");
    expect(calls[0].values?.[0]).toBe(hashToken("sess1"));
  });

  it("deleteSession and deleteSessionsByUserId issue correct DELETEs", async () => {
    const a = fakeDb();
    await deleteSession(a.db, "sess1");
    expect(a.calls[0].values).toEqual([hashToken("sess1")]);
    const b = fakeDb();
    await deleteSessionsByUserId(b.db, 5);
    expect(b.calls[0].sql).toContain("WHERE user_id = $1");
    expect(b.calls[0].values).toEqual([5]);
  });
});