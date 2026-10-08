import { Pool } from "pg";
import { hashPassword } from "../src/lib/auth/crypto";
import { loadEnvFile } from "../src/lib/env-file";
import { getConfig, getDbCredentials } from "../src/lib/config";

/**
 * Local dev helper: set a known password for a seeded admin account.
 *
 * Deliberately guarded. It used to default to "password123" and connect as a
 * trust superuser on a hardcoded host, so running it against the wrong database
 * silently handed anyone who knows the default a working login — and bypassed RLS
 * while doing it. Now the password must be given explicitly, the target must be a
 * loopback database, and the connection uses the application role (so RLS applies
 * exactly as it does at runtime).
 *
 *   npx tsx scripts/reset-admin-password.ts <userId> <newPassword>
 */
async function main(): Promise<void> {
  loadEnvFile(new URL("../.env", import.meta.url).pathname);

  const [userIdArg, password] = process.argv.slice(2);
  const userId = Number(userIdArg);

  if (!Number.isInteger(userId) || userId <= 0 || !password) {
    console.error("usage: npx tsx scripts/reset-admin-password.ts <userId> <newPassword>");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters (the same rule the app enforces).");
    process.exit(1);
  }

  const config = getConfig();
  const { host, port, name, schema } = config.db;
  const isLoopback = host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "";
  if (!isLoopback) {
    console.error(`Refusing to run against a non-local database (DB_HOST=${host}).`);
    process.exit(1);
  }

  const creds = getDbCredentials(config.db, "app");
  const pool = new Pool({
    host,
    port,
    database: name,
    user: creds.user,
    password: creds.pass,
    options: `-c search_path=${schema}`,
  });

  const hash = await hashPassword(password);
  const r = await pool.query(
    `UPDATE users
        SET password_hash = $1, failed_attempts = 0, is_locked = 0, locked_until = NULL
      WHERE id = $2
      RETURNING id, email`,
    [hash, userId],
  );
  console.log("reset:", r.rows[0] ?? "(no such user)");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
