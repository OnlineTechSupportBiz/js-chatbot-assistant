import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../lib/env-file";
import { getConfig, getDbCredentials, assertRlsConfiguration } from "../lib/config";
import { createPool, type DbClient } from "../lib/db";
import { splitSqlStatements } from "./sqlsplit";

/**
 * PostgreSQL migration runner — port of `migrations/run.php`.
 *
 *   npx tsx src/db/migrate.ts                 # run all pending migrations
 *   npx tsx src/db/migrate.ts 002_xxx.sql     # run a specific file
 *   npx tsx src/db/migrate.ts --fresh         # drop all tables, then migrate
 *   npx tsx src/db/migrate.ts --drop          # drop all tables only
 *
 * Two-role mode: when DB_MIGRATOR_USER is set, migrations run as that owner role
 * and privileges are then granted to the app role (DB_USER). The app role does
 * not own the tables, so Postgres RLS genuinely enforces tenant isolation. With
 * no DB_MIGRATOR_USER, migrations run as DB_USER (single-role, PHP parity).
 *
 * Runs statements in autocommit (one execution per statement), matching the
 * PHP installer's `PDO::exec` loop and the `.sql` files (which carry no BEGIN).
 *
 * Applied files are recorded in `<schema>.schema_migrations`. They have to be:
 * the migration files are a pg_dump-derived script whose `ALTER TABLE … ADD
 * CONSTRAINT` statements are not idempotent, so running them all on every
 * invocation failed on the second run ("multiple primary keys for table … are not
 * allowed"). For a database that already has the schema but no ledger — a PHP
 * install, or a database migrated before the ledger existed — statements that fail
 * because their object already exists are recorded as applied rather than
 * aborting, and any statement that follows a foreign key in its file still runs
 * (`--fresh` recreates the ledger along with everything else).
 */

/** Bookkeeping table for applied migrations (created by this runner, not the app). */
const MIGRATIONS_TABLE = "schema_migrations";

/**
 * Errors that mean "already applied": the object this statement creates exists.
 * Only these are tolerated during reconciliation — a syntax or permission error
 * still aborts the run, so nothing is silently skipped.
 */
const ALREADY_APPLIED_CODES = new Set([
  "42P06", // duplicate_schema
  "42P07", // duplicate_table
  "42701", // duplicate_column
  "42710", // duplicate_object — constraint/type already exists
  "42723", // duplicate_function
  "42P16", // invalid_table_definition — "multiple primary keys for table …"
]);

export interface MigrateArgs {
  fresh: boolean;
  dropOnly: boolean;
  file: string | null;
}

export function parseArgs(argv: string[]): MigrateArgs {
  let fresh = false;
  let dropOnly = false;
  let file: string | null = null;
  for (const arg of argv) {
    if (arg === "--fresh") fresh = true;
    else if (arg === "--drop") dropOnly = true;
    else if (arg.startsWith("--")) continue;
    else file = arg;
  }
  return { fresh, dropOnly, file };
}

export function discoverMigrations(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

/**
 * Create the ledger if it is not there yet (idempotent). The schema is ensured
 * first, so the runner works on a brand-new database (where only the migration
 * files would otherwise create it) as well as on an existing one.
 */
async function ensureMigrationsTable(client: DbClient, schema: string): Promise<void> {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)}`);
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${quoteIdent(schema)}.${MIGRATIONS_TABLE} (
       filename TEXT PRIMARY KEY,
       applied_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
  );
}

async function loadApplied(client: DbClient, schema: string): Promise<Set<string>> {
  const r = await client.query(`SELECT filename FROM ${quoteIdent(schema)}.${MIGRATIONS_TABLE}`);
  return new Set(r.rows.map((row) => String((row as { filename: string }).filename)));
}

async function recordMigration(
  client: DbClient,
  schema: string,
  filename: string,
): Promise<void> {
  await client.query(
    `INSERT INTO ${quoteIdent(schema)}.${MIGRATIONS_TABLE} (filename) VALUES ($1)
     ON CONFLICT (filename) DO NOTHING`,
    [filename],
  );
}

/**
 * Does this database already hold the application schema? Decides whether
 * duplicate-object errors are treated as "already applied" (reconciliation) or as
 * real failures (a fresh database). The sentinel is the core `users` table, since
 * the ledger lives in the same schema.
 */
async function schemaIsPopulated(client: DbClient, schema: string): Promise<boolean> {
  const r = await client.query(
    "SELECT EXISTS(SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = 'users') AS present",
    [schema],
  );
  return Boolean((r.rows[0] as { present: boolean } | undefined)?.present);
}

function dropAllTablesSql(schema: string): string {
  const safe = schema.replace(/'/g, "''");
  return `DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = '${safe}')
  LOOP
    EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
  END LOOP;
END $$;`;
}

/**
 * Grant the app role DML + sequence + schema-usage privileges on the schema,
 * together with default privileges for objects created later. Run as the owner
 * role after migrations, so the app role (non-owner) can operate while still
 * being subject to RLS.
 */
export async function grantAppPrivileges(
  client: DbClient,
  schema: string,
  appRole: string,
): Promise<void> {
  const s = quoteIdent(schema);
  const r = quoteIdent(appRole);
  const statements = [
    `GRANT USAGE ON SCHEMA ${s} TO ${r}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${s} TO ${r}`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${s} TO ${r}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${r}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT USAGE, SELECT ON SEQUENCES TO ${r}`,
  ];
  for (const stmt of statements) {
    await client.query(stmt);
  }
}

/**
 * Substitute `{{schema}}` in migration SQL with the configured schema name.
 *
 * The schema is a deployment choice (`.env` DB_SCHEMA), so it must not be baked
 * into the migration files. `{{schema}}` is replaced as a double-quoted
 * identifier, so any legal schema name works — including one needing quoting.
 *
 * Deliberately NOT templated: role names. Ownership and grants are handled by
 * the role that runs the migration (it owns whatever it creates) and by
 * `grantAppPrivileges()` afterwards, which takes the app role from config. That
 * keeps the file free of any operator-specific role name.
 */
export function renderSchema(sql: string, schema: string): string {
  return sql.replace(/\{\{schema\}\}/g, quoteIdent(schema));
}

export async function runMigrations(
  client: DbClient,
  migrationDir: string,
  schema: string,
  args: MigrateArgs,
): Promise<void> {
  let files = discoverMigrations(migrationDir);

  if (args.file) {
    if (!files.includes(args.file)) {
      throw new Error(`Migration file not found: ${args.file}`);
    }
    files = [args.file];
  }

  if (files.length === 0) {
    console.log("No migration files found.");
    return;
  }

  if (args.fresh || args.dropOnly) {
    const label = args.dropOnly ? "DROP ONLY" : "FRESH";
    console.log(`  ${label}: dropping all tables in schema "${schema}"...`);
    await client.query(dropAllTablesSql(schema));
    console.log("OK\n");
  }

  if (args.dropOnly) {
    console.log("Drop complete. Exiting (--drop mode).");
    return;
  }

  await ensureMigrationsTable(client, schema);
  const applied = await loadApplied(client, schema);

  // Reconciliation: a populated schema with statements that predate the ledger.
  // (--fresh dropped the ledger along with the tables, so a fresh database is
  // strict from the start.)
  const reconcile = await schemaIsPopulated(client, schema);
  if (reconcile && applied.size === 0) {
    console.log(
      "  Schema already present with no migration ledger — recording what is already applied.\n",
    );
  }

  for (const file of files) {
    if (args.file === null && applied.has(file)) {
      console.log(`  ${file} — already applied`);
      continue;
    }
    const sql = renderSchema(readFileSync(path.join(migrationDir, file), "utf8"), schema);
    const statements = splitSqlStatements(sql);
    let alreadyApplied = 0;
    for (const stmt of statements) {
      try {
        await client.query(stmt);
      } catch (err) {
        const code = (err as { code?: string }).code ?? "";
        if (reconcile && ALREADY_APPLIED_CODES.has(code)) {
          alreadyApplied++;
          continue;
        }
        throw err;
      }
    }
    await recordMigration(client, schema, file);
    console.log(
      `  ${file} (${statements.length} statements${
        alreadyApplied > 0 ? `, ${alreadyApplied} already applied` : ""
      }) — OK`,
    );
  }

  console.log("\nAll migrations complete.");
}

async function main(): Promise<void> {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  loadEnvFile(path.join(projectRoot, ".env"));
  const config = getConfig();
  const args = parseArgs(process.argv.slice(2));

  // Migrations decide the ownership that RLS depends on, so refuse to create a
  // schema in production with the app role as owner unless the operator has
  // explicitly accepted application-layer-only isolation.
  assertRlsConfiguration(config);

  const migrator = getDbCredentials(config.db, "migrator");
  const pool = createPool({
    host: config.db.host,
    port: config.db.port,
    database: config.db.name,
    user: migrator.user,
    password: migrator.pass,
    schema: config.db.schema,
  });

  const client = await pool.connect();
  try {
    await runMigrations(client, path.resolve(projectRoot, "src/db/migrations"), config.db.schema, args);

    if (config.db.migratorUser !== "" && config.db.migratorUser !== config.db.user) {
      console.log(`\nGranting app-role privileges to "${config.db.user}"...`);
      await grantAppPrivileges(client, config.db.schema, config.db.user);
      console.log("Privileges granted.\n");
    }
  } finally {
    client.release();
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}