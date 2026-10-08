import type { DbClient } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import * as users from "@/repository/users";
import { logAudit } from "@/repository/audit-logs";

/**
 * Admin settings service — ports the PHP `AdminSettingsController` mutations
 * (brand name, timezone), each with its audit action.
 *
 * Two PHP mutations are intentionally absent:
 *  - the registration toggle: it wrote the platform-wide
 *    `registration_enabled` row, which has no owner in the solo-admin model.
 *    That gate now lives in config (`ALLOW_REGISTRATION`).
 *  - the user-management mutations (permissions / active / password reset):
 *    with the tenant-membership model gone, an account manages only itself.
 */

export async function updateBrandName(
  db: DbClient,
  actor: SessionUser,
  brandName: string,
): Promise<void> {
  await users.updateUser(db, actor.user_id, { brand_name: brandName });
  await logAudit(db, {
    adminId: actor.admin_id,
    userId: actor.user_id,
    action: "update_brand_name",
    entityType: "user",
    entityId: actor.user_id,
  });
}

export async function updateTimezone(db: DbClient, actor: SessionUser, timezone: string): Promise<void> {
  await users.updateUser(db, actor.user_id, { timezone });
  await logAudit(db, {
    adminId: actor.admin_id,
    userId: actor.user_id,
    action: "update_timezone",
    entityType: "user",
    entityId: actor.user_id,
    newValue: { timezone },
  });
}