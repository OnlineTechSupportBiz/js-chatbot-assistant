import type { DbClient } from "@/lib/db";

/**
 * Platform-wide key/value settings (`platform_settings`, PK = key) — port of PHP
 * `Setting`.
 *
 * The application no longer reads or writes this table: its only key,
 * `registration_enabled`, is a platform-wide value with no owner in the
 * solo-admin model, and that gate now lives in config (`ALLOW_REGISTRATION`).
 * The table and these accessors are kept for schema compatibility with the PHP
 * install, and for any future genuinely platform-wide setting.
 */

export async function getSetting(db: DbClient, key: string, defaultValue: string | null = null): Promise<string | null> {
  const r = await db.query("SELECT value FROM platform_settings WHERE key = $1", [key]);
  return r.rows[0]?.value ?? defaultValue;
}

export async function setSetting(db: DbClient, key: string, value: string): Promise<void> {
  await db.query(
    "INSERT INTO platform_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [key, value],
  );
}