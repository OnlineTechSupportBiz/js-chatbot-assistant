import type { DbClient } from "@/lib/db";
import type { SessionUser } from "./session";
import { userHasPermission } from "@/repository/user-permissions";

/**
 * Authorization predicates — port of the PHP `Auth` helper class.
 *
 * Key semantics (matching PHP exactly):
 * - `admin` role bypasses EVERY permission check.
 * - For non-admins, only `widget_*` permissions are actually enforced; all other
 *   permission names are treated as granted (the legacy page-level permissions
 *   are no longer enforced).
 * - `sameAdmin` lets admins cross tenants; non-admins must match the resource's
 *   `admin_id`, and a null resource denies non-admins.
 */

export function isAdmin(user: SessionUser | null | undefined): boolean {
  return user?.user_role === "admin";
}

export function hasRole(user: SessionUser | null | undefined, roles: string[]): boolean {
  return user != null && roles.includes(user.user_role);
}

export function isAuthenticated(user: SessionUser | null | undefined): boolean {
  return user != null;
}

/** Permission gate (admin bypass; non-admin only widget_* enforced). */
export async function hasPermission(
  db: DbClient,
  user: SessionUser,
  permission: string,
): Promise<boolean> {
  if (user.user_role === "admin") return true;
  if (!permission.startsWith("widget_")) return true; // non-widget → granted
  return userHasPermission(db, user.user_id, permission);
}

/** Tenant-scoping gate: a user only reaches a resource in their own tenant (no cross-tenant god-mode). */
export function sameAdmin(
  user: SessionUser,
  resource: { admin_id: number } | null | undefined,
): boolean {
  if (!resource) return false;
  return user.admin_id === resource.admin_id;
}