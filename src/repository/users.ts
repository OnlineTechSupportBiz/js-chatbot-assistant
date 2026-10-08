import type { DbClient } from "@/lib/db";
import { hashToken } from "@/lib/tokens";

/**
 * User repository — port of the PHP `User` + `Admin` models (both operate on the
 * flat `users` table). All functions take a `DbClient` so they run inside a
 * transaction with RLS context set (or null for unauthenticated flows, which
 * rely on the NULL-bypass RLS policies).
 */

export interface UserRow {
  id: number;
  admin_id: number;
  name: string;
  company_name: string | null;
  brand_name: string;
  slug: string | null;
  is_active: number;
  email: string;
  password_hash: string;
  role: "admin" | "user";
  email_verified_at: string | null;
  email_verify_token: string | null;
  mfa_secret: string | null;
  mfa_enabled: number;
  mfa_recovery_codes: string | null;
  openai_api_key: string | null;
  llamacloud_api_key: string | null;
  llm_base_url: string | null;
  embedding_base_url: string | null;
  embedding_api_key: string | null;
  embedding_model: string | null;
  llm_models: string | null;
  is_locked: number;
  locked_until: string | null;
  failed_attempts: number;
  last_login_at: string | null;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export async function findUserByEmail(db: DbClient, email: string): Promise<UserRow | null> {
  const r = await db.query("SELECT * FROM users WHERE email = $1", [email.trim().toLowerCase()]);
  return (r.rows[0] as UserRow) ?? null;
}

export async function findUserById(db: DbClient, id: number): Promise<UserRow | null> {
  const r = await db.query("SELECT * FROM users WHERE id = $1", [id]);
  return (r.rows[0] as UserRow) ?? null;
}

/** Look up by the raw verification token from the emailed link (stored hashed, SEC-17). */
export async function findUserByVerifyToken(db: DbClient, token: string): Promise<UserRow | null> {
  const r = await db.query("SELECT * FROM users WHERE email_verify_token = $1", [hashToken(token)]);
  return (r.rows[0] as UserRow) ?? null;
}

/**
 * Store a fresh verification token for a user. Takes the RAW token (the one being
 * emailed) and stores only its digest, so the credential is not readable from the
 * database. Use this rather than `updateUser({ email_verify_token })` — the point
 * of the digest is that it is written in exactly one place.
 */
export async function setEmailVerifyToken(
  db: DbClient,
  userId: number,
  token: string,
): Promise<void> {
  await db.query("UPDATE users SET email_verify_token = $2 WHERE id = $1", [
    userId,
    hashToken(token),
  ]);
}

export async function findUserBySlug(db: DbClient, slug: string): Promise<UserRow | null> {
  const r = await db.query("SELECT * FROM users WHERE slug = $1", [slug]);
  return (r.rows[0] as UserRow) ?? null;
}

export async function findUsersByAdmin(db: DbClient, adminId: number): Promise<UserRow[]> {
  const r = await db.query("SELECT * FROM users WHERE admin_id = $1 ORDER BY created_at DESC", [
    adminId,
  ]);
  return r.rows as UserRow[];
}

/** True when the account is still locked (is_locked AND locked_until in the future). */
export async function isLocked(db: DbClient, userId: number): Promise<boolean> {
  const r = await db.query(
    "SELECT (is_locked = 1 AND locked_until > NOW()) AS locked FROM users WHERE id = $1",
    [userId],
  );
  return r.rows[0]?.locked === true;
}

/** Generated a URL-friendly slug (matches PHP `User::generateSlug`). */
export function generateSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "user";
}

export interface CreateSelfAdminInput {
  email: string;
  name: string;
  passwordHash: string;
  companyName?: string | null;
  brandName?: string;
  emailVerifyToken?: string | null;
}

/**
 * Create a solo-admin user (role='admin', admin_id = its own id).
 *
 * The email-verification token is stored as a digest (SEC-17) — the caller passes
 * the raw token that goes into the email.
 *
 * The id is allocated up front via the identity sequence so the self-referencing
 * `admin_id` FK can be satisfied in a single insert — every account is the root
 * of its own single-user tenant, with no shared "god" admin and no members.
 */
export async function createSelfAdmin(db: DbClient, input: CreateSelfAdminInput): Promise<number> {
  const seq = await db.query("SELECT nextval(pg_get_serial_sequence('users', 'id')) AS id");
  const id = Number(seq.rows[0].id);
  await db.query(
    `INSERT INTO users (id, admin_id, name, email, password_hash, role, company_name, brand_name, email_verify_token)
     VALUES ($1, $1, $2, $3, $4, 'admin', $5, $6, $7)
     RETURNING id`,
    [
      id,
      input.name,
      input.email,
      input.passwordHash,
      input.companyName ?? null,
      input.brandName ?? "Chatbot Assistant",
      input.emailVerifyToken ? hashToken(input.emailVerifyToken) : null,
    ],
  );
  return id;
}

export async function verifyEmail(db: DbClient, userId: number): Promise<void> {
  await db.query(
    "UPDATE users SET email_verified_at = NOW(), email_verify_token = NULL WHERE id = $1",
    [userId],
  );
}

/**
 * Increment the failed-attempt counter and return the new value. Returning it —
 * rather than having the caller add 1 to a count it read earlier — is what makes
 * the lockout decision hold under concurrent login attempts.
 */
export async function incrementFailedAttempts(db: DbClient, userId: number): Promise<number> {
  const r = await db.query(
    "UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id = $1 RETURNING failed_attempts",
    [userId],
  );
  return Number(r.rows[0]?.failed_attempts ?? 0);
}

export async function resetFailedAttempts(db: DbClient, userId: number): Promise<void> {
  await db.query("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1", [
    userId,
  ]);
}

export async function lockAccount(db: DbClient, userId: number, minutes = 15): Promise<void> {
  await db.query(
    "UPDATE users SET is_locked = 1, locked_until = NOW() + ($2::int * INTERVAL '1 minute') WHERE id = $1",
    [userId, minutes],
  );
}

export async function unlockAccount(db: DbClient, userId: number): Promise<void> {
  await db.query("UPDATE users SET is_locked = 0, locked_until = NULL WHERE id = $1", [userId]);
}

export async function updateLastLogin(db: DbClient, userId: number): Promise<void> {
  await db.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [userId]);
}

export async function updatePassword(db: DbClient, userId: number, passwordHash: string): Promise<void> {
  await db.query("UPDATE users SET password_hash = $2 WHERE id = $1", [userId, passwordHash]);
}

/**
 * Columns `updateUser` is allowed to write. The SET clause is assembled from
 * column names — a position SQL cannot parameterise — so the allowed names are an
 * explicit allowlist: a caller that ever forwards a request-derived key cannot
 * turn it into SQL, and fields such as `role`, `admin_id`, `is_active`,
 * `password_hash` or `failed_attempts` cannot be mass-assigned through here.
 */
const UPDATABLE_USER_COLUMNS = new Set([
  "name",
  "company_name",
  "brand_name",
  "slug",
  "timezone",
  "mfa_secret",
  "mfa_enabled",
  "mfa_recovery_codes",
  "email_verify_token",
  "openai_api_key",
  "llamacloud_api_key",
  "llm_base_url",
  "embedding_base_url",
  "embedding_api_key",
  "embedding_model",
  "llm_models",
]);

/** Generic per-user field update (brand_name, timezone, mfa_*, provider keys, …). */
export async function updateUser(
  db: DbClient,
  userId: number,
  fields: Record<string, unknown>,
): Promise<void> {
  const requested = Object.keys(fields);
  if (requested.length === 0) return;
  const rejected = requested.filter((k) => !UPDATABLE_USER_COLUMNS.has(k));
  if (rejected.length > 0) {
    // Loud rather than silent: an unexpected column name is either a bug or an
    // attempt to write a protected field, and both should fail visibly.
    throw new Error(`updateUser: refusing to write non-updatable column(s): ${rejected.join(", ")}`);
  }
  const keys = requested;
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const values = keys.map((k) => fields[k]);
  await db.query(`UPDATE users SET ${setClause} WHERE id = $${keys.length + 1}`, [
    ...values,
    userId,
  ]);
}

export interface ApiKeys {
  openai_api_key: string | null;
  llamacloud_api_key: string | null;
  llm_base_url: string | null;
  embedding_base_url: string | null;
  embedding_api_key: string | null;
  embedding_model: string | null;
}

export async function getApiKeys(db: DbClient, userId: number): Promise<ApiKeys> {
  const r = await db.query(
    "SELECT openai_api_key, llamacloud_api_key, llm_base_url, embedding_base_url, embedding_api_key, embedding_model FROM users WHERE id = $1",
    [userId],
  );
  return (r.rows[0] as ApiKeys) ?? {
    openai_api_key: null,
    llamacloud_api_key: null,
    llm_base_url: null,
    embedding_base_url: null,
    embedding_api_key: null,
    embedding_model: null,
  };
}

/**
 * Store provided keys/settings. Empty API keys clear (null), matching PHP
 * `setApiKeys`. Empty provider URLs/model reset to null (fall back to defaults).
 */
export async function setApiKeys(db: DbClient, userId: number, keys: Partial<ApiKeys>): Promise<void> {
  const fields: Record<string, unknown> = {};
  if (keys.openai_api_key !== undefined) fields.openai_api_key = keys.openai_api_key ? keys.openai_api_key : null;
  if (keys.llamacloud_api_key !== undefined) fields.llamacloud_api_key = keys.llamacloud_api_key ? keys.llamacloud_api_key : null;
  if (keys.llm_base_url !== undefined) fields.llm_base_url = keys.llm_base_url?.trim() ? keys.llm_base_url.trim() : null;
  if (keys.embedding_base_url !== undefined) fields.embedding_base_url = keys.embedding_base_url?.trim() ? keys.embedding_base_url.trim() : null;
  if (keys.embedding_api_key !== undefined) fields.embedding_api_key = keys.embedding_api_key?.trim() ? keys.embedding_api_key.trim() : null;
  if (keys.embedding_model !== undefined) fields.embedding_model = keys.embedding_model?.trim() ? keys.embedding_model.trim() : null;
  await updateUser(db, userId, fields);
}

/** One entry in the user's ordered LLM model list (first = primary, rest = failover). */
export interface LlmModel {
  name: string;
  base_url: string;
  api_key: string;
  model: string;
}

export async function getLlmModels(db: DbClient, userId: number): Promise<LlmModel[]> {
  const r = await db.query("SELECT llm_models FROM users WHERE id = $1", [userId]);
  const raw = r.rows[0]?.llm_models;
  if (!raw) return [];
  // pg parses the JSONB column into a JS array; tolerate a string serialization too.
  if (Array.isArray(raw)) return raw as LlmModel[];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LlmModel[]) : [];
  } catch {
    return [];
  }
}

export async function setLlmModels(db: DbClient, userId: number, models: LlmModel[]): Promise<void> {
  await updateUser(db, userId, { llm_models: models.length > 0 ? JSON.stringify(models) : null });
}