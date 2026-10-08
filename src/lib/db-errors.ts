/**
 * Database-availability errors.
 *
 * When PostgreSQL is unreachable, `pg` throws a raw driver error whose message
 * ("connect ECONNREFUSED 127.0.0.1:54329") is meaningless to an operator and
 * leaks host/port details into the UI. This module classifies those failures
 * into one typed error so that:
 *
 *   - pages can render a friendly "database is offline" screen (see
 *     `components/database-unavailable.tsx` and `app/error.tsx`),
 *   - the public widget API can answer 503 with a clear message instead of an
 *     HTML 500 that `widget.js` cannot parse,
 *   - routes that need the DB never proceed to an LLM call while the DB is down.
 */

/**
 * Stable, non-leaking message. Server Component errors are sanitized in
 * production builds, so anything user-visible must be safe to publish.
 */
export const DB_UNAVAILABLE_MESSAGE = "Database unavailable";

/** Connection target, used for operator-facing detail (never credentials). */
export interface DbTarget {
  host: string;
  port: number;
  database?: string;
}

/**
 * Node-level network errno values that mean "nothing answered".
 * Plus libpq SQLSTATE classes:
 *   08xxx — connection exception (08001 unable to connect, 08006 connection
 *           failure, 08003 connection does not exist, ...)
 *   57P0x — operator intervention / server shutdown (57P01 admin shutdown,
 *           57P03 cannot_connect_now — also raised while a server is starting up)
 *   3D000 — invalid_catalog_name (the configured database does not exist)
 *   28P01 / 28000 — invalid_password / invalid_authorization_specification
 */
const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "ECONNRESET",
  "EPIPE",
  "EAI_AGAIN",
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "57P01",
  "57P02",
  "57P03",
  "3D000",
  "28P01",
  "28000",
]);

/** Error subclass thrown in place of a raw driver connection failure. */
export class DatabaseUnavailableError extends Error {
  readonly code = "DB_UNAVAILABLE";
  readonly host: string;
  readonly port: number;
  readonly database?: string;
  /** Underlying driver error, for logs only — never rendered to a browser. */
  readonly cause: unknown;

  constructor(target: DbTarget, cause: unknown) {
    super(DB_UNAVAILABLE_MESSAGE);
    this.name = "DatabaseUnavailableError";
    this.host = target.host;
    this.port = target.port;
    this.database = target.database;
    this.cause = cause;
  }

  /** "127.0.0.1:54329" — safe to show an operator. */
  get target(): string {
    return `${this.host}:${this.port}`;
  }
}

function errorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * True when `err` represents an unusable database connection.
 *
 * Safe on any thrown value: `pg` wraps multi-host failures in an
 * `AggregateError`, and driver errors sometimes nest the real errno in
 * `cause`, so both are walked.
 */
export function isDatabaseUnavailable(err: unknown, depth = 0): boolean {
  if (depth > 5 || err === null || typeof err !== "object") return false;
  if (err instanceof DatabaseUnavailableError) return true;

  const code = errorCode(err);
  if (code !== undefined && CONNECTION_ERROR_CODES.has(code)) return true;

  const aggregate = (err as { errors?: unknown }).errors;
  if (Array.isArray(aggregate) && aggregate.some((e) => isDatabaseUnavailable(e, depth + 1))) {
    return true;
  }

  const cause = (err as { cause?: unknown }).cause;
  if (cause !== undefined && cause !== err && isDatabaseUnavailable(cause, depth + 1)) {
    return true;
  }

  return false;
}

/**
 * Wrap a driver error as a `DatabaseUnavailableError`, preserving the original
 * as `cause` for the server logs.
 */
export function asDatabaseUnavailable(err: unknown, target: DbTarget): DatabaseUnavailableError {
  if (err instanceof DatabaseUnavailableError) return err;
  return new DatabaseUnavailableError(target, err);
}
