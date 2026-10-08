import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Session primitives (pure, no DB) — mirrors PHP `Session.php` + `Auth` CSRF.
 * The session data itself lives server-side in the `sessions` table (the schema
 * already defines it); the browser holds only an opaque session id cookie.
 */

export const SESSION_COOKIE_NAME = "chatbot_session";
export const REMEMBER_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

/** Random 64-hex session id (fits `sessions.id` varchar(128)). */
export function generateSessionId(): string {
  return randomBytes(32).toString("hex");
}

/** Random 64-hex CSRF token (matches PHP `bin2hex(random_bytes(32))`). */
export function generateCsrfToken(): string {
  return randomBytes(32).toString("hex");
}

/** Constant-time CSRF comparison (matches PHP `hash_equals`). */
export function csrfMatches(sessionToken: string | undefined | null, submitted: string | undefined | null): boolean {
  if (!sessionToken || !submitted) return false;
  const a = Buffer.from(sessionToken, "utf8");
  const b = Buffer.from(submitted, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface SessionUser {
  user_id: number;
  admin_id: number;
  user_role: "admin" | "user";
  user_name: string;
  user_email: string;
  /** Null until the address is confirmed; admin routes refuse an unverified user. */
  email_verified_at: string | null;
  brand_name: string;
  company_name: string | null;
  timezone: string;
}

/** The user fields PHP `Session::login` stores in the session. */
export function buildSessionUser(user: {
  id: number;
  admin_id: number;
  role: "admin" | "user";
  name: string;
  email: string;
  email_verified_at?: string | null;
  brand_name?: string;
  company_name?: string | null;
  timezone?: string;
}): SessionUser {
  return {
    user_id: user.id,
    admin_id: user.admin_id,
    user_role: user.role,
    user_name: user.name,
    user_email: user.email,
    email_verified_at: user.email_verified_at ?? null,
    brand_name: user.brand_name ?? "Chatbot Assistant",
    company_name: user.company_name ?? null,
    timezone: user.timezone ?? "UTC",
  };
}

export interface SessionPayload {
  user: SessionUser | null;
  csrf_token: string;
  remember_me: boolean;
  flash: Record<string, string>;
  mfa_pending?: { user: SessionUser; remember: boolean } | null;
  mfa_enroll?: { secret: string; recoveryCodes: string[] } | null;
}

export interface CookieAttributes {
  name: string;
  value: string;
  httpOnly: boolean;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
}

/**
 * HttpOnly + SameSite=Lax cookie; Secure only when the request is HTTPS (matches
 * PHP `Session::start`, where `secure = isset($_SERVER['HTTPS'])`).
 */
export function sessionCookieAttributes(
  value: string,
  options: { remember: boolean; lifetimeMinutes: number; secure: boolean },
): CookieAttributes {
  return {
    name: SESSION_COOKIE_NAME,
    value,
    httpOnly: true,
    sameSite: "lax",
    secure: options.secure,
    path: "/",
    maxAge: options.remember ? REMEMBER_TTL_SECONDS : options.lifetimeMinutes * 60,
  };
}