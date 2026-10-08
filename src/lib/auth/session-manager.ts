import { getPool } from "@/lib/db";
import { getConfig } from "@/lib/config";
import {
  createSession,
  findSessionById,
  updateSessionPayload,
  deleteSession,
  MAX_SESSION_AGE_SECONDS,
} from "@/repository/sessions";
import {
  generateSessionId,
  generateCsrfToken,
  REMEMBER_TTL_SECONDS,
  type SessionUser,
  type SessionPayload,
} from "./session";

/**
 * Session manager — server-side sessions on the `sessions` table, mirroring the
 * PHP `Session` class. The browser holds only an opaque session-id cookie; the
 * user + CSRF token live in the JSON `payload`. Guest (unauthenticated) sessions
 * exist too, so CSRF tokens work on login/register forms before auth.
 */

export interface SessionStore {
  /** Returns the payload plus the database-computed age/idle age of the row. */
  load(id: string): Promise<LoadedSession | null>;
  create(
    id: string,
    payload: SessionPayload,
    meta: { userId: number | null; adminId: number | null; ipAddress: string | null; userAgent: string | null },
  ): Promise<void>;
  update(id: string, payload: SessionPayload): Promise<void>;
  delete(id: string): Promise<void>;
}

/** A session row plus the age information needed to enforce its lifetime. */
export interface LoadedSession {
  payload: SessionPayload;
  ageSeconds: number;
  idleSeconds: number;
}

/**
 * True when a session has outlived its absolute lifetime or its idle timeout.
 *
 * PHP's file sessions were expired by `session.gc_maxlifetime`; the port stores
 * sessions in Postgres, so the check has to happen here or the cookie TTL is the
 * only limit (which a stolen session id ignores entirely). Remember-me buys the
 * 30-day ceiling, everything else gets the configured SESSION_LIFETIME.
 */
export function isExpiredSession(
  payload: SessionPayload,
  ageSeconds: number,
  idleSeconds: number,
): boolean {
  const ttlSeconds = payload.remember_me ? REMEMBER_TTL_SECONDS : getConfig().session.lifetime * 60;
  const limit = Math.min(ttlSeconds, MAX_SESSION_AGE_SECONDS);
  return ageSeconds > limit || idleSeconds > limit;
}

export class SessionManager {
  private constructor(
    private store: SessionStore,
    public id: string,
    private payload: SessionPayload,
  ) {}

  static async start(store: SessionStore, cookieId?: string | null): Promise<SessionManager> {
    if (cookieId) {
      const loaded = await store.load(cookieId);
      if (loaded && !isExpiredSession(loaded.payload, loaded.ageSeconds, loaded.idleSeconds)) {
        return new SessionManager(store, cookieId, loaded.payload);
      }
      if (loaded) {
        // Expired: drop the row so it cannot be resurrected, then fall through to a fresh guest session.
        await store.delete(cookieId);
      }
    }
    const id = generateSessionId();
    const payload: SessionPayload = { user: null, csrf_token: generateCsrfToken(), remember_me: false, flash: {} };
    const manager = new SessionManager(store, id, payload);
    // Persist the guest session so its CSRF token survives the round-trip to the browser cookie.
    await store.create(id, payload, { userId: null, adminId: null, ipAddress: null, userAgent: null });
    return manager;
  }

  get user(): SessionUser | null {
    return this.payload.user;
  }

  get csrfToken(): string {
    return this.payload.csrf_token;
  }

  get remember(): boolean {
    return this.payload.remember_me;
  }

  isAuthenticated(): boolean {
    return this.payload.user != null;
  }

  /** Authenticate: regenerate the id, persist the user, mint a fresh CSRF token. */
  async login(
    user: SessionUser,
    remember: boolean,
    meta: { ipAddress: string | null; userAgent: string | null },
  ): Promise<void> {
    const newId = generateSessionId();
    const payload: SessionPayload = {
      user,
      csrf_token: generateCsrfToken(),
      remember_me: remember,
      flash: {},
    };
    await this.store.create(newId, payload, {
      userId: user.user_id,
      adminId: user.admin_id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    if (this.id !== newId) {
      await this.store.delete(this.id);
    }
    this.id = newId;
    this.payload = payload;
  }

  async logout(): Promise<void> {
    await this.store.delete(this.id);
    this.payload = { user: null, csrf_token: generateCsrfToken(), remember_me: false, flash: {} };
  }

  /** Persist payload changes (flash, etc.) back to the store. */
  async save(): Promise<void> {
    await this.store.update(this.id, this.payload);
  }

  /**
   * Update the display timezone on the live session so a settings change takes
   * effect immediately, rather than at the next sign-in. PHP does the same
   * (`$_SESSION['timezone'] = $timezone` in AdminSettingsController).
   * Caller must `save()`.
   */
  setTimezone(timezone: string): void {
    if (this.payload.user != null) {
      this.payload.user = { ...this.payload.user, timezone };
    }
  }

  /**
   * Update the brand name on the live session (Settings → Branding), so the
   * sidebar and topbar pick it up without a re-login. Caller must `save()`.
   */
  setBrandName(brandName: string): void {
    if (this.payload.user != null) {
      this.payload.user = { ...this.payload.user, brand_name: brandName };
    }
  }

  flash(key: string, value: string): void {
    this.payload.flash[key] = value;
  }

  pullFlash(key: string): string | null {
    const value = this.payload.flash[key] ?? null;
    delete this.payload.flash[key];
    return value;
  }

  setMfaPending(user: SessionUser, remember: boolean): void {
    this.payload.mfa_pending = { user, remember };
  }

  getMfaPending(): { user: SessionUser; remember: boolean } | null {
    return this.payload.mfa_pending ?? null;
  }

  clearMfaPending(): void {
    this.payload.mfa_pending = null;
  }

  setMfaEnroll(secret: string, recoveryCodes: string[]): void {
    this.payload.mfa_enroll = { secret, recoveryCodes };
  }

  getMfaEnroll(): { secret: string; recoveryCodes: string[] } | null {
    return this.payload.mfa_enroll ?? null;
  }

  clearMfaEnroll(): void {
    this.payload.mfa_enroll = null;
  }
}

/** DB-backed store using the pool (used at the request boundary, not inside a tx). */
export class PostgresSessionStore implements SessionStore {
  async load(id: string): Promise<LoadedSession | null> {
    const client = await getPool().connect();
    try {
      const row = await findSessionById(client, id);
      if (!row) return null;
      return {
        payload: JSON.parse(row.payload) as SessionPayload,
        ageSeconds: row.age_seconds,
        idleSeconds: row.idle_seconds,
      };
    } finally {
      client.release();
    }
  }

  async create(
    id: string,
    payload: SessionPayload,
    meta: { userId: number | null; adminId: number | null; ipAddress: string | null; userAgent: string | null },
  ): Promise<void> {
    const client = await getPool().connect();
    try {
      await createSession(client, {
        id,
        userId: meta.userId,
        adminId: meta.adminId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        payload: JSON.stringify(payload),
      });
    } finally {
      client.release();
    }
  }

  async update(id: string, payload: SessionPayload): Promise<void> {
    const client = await getPool().connect();
    try {
      await updateSessionPayload(client, id, JSON.stringify(payload));
    } finally {
      client.release();
    }
  }

  async delete(id: string): Promise<void> {
    const client = await getPool().connect();
    try {
      await deleteSession(client, id);
    } finally {
      client.release();
    }
  }
}