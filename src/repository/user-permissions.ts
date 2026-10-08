import type { DbClient } from "@/lib/db";

/**
 * User-permission repository — port of PHP `UserPermission`.
 * The only actively-enforced permissions are the `widget_*` endpoint toggles
 * (`widget_chat`, `widget_quick_answers`); `has()` returns false when no row.
 */

export const WIDGET_PERMISSIONS = ["widget_chat", "widget_quick_answers"] as const;

export async function userHasPermission(
  db: DbClient,
  userId: number,
  permission: string,
): Promise<boolean> {
  const r = await db.query(
    "SELECT enabled FROM user_permissions WHERE user_id = $1 AND permission = $2",
    [userId, permission],
  );
  return r.rows[0]?.enabled === 1;
}

/** Upsert permissions for a user (enabled = 1|0), scoped by the (user_id, permission) unique key. */
export async function setUserPermissions(
  db: DbClient,
  userId: number,
  perms: Record<string, number>,
): Promise<void> {
  for (const [permission, enabled] of Object.entries(perms)) {
    await db.query(
      `INSERT INTO user_permissions (user_id, permission, enabled)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, permission) DO UPDATE SET enabled = EXCLUDED.enabled`,
      [userId, permission, enabled ? 1 : 0],
    );
  }
}