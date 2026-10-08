import { Pool } from "pg";
import { getConfig, assertRlsConfiguration } from "./config";
import { asDatabaseUnavailable } from "./db-errors";

/**
 * PostgreSQL access layer.
 *
 * Tenant isolation: RLS is driven by the `app.admin_id` GUC. Under a connection
 * pool, we must scope that setting to the transaction (SET LOCAL), so it is
 * cleared on COMMIT/ROLLBACK and cannot leak to another request on the same
 * pooled connection. The PHP app instead used set_config(..., false) (session
 * scope), which is safe only on its single-connection-per-process model.
 */

/** Minimal structural interface so repositories can be exercised against fakes. */
export interface QueryResult {
  // Rows are dynamically typed from arbitrary SQL (cf. PHP PDO FETCH_ASSOC).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: any[];
  rowCount: number | null;
}

export interface DbClient {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  release(err?: Error | boolean): void;
}

export interface DbPool {
  connect(): Promise<DbClient>;
}

export interface PoolConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  schema: string;
}

export function createPool(cfg: PoolConfig): DbPool {
  const pool = new Pool({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    max: 10,
    // Unqualified table references resolve to the app schema (parity with the PHP DSN).
    options: `-c search_path=${cfg.schema}`,
  });

  // Single choke point for "the database is not there": every caller goes
  // through here, so connection failures are classified once, in dev and in
  // production, rather than surfacing as a raw driver error at each call site.
  return {
    async connect(): Promise<DbClient> {
      try {
        return (await pool.connect()) as unknown as DbClient;
      } catch (err) {
        throw asDatabaseUnavailable(err, {
          host: cfg.host,
          port: cfg.port,
          database: cfg.database,
        });
      }
    },
  };
}

let pool: DbPool | null = null;

/** App-runtime pool (connects as DB_USER; subject to RLS in two-role mode). */
export function getPool(): DbPool {
  if (pool === null) {
    const db = getConfig().db;
    // Fail closed before the first query: a production deployment whose app role
    // owns the tables has no database-enforced tenant isolation at all, and it is
    // far better to refuse to start than to serve cross-tenant data quietly.
    assertRlsConfiguration();
    pool = createPool({
      host: db.host,
      port: db.port,
      database: db.name,
      user: db.user,
      password: db.pass,
      schema: db.schema,
    });
  }
  return pool;
}

export interface TxOptions {
  adminId?: number | null;
  pool?: DbPool;
}

/**
 * Run `fn` inside a transaction on a client from the pool.
 *
 * When `adminId` is a number, `SET LOCAL app.admin_id` is issued first so RLS
 * policies scope every subsequent statement in the transaction to that tenant.
 * When omitted or null, no value is set — RLS bypasses (public widget paths).
 */
export async function withTransaction<T>(
  fn: (client: DbClient) => Promise<T>,
  opts: TxOptions = {},
): Promise<T> {
  const client = await (opts.pool ?? getPool()).connect();
  try {
    await client.query("BEGIN");
    if (opts.adminId != null) {
      // `SET` is a utility statement and cannot use bind parameters; the id
      // comes from the authenticated session, so it is an integer we validate
      // before interpolating (never from client input).
      const asId = Number(opts.adminId);
      if (!Number.isInteger(asId)) {
        throw new Error(`Invalid adminId for RLS context: ${opts.adminId}`);
      }
      await client.query(`SET LOCAL app.admin_id = ${asId}`);
    }
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The connection is gone (e.g. the server restarted mid-transaction).
      // Rethrowing the rollback failure here would hide the real cause and
      // turn every outage into an opaque error.
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run `fn` on a pooled client with a SESSION-scoped `app.admin_id` (autocommit —
 * no surrounding transaction). Used by the background worker, which must not hold
 * a transaction open across long LlamaParse/embedding calls.
 *
 * The GUC is RESET before release. If that RESET fails the connection is **not**
 * returned to the pool: a session-scoped setting survives COMMIT/ROLLBACK, so
 * handing the client back with the previous tenant's id still set would let the
 * next request on that connection run under the wrong tenant. Destroying the
 * connection is cheap; a cross-tenant read is not.
 */
export async function withSessionAdminId<T>(
  adminId: number,
  fn: (client: DbClient) => Promise<T>,
  pool: DbPool = getPool(),
): Promise<T> {
  const client = await pool.connect();
  let resetFailed = false;
  try {
    const asId = Number(adminId);
    if (!Number.isInteger(asId)) {
      throw new Error(`Invalid adminId for RLS context: ${adminId}`);
    }
    await client.query(`SET app.admin_id = ${asId}`);
    return await fn(client);
  } finally {
    try {
      await client.query("RESET app.admin_id");
    } catch (err) {
      resetFailed = true;
      console.error("[db] RESET app.admin_id failed; discarding the connection instead of pooling it", err);
    }
    if (resetFailed) {
      // pg destroys a client when release() is given an error.
      client.release(new Error("app.admin_id could not be reset"));
    } else {
      client.release();
    }
  }
}
