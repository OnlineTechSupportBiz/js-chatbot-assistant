import type { DbClient } from "@/lib/db";

/**
 * Audit-log repository — port of PHP `AuditLog::log`.
 * old/new values are JSON-encoded (jsonb), ip/user-agent captured automatically
 * by the caller or defaulted here.
 */

export interface AuditEntry {
  adminId: number | null;
  userId: number | null;
  action: string;
  entityType?: string | null;
  entityId?: number | null;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function logAudit(db: DbClient, entry: AuditEntry): Promise<number> {
  const r = await db.query(
    `INSERT INTO audit_logs (admin_id, user_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      entry.adminId ?? null,
      entry.userId ?? null,
      entry.action,
      entry.entityType ?? null,
      entry.entityId ?? null,
      entry.oldValue !== undefined ? JSON.stringify(entry.oldValue) : null,
      entry.newValue !== undefined ? JSON.stringify(entry.newValue) : null,
      entry.ipAddress ?? null,
      entry.userAgent ?? null,
    ],
  );
  return Number(r.rows[0].id);
}

export interface AuditLogRow {
  id: number;
  admin_id: number | null;
  user_id: number | null;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  old_value: unknown;
  new_value: unknown;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface AuditLogQuery {
  adminId?: number;
  userId?: number;
  action?: string;
  entityType?: string;
  page?: number;
  perPage?: number;
}

/** Paginated audit-log listing (newest first), with optional filters. */
export async function listAuditLogs(
  db: DbClient,
  opts: AuditLogQuery = {},
): Promise<{ rows: AuditLogRow[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.adminId != null) {
    params.push(opts.adminId);
    where.push(`admin_id = $${params.length}`);
  }
  if (opts.userId != null) {
    params.push(opts.userId);
    where.push(`user_id = $${params.length}`);
  }
  if (opts.action) {
    params.push(opts.action);
    where.push(`action = $${params.length}`);
  }
  if (opts.entityType) {
    params.push(opts.entityType);
    where.push(`entity_type = $${params.length}`);
  }
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const perPage = opts.perPage ?? 50;
  const page = opts.page ?? 1;
  const offset = (page - 1) * perPage;

  const totalRes = await db.query(`SELECT COUNT(*) AS total FROM audit_logs ${whereClause}`, params);
  const rowsRes = await db.query(
    `SELECT * FROM audit_logs ${whereClause} ORDER BY created_at DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, perPage, offset],
  );

  return {
    rows: rowsRes.rows as AuditLogRow[],
    total: Number(totalRes.rows[0]?.total ?? 0),
  };
}