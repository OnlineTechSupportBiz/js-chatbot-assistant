import { describe, it, expect } from "vitest";
import { SessionManager, type SessionStore } from "@/lib/auth/session-manager";
import { REMEMBER_TTL_SECONDS, type SessionUser, type SessionPayload } from "@/lib/auth/session";

class MemStore implements SessionStore {
  map = new Map<string, SessionPayload>();
  /** Age/idle seconds reported for every row (tests override to simulate expiry). */
  ageSeconds = 0;
  idleSeconds = 0;
  async load(id: string) {
    const payload = this.map.get(id);
    if (!payload) return null;
    return {
      payload: JSON.parse(JSON.stringify(payload)) as SessionPayload,
      ageSeconds: this.ageSeconds,
      idleSeconds: this.idleSeconds,
    };
  }
  async create(id: string, payload: SessionPayload) {
    this.map.set(id, JSON.parse(JSON.stringify(payload)) as SessionPayload);
  }
  async update(id: string, payload: SessionPayload) {
    this.map.set(id, JSON.parse(JSON.stringify(payload)) as SessionPayload);
  }
  async delete(id: string) {
    this.map.delete(id);
  }
}

const user: SessionUser = {
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

describe("SessionManager", () => {
  it("starts a guest session (no user, has CSRF) when no cookie", async () => {
    const store = new MemStore();
    const m = await SessionManager.start(store, null);
    expect(m.isAuthenticated()).toBe(false);
    expect(m.user).toBeNull();
    expect(m.csrfToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it("loads an existing session from a valid cookie id", async () => {
    const store = new MemStore();
    const m = await SessionManager.start(store, null);
    await m.login(user, false, { ipAddress: null, userAgent: null });
    const loaded = await SessionManager.start(store, m.id);
    expect(loaded.isAuthenticated()).toBe(true);
    expect(loaded.user?.user_id).toBe(1);
    expect(loaded.csrfToken).toBe(m.csrfToken);
  });

  it("falls back to a new guest session for an unknown cookie id", async () => {
    const store = new MemStore();
    const m = await SessionManager.start(store, "nonexistent");
    expect(m.isAuthenticated()).toBe(false);
  });

  it("login regenerates the id and deletes the previous session", async () => {
    const store = new MemStore();
    const m = await SessionManager.start(store, null);
    const oldId = m.id;
    await m.login(user, true, { ipAddress: "1.2.3.4", userAgent: "UA" });
    expect(m.id).not.toBe(oldId);
    expect(m.isAuthenticated()).toBe(true);
    expect(m.remember).toBe(true);
    expect(store.map.has(oldId)).toBe(false);
    expect(store.map.get(m.id)?.user?.user_email).toBe("a@x.com");
  });

  it("logout clears the user and deletes the session", async () => {
    const store = new MemStore();
    const m = await SessionManager.start(store, null);
    await m.login(user, false, { ipAddress: null, userAgent: null });
    const authedId = m.id;
    await m.logout();
    expect(m.isAuthenticated()).toBe(false);
    expect(store.map.has(authedId)).toBe(false);
  });

  it("flash is read-once", async () => {
    const store = new MemStore();
    const m = await SessionManager.start(store, null);
    m.flash("error", "bad login");
    expect(m.pullFlash("error")).toBe("bad login");
    expect(m.pullFlash("error")).toBeNull();
  });

  it("drops a session past SESSION_LIFETIME and issues a fresh guest session", async () => {
    const store = new MemStore();
    const m = await SessionManager.start(store, null);
    await m.login(user, false, { ipAddress: null, userAgent: null });
    const expiredId = m.id;

    store.ageSeconds = 1440 * 60 + 1; // one second past the 24h default
    const reloaded = await SessionManager.start(store, expiredId);

    expect(reloaded.isAuthenticated()).toBe(false);
    expect(reloaded.id).not.toBe(expiredId);
    expect(store.map.has(expiredId)).toBe(false); // the dead row is removed, not resurrected
  });

  it("drops a session left idle past its TTL even when it was created recently", async () => {
    const store = new MemStore();
    const m = await SessionManager.start(store, null);
    await m.login(user, false, { ipAddress: null, userAgent: null });

    store.ageSeconds = 10;
    store.idleSeconds = 1440 * 60 + 1;
    const reloaded = await SessionManager.start(store, m.id);

    expect(reloaded.isAuthenticated()).toBe(false);
  });

  it("keeps a session inside both windows", async () => {
    const store = new MemStore();
    const m = await SessionManager.start(store, null);
    await m.login(user, false, { ipAddress: null, userAgent: null });

    store.ageSeconds = 60;
    store.idleSeconds = 30;
    expect((await SessionManager.start(store, m.id)).isAuthenticated()).toBe(true);
  });

  it("gives remember-me the 30-day ceiling, and no longer", async () => {
    const store = new MemStore();
    const m = await SessionManager.start(store, null);
    await m.login(user, true, { ipAddress: null, userAgent: null });

    store.ageSeconds = 7 * 24 * 60 * 60; // a week in — still valid
    expect((await SessionManager.start(store, m.id)).isAuthenticated()).toBe(true);

    store.ageSeconds = REMEMBER_TTL_SECONDS + 1;
    expect((await SessionManager.start(store, m.id)).isAuthenticated()).toBe(false);
  });
});