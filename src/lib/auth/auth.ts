import type { DbClient } from "@/lib/db";
import { createHash } from "node:crypto";
import { hashPassword, verifyPassword, generateToken, hashRecoveryCode, verifyRecoveryCode } from "./crypto";
import { generateTotpSecret, verifyTotp, generateRecoveryCodes } from "./totp";
import { encryptSecret, decryptSecret } from "@/lib/secret-box";
import { buildSessionUser, type SessionUser } from "./session";
import { rateLimitCheck, rateLimitRecord, rateLimitClear, UNKNOWN_IP_BUCKET } from "./rate-limiter";
import * as users from "@/repository/users";
import * as magicLinks from "@/repository/magic-links";
import * as passwordResets from "@/repository/password-resets";
import * as sessions from "@/repository/sessions";
import { setUserPermissions } from "@/repository/user-permissions";
import { logAudit } from "@/repository/audit-logs";

/**
 * Auth service — ports the PHP `AuthController` flows (login, register, email
 * verification, password reset, magic links, lockout, MFA) onto the repository
 * layer. All functions take a `DbClient` so the caller can run them inside
 * `withTransaction` for RLS-scoped/atomic behavior.
 */

export const MAX_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;
export const LOGIN_RATE_MAX = 10;
export const LOGIN_RATE_WINDOW = 300;
export const MAGIC_LINK_TTL = 15 * 60;
export const PASSWORD_RESET_TTL = 60 * 60;

/** Minimum password length — PHP parity (`AuthController.php:95`, `:563`). */
export const MIN_PASSWORD_LENGTH = 8;
/** Upper bound so an oversized value cannot be turned into an argon2 CPU burn. */
export const MAX_PASSWORD_LENGTH = 200;
/** Failed second-factor attempts allowed per account before the lockout applies. */
export const MFA_RATE_MAX = 10;
export const MFA_RATE_WINDOW = 600;

/**
 * Allowances for the unauthenticated mail-sending endpoints (register, password
 * reset, magic link, resend verification). None of these had any throttle, so a
 * single caller could bomb an address with mail and force unbounded SMTP + DB
 * work. A shared fallback bucket gets a larger allowance so it can never be used
 * to lock everyone out (see `clientRateBucket`).
 */
export const REGISTER_RATE_MAX = 10;
export const FORGOT_RATE_MAX = 5;
export const MAGIC_RATE_MAX = 5;
export const RESEND_RATE_MAX = 5;
export const AUTH_EMAIL_RATE_WINDOW = 900;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Server-side password policy. The form's `minLength` attribute is bypassed by
 * posting straight to the API, so the rule has to live in the service (PHP
 * enforced `strlen($password) < 8` in the controller, and the port had dropped it).
 */
export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

/** Loose format check (also caps length so a huge value never reaches the MTA). */
export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email);
}

/**
 * Rate-limit key for an account. The email is hashed so the limiter table never
 * stores an address, and — unlike an IP — the key cannot be chosen by the caller,
 * which is what makes per-account throttling hold when proxy headers are not
 * trusted (see `clientIp`).
 */
export function accountRateKey(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

// Timing-flattening dummy hash (verified against on unknown emails).
const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=4,p=1$bZLGZBBKV6AkpnPq/5l7fQ$N0lRleHqSB9ZRm6ji+y9CTDZ1rxnopa51ORpB90aOBs";

export interface AuthContext {
  ip: string;
  userAgent?: string | null;
}

export interface AuthUserResult {
  ok: true;
  user: SessionUser;
  needsMfa: boolean;
}

export interface AuthErrorResult {
  ok: false;
  status: number;
  error: string;
}

export type AuthResult = AuthUserResult | AuthErrorResult;

/**
 * Outcome of `register`. `exists` is deliberately indistinguishable from
 * `created` for the caller — the route answers both the same way — so the
 * endpoint cannot be used to enumerate registered addresses.
 */
export type RegisterResult =
  | { ok: true; kind: "created"; user: SessionUser; verifyToken: string }
  | { ok: true; kind: "exists"; email: string }
  | AuthErrorResult;

export type SimpleResult = { ok: true } | AuthErrorResult;

export interface SendTokenResult {
  /** Empty string means there is nothing to email (anti-enumeration / rate-limited). */
  token: string;
  email: string;
  brandName: string;
}

function err(status: number, error: string): AuthErrorResult {
  return { ok: false, status, error };
}

// ── Login ───────────────────────────────────────────────────────────────────

export async function login(
  db: DbClient,
  input: { email: string; password: string; remember: boolean; ip: string; userAgent?: string | null },
): Promise<AuthResult> {
  // With no trustworthy client address the IP bucket is deliberately skipped:
  // it would be a single deployment-wide counter, so one attacker could exhaust
  // the allowance and deny sign-in to every other user — a worse failure than
  // losing a throttle that can be spoofed anyway. The account-scoped limit below
  // and the 5-attempt lockout are the controls that hold.
  const ipTrusted = input.ip !== UNKNOWN_IP_BUCKET;
  if (ipTrusted && !(await rateLimitCheck(db, input.ip, LOGIN_RATE_MAX, LOGIN_RATE_WINDOW, "login:"))) {
    return err(429, "Too many login attempts. Please try again in a few minutes.");
  }

  // Account-scoped limit as well. The IP bucket is either spoofable or — when
  // proxy headers are not trusted — shared by every caller, so attempts against
  // one account must also be throttled by a key the attacker cannot choose.
  const accountKey = accountRateKey(input.email);
  if (!(await rateLimitCheck(db, accountKey, LOGIN_RATE_MAX, LOGIN_RATE_WINDOW, "login:acct:"))) {
    return err(429, "Too many login attempts. Please try again in a few minutes.");
  }

  const user = await users.findUserByEmail(db, input.email);

  if (!user) {
    await verifyPassword(input.password, DUMMY_HASH); // timing flatten
    await rateLimitRecord(db, input.ip);
    await rateLimitRecord(db, accountKey, "login:acct:");
    await logAudit(db, {
      adminId: null,
      userId: null,
      action: "login_failed",
      entityType: "user",
      ipAddress: input.ip,
      userAgent: input.userAgent,
    });
    return err(401, "Invalid email or password.");
  }

  // Inactive account. Answered exactly like a wrong password so the status code
  // cannot be used to enumerate accounts; the audit entry keeps the real reason.
  if (user.is_active !== 1) {
    await verifyPassword(input.password, DUMMY_HASH); // timing flatten
    await logAudit(db, {
      adminId: user.admin_id,
      userId: user.id,
      action: "login_disabled",
      entityType: "user",
      entityId: user.id,
      ipAddress: input.ip,
      userAgent: input.userAgent,
    });
    await rateLimitRecord(db, input.ip);
    await rateLimitRecord(db, accountKey, "login:acct:");
    return err(401, "Invalid email or password.");
  }

  // Lockout
  if (user.is_locked === 1) {
    if (await users.isLocked(db, user.id)) {
      await logAudit(db, {
        adminId: user.admin_id,
        userId: user.id,
        action: "login_locked",
        entityType: "user",
        entityId: user.id,
        ipAddress: input.ip,
        userAgent: input.userAgent,
      });
      return err(429, "Account temporarily locked due to too many failed attempts.");
    }
    await users.unlockAccount(db, user.id);
  }

  const passwordOk = await verifyPassword(input.password, user.password_hash);
  if (!passwordOk) {
    // The database increments the counter and returns the new value, so parallel
    // attempts cannot each read a stale count and slip past the lockout.
    const newAttempts = await users.incrementFailedAttempts(db, user.id);
    if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
      await users.lockAccount(db, user.id, LOCKOUT_MINUTES);
      await logAudit(db, {
        adminId: user.admin_id,
        userId: user.id,
        action: "account_locked",
        entityType: "user",
        entityId: user.id,
        newValue: { failed_attempts: newAttempts },
        ipAddress: input.ip,
        userAgent: input.userAgent,
      });
    }
    await rateLimitRecord(db, input.ip);
    await rateLimitRecord(db, accountKey, "login:acct:");
    await logAudit(db, {
      adminId: user.admin_id,
      userId: user.id,
      action: "login_failed",
      entityType: "user",
      entityId: user.id,
      ipAddress: input.ip,
      userAgent: input.userAgent,
    });
    return err(401, "Invalid email or password.");
  }

  // Email verification gate
  if (!user.email_verified_at) {
    await logAudit(db, {
      adminId: user.admin_id,
      userId: user.id,
      action: "login_unverified",
      entityType: "user",
      entityId: user.id,
      ipAddress: input.ip,
    });
    return err(403, "Please verify your email address before signing in.");
  }

  const needsMfa = user.mfa_enabled === 1 && !!user.mfa_secret;

  await users.resetFailedAttempts(db, user.id);
  await rateLimitClear(db, input.ip);
  await rateLimitClear(db, accountKey, "login:acct:");
  await users.updateLastLogin(db, user.id);
  await logAudit(db, {
    adminId: user.admin_id,
    userId: user.id,
    action: "login",
    entityType: "user",
    entityId: user.id,
    ipAddress: input.ip,
    userAgent: input.userAgent,
  });

  return { ok: true, user: buildSessionUser(user), needsMfa };
}

// ── Registration ────────────────────────────────────────────────────────────

export async function register(
  db: DbClient,
  input: {
    name: string;
    email: string;
    password: string;
    company?: string | null;
    ip: string;
    userAgent?: string | null;
  },
): Promise<RegisterResult> {
  const email = input.email.trim().toLowerCase();

  // The password policy lives here, not only in the form: the HTML minLength
  // attribute is bypassed by posting straight to the API (PHP checked
  // strlen($password) < 8 server-side; the port had dropped that check).
  const policyError = validatePassword(input.password);
  if (policyError) return err(400, policyError);
  if (input.name.trim() === "") return err(400, "Please enter your name.");
  if (!isValidEmail(email)) return err(400, "Please enter a valid email address.");

  if (await users.findUserByEmail(db, email)) {
    // Anti-enumeration: the same outcome shape as a successful signup, plus the
    // argon2 work the create path would have done, so neither content nor timing
    // reveals that the address is already registered. The route emails a reset
    // link instead of a verification link.
    await verifyPassword(input.password, DUMMY_HASH);
    return { ok: true, kind: "exists", email };
  }

  const passwordHash = await hashPassword(input.password);
  const verifyToken = generateToken();
  const brandName = "Chatbot Assistant";

  // Every account is its own admin: no shared "god" admin and no tenant members.
  const id = await users.createSelfAdmin(db, {
    email,
    name: input.name,
    passwordHash,
    companyName: input.company ?? null,
    brandName,
    emailVerifyToken: verifyToken,
  });

  await setUserPermissions(db, id, { widget_chat: 1, widget_quick_answers: 1 });

  await logAudit(db, {
    adminId: id,
    userId: id,
    action: "register",
    entityType: "user",
    entityId: id,
    ipAddress: input.ip,
    userAgent: input.userAgent,
  });

  return {
    ok: true,
    kind: "created",
    user: buildSessionUser({
      id,
      admin_id: id,
      role: "admin",
      name: input.name,
      email,
      email_verified_at: null,
      brand_name: brandName,
      company_name: input.company ?? null,
    }),
    verifyToken,
  };
}

// ── Email verification ──────────────────────────────────────────────────────

export async function verifyEmailToken(db: DbClient, token: string): Promise<AuthResult> {
  const user = await users.findUserByVerifyToken(db, token);
  if (!user) {
    return err(400, "Invalid or expired verification token.");
  }
  await users.verifyEmail(db, user.id);
  await logAudit(db, {
    adminId: user.admin_id,
    userId: user.id,
    action: "verify_email",
    entityType: "user",
    entityId: user.id,
  });
  return { ok: true, user: buildSessionUser(user), needsMfa: false };
}

export async function regenerateVerificationToken(
  db: DbClient,
  email: string,
): Promise<{ ok: true; token: string }> {
  const user = await users.findUserByEmail(db, email);
  if (!user || user.email_verified_at) {
    // Anti-enumeration: same response whether unknown or already verified.
    return { ok: true, token: "" };
  }
  const token = generateToken();
  await users.setEmailVerifyToken(db, user.id, token);
  return { ok: true, token };
}

// ── Password reset ──────────────────────────────────────────────────────────

export async function requestPasswordReset(
  db: DbClient,
  email: string,
): Promise<SendTokenResult> {
  const user = await users.findUserByEmail(db, email);
  if (!user) {
    return { token: "", email: "", brandName: "" }; // anti-enumeration
  }
  if (await passwordResets.hasActivePasswordReset(db, user.email)) {
    return { token: "", email: "", brandName: "" }; // do not re-issue
  }
  const token = generateToken();
  await passwordResets.upsertPasswordReset(db, user.email, token, PASSWORD_RESET_TTL);
  await logAudit(db, {
    adminId: user.admin_id,
    userId: user.id,
    action: "password_reset_requested",
    entityType: "user",
    entityId: user.id,
  });
  return { token, email: user.email, brandName: user.brand_name };
}

export async function resetPassword(
  db: DbClient,
  email: string,
  token: string,
  newPassword: string,
): Promise<AuthResult> {
  const policyError = validatePassword(newPassword);
  if (policyError) return err(400, policyError);

  const reset = await passwordResets.findValidPasswordReset(db, email.trim().toLowerCase(), token);
  if (!reset) {
    return err(400, "Invalid or expired reset link.");
  }
  const user = await users.findUserByEmail(db, email);
  if (!user) {
    return err(400, "Invalid or expired reset link.");
  }
  await users.updatePassword(db, user.id, await hashPassword(newPassword));
  await passwordResets.markPasswordResetUsed(db, user.email);
  // Revoke every existing session. A session captured before the reset must not
  // survive it — otherwise the recovery step users are told to take does not
  // actually evict an attacker.
  await sessions.deleteSessionsByUserId(db, user.id);
  await logAudit(db, {
    adminId: user.admin_id,
    userId: user.id,
    action: "password_reset_completed",
    entityType: "user",
    entityId: user.id,
  });
  return { ok: true, user: buildSessionUser(user), needsMfa: false };
}

// ── Magic links ─────────────────────────────────────────────────────────────

export async function requestMagicLink(
  db: DbClient,
  email: string,
): Promise<SendTokenResult> {
  const user = await users.findUserByEmail(db, email);
  if (!user) {
    return { token: "", email: "", brandName: "" }; // anti-enumeration
  }
  if (user.is_active !== 1) {
    return { token: "", email: "", brandName: "" };
  }
  if (await magicLinks.hasRecentMagicLink(db, user.email)) {
    return { token: "", email: "", brandName: "" }; // rate-limited
  }
  const token = generateToken();
  await magicLinks.createMagicLink(db, user.email, user.admin_id, token, MAGIC_LINK_TTL);
  await logAudit(db, {
    adminId: user.admin_id,
    userId: user.id,
    action: "magic_link_sent",
    entityType: "user",
    entityId: user.id,
  });
  return { token, email: user.email, brandName: user.brand_name };
}

export async function verifyMagicLink(db: DbClient, token: string): Promise<AuthResult> {
  // Atomic consume (validate + mark in one statement) so a link cannot be used
  // twice by racing two requests through a check-then-mark pair.
  const link = await magicLinks.consumeMagicLink(db, token);
  if (!link) {
    return err(400, "Invalid or expired sign-in link.");
  }
  const user = await users.findUserByEmail(db, link.email);
  if (!user || user.is_active !== 1) {
    return err(403, "This account is unavailable.");
  }
  if (!user.email_verified_at) {
    // Following a link that arrived in the inbox proves control of the address,
    // which is exactly what email verification asserts — so record it, rather
    // than admitting a session that the admin area would then refuse.
    await users.verifyEmail(db, user.id);
    user.email_verified_at = new Date().toISOString();
  }
  await users.resetFailedAttempts(db, user.id);
  await users.updateLastLogin(db, user.id);
  await logAudit(db, {
    adminId: user.admin_id,
    userId: user.id,
    action: "login",
    entityType: "user",
    entityId: user.id,
  });
  const needsMfa = user.mfa_enabled === 1 && !!user.mfa_secret;
  return { ok: true, user: buildSessionUser(user), needsMfa };
}

// ── MFA (TOTP + recovery codes) ─────────────────────────────────────────────

export function startMfaEnrollment(): { secret: string; recoveryCodes: string[] } {
  return { secret: generateTotpSecret(), recoveryCodes: generateRecoveryCodes(10) };
}

export async function completeMfaEnrollment(
  db: DbClient,
  userId: number,
  secret: string,
  recoveryCodes: string[],
  code: string,
  keepSessionId?: string | null,
): Promise<SimpleResult> {
  if (!verifyTotp(secret, code, 0)) {
    return err(400, "Invalid verification code.");
  }
  const hashed = recoveryCodes.map(hashRecoveryCode);
  await users.updateUser(db, userId, {
    // Encrypted, not hashed: the server has to recompute codes from it on every
    // challenge, so it must stay recoverable — but a database read must not hand
    // over a working second factor (SEC-17).
    mfa_secret: encryptSecret(secret),
    mfa_enabled: 1,
    mfa_recovery_codes: JSON.stringify(hashed),
  });
  if (keepSessionId) {
    // Turning the second factor on signs other devices out: anything captured
    // before MFA existed should not keep access to a now-protected account.
    await sessions.deleteSessionsByUserIdExcept(db, userId, keepSessionId);
  }
  await logAudit(db, {
    adminId: userId,
    userId,
    action: "mfa_enabled",
    entityType: "user",
    entityId: userId,
  });
  return { ok: true };
}

export async function disableMfa(
  db: DbClient,
  userId: number,
  code: string,
  secret: string | null,
  keepSessionId?: string | null,
): Promise<SimpleResult> {
  // The code is required unconditionally: a null secret must never be a way to
  // switch the second factor off without proving possession of it.
  if (!secret) {
    return err(400, "Multi-factor authentication is not enabled.");
  }
  if (!verifyTotp(decryptSecret(secret), code, 1)) {
    return err(400, "Invalid verification code.");
  }
  await users.updateUser(db, userId, { mfa_secret: null, mfa_enabled: 0, mfa_recovery_codes: null });
  await logAudit(db, { adminId: userId, userId, action: "mfa_disabled", entityType: "user", entityId: userId });
  if (keepSessionId) {
    // Other devices are signed out when the second factor is removed, so a stale
    // session elsewhere cannot ride along on the weaker configuration.
    await sessions.deleteSessionsByUserIdExcept(db, userId, keepSessionId);
  }
  return { ok: true };
}

/**
 * Verify a code against a seed read from storage. `decryptSecret` passes legacy
 * plaintext through unchanged, so accounts enrolled before the seed was encrypted
 * keep working (and are upgraded on their next enrollment).
 */
export function verifyMfaChallenge(secret: string, code: string): boolean {
  return verifyTotp(decryptSecret(secret), code, 1);
}

/** Consume a recovery code (single-use; removes it), returning success + remaining count. */
export async function consumeRecoveryCode(
  db: DbClient,
  userId: number,
  submittedCode: string,
): Promise<{ success: boolean; remaining: number }> {
  const user = await users.findUserById(db, userId);
  if (!user?.mfa_recovery_codes) {
    return { success: false, remaining: 0 };
  }
  const hashes = JSON.parse(user.mfa_recovery_codes) as string[];
  const code = submittedCode.toUpperCase();
  let matched = false;
  const remaining: string[] = [];
  for (const h of hashes) {
    if (!matched && verifyRecoveryCode(code, h)) {
      matched = true;
    } else {
      remaining.push(h);
    }
  }
  if (matched) {
    await users.updateUser(db, userId, { mfa_recovery_codes: JSON.stringify(remaining) });
  }
  return { success: matched, remaining: remaining.length };
}

// ── Second-factor throttling ────────────────────────────────────────────────

/** True when the account has spent its failed-MFA allowance for the window. */
export async function mfaRateLimitExceeded(db: DbClient, userId: number): Promise<boolean> {
  const allowed = await rateLimitCheck(db, String(userId), MFA_RATE_MAX, MFA_RATE_WINDOW, "mfa:");
  return !allowed;
}

/**
 * Record a failed second-factor attempt against the *account* rather than the IP.
 *
 * The challenge endpoint had no throttle at all, so a 6-digit TOTP with a
 * ±1-step window (~3 live codes out of 10^6) was brute-forceable at HTTP speed by
 * anyone holding the password. Failures also feed the shared lockout counter, so
 * a second-factor brute force can lock the account instead of only being slowed.
 */
export async function recordMfaFailure(
  db: DbClient,
  user: { id: number; admin_id: number },
  context: { ip: string; userAgent?: string | null },
): Promise<void> {
  await rateLimitRecord(db, String(user.id), "mfa:");
  const attempts = await users.incrementFailedAttempts(db, user.id);
  if (attempts >= MAX_LOGIN_ATTEMPTS) {
    await users.lockAccount(db, user.id, LOCKOUT_MINUTES);
    await logAudit(db, {
      adminId: user.admin_id,
      userId: user.id,
      action: "account_locked",
      entityType: "user",
      entityId: user.id,
      newValue: { failed_attempts: attempts, reason: "mfa" },
      ipAddress: context.ip,
      userAgent: context.userAgent,
    });
  }
  await logAudit(db, {
    adminId: user.admin_id,
    userId: user.id,
    action: "mfa_failed",
    entityType: "user",
    entityId: user.id,
    ipAddress: context.ip,
    userAgent: context.userAgent,
  });
}

/** Clear the failed-MFA allowance after a successful challenge. */
export async function clearMfaFailures(db: DbClient, userId: number): Promise<void> {
  await rateLimitClear(db, String(userId), "mfa:");
}