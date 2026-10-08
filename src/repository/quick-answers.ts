import type { DbClient } from "@/lib/db";

export interface QuickAnswerRow {
  id: number;
  admin_id: number;
  chatbot_id: number;
  trigger: string;
  answer: string;
  priority: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export async function findByChatbot(db: DbClient, adminId: number, chatbotId: number): Promise<QuickAnswerRow[]> {
  const r = await db.query(
    "SELECT * FROM quick_answers WHERE admin_id = $1 AND chatbot_id = $2 ORDER BY priority DESC, trigger ASC",
    [adminId, chatbotId],
  );
  return r.rows as QuickAnswerRow[];
}

export async function findActiveByChatbot(db: DbClient, adminId: number, chatbotId: number): Promise<QuickAnswerRow[]> {
  const r = await db.query(
    "SELECT * FROM quick_answers WHERE admin_id = $1 AND chatbot_id = $2 AND is_active = 1 ORDER BY priority DESC, trigger ASC",
    [adminId, chatbotId],
  );
  return r.rows as QuickAnswerRow[];
}

export async function findByTrigger(db: DbClient, adminId: number, chatbotId: number, trigger: string): Promise<QuickAnswerRow | null> {
  const r = await db.query(
    "SELECT * FROM quick_answers WHERE admin_id = $1 AND chatbot_id = $2 AND trigger = $3 AND is_active = 1 ORDER BY priority DESC LIMIT 1",
    [adminId, chatbotId, trigger],
  );
  return (r.rows[0] as QuickAnswerRow) ?? null;
}

/** Case-insensitive trimmed trigger match (PHP matchMessage). */
export async function matchMessage(db: DbClient, adminId: number, chatbotId: number, message: string): Promise<QuickAnswerRow | null> {
  const msg = message.trim().toLowerCase();
  const r = await db.query(
    "SELECT * FROM quick_answers WHERE admin_id = $1 AND chatbot_id = $2 AND LOWER(TRIM(trigger)) = $3 AND is_active = 1 ORDER BY priority DESC LIMIT 1",
    [adminId, chatbotId, msg],
  );
  return (r.rows[0] as QuickAnswerRow) ?? null;
}

export async function countByChatbot(db: DbClient, adminId: number, chatbotId: number): Promise<number> {
  const r = await db.query("SELECT COUNT(*) AS c FROM quick_answers WHERE admin_id = $1 AND chatbot_id = $2", [adminId, chatbotId]);
  return Number(r.rows[0]?.c ?? 0);
}

export async function countByAdmin(db: DbClient, adminId: number): Promise<number> {
  const r = await db.query("SELECT COUNT(*) AS c FROM quick_answers WHERE admin_id = $1", [adminId]);
  return Number(r.rows[0]?.c ?? 0);
}

/** Reorder — priority = count(ids) - position (position 0 = highest). */
export async function reorder(db: DbClient, adminId: number, chatbotId: number, ids: number[]): Promise<void> {
  for (let i = 0; i < ids.length; i++) {
    await db.query(
      "UPDATE quick_answers SET priority = $1 WHERE id = $2 AND admin_id = $3 AND chatbot_id = $4",
      [ids.length - i, ids[i], adminId, chatbotId],
    );
  }
}

export async function findQuickAnswer(db: DbClient, id: number): Promise<QuickAnswerRow | null> {
  const r = await db.query("SELECT * FROM quick_answers WHERE id = $1", [id]);
  return (r.rows[0] as QuickAnswerRow) ?? null;
}

export async function createQuickAnswer(
  db: DbClient,
  adminId: number,
  chatbotId: number,
  trigger: string,
  answer: string,
  priority = 0,
  isActive = 1,
): Promise<number> {
  const r = await db.query(
    "INSERT INTO quick_answers (admin_id, chatbot_id, trigger, answer, priority, is_active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
    [adminId, chatbotId, trigger, answer, priority, isActive],
  );
  return Number(r.rows[0].id);
}

/**
 * Columns `updateQuickAnswer` may write — an allowlist, because column names
 * cannot be parameterised and the key position is otherwise injectable.
 */
const UPDATABLE_QUICK_ANSWER_COLUMNS = new Set(["trigger", "answer", "is_active", "sort_order"]);

export async function updateQuickAnswer(db: DbClient, id: number, fields: Record<string, unknown>): Promise<void> {
  const requested = Object.keys(fields);
  if (requested.length === 0) return;
  const rejected = requested.filter((k) => !UPDATABLE_QUICK_ANSWER_COLUMNS.has(k));
  if (rejected.length > 0) {
    throw new Error(`updateQuickAnswer: refusing to write non-updatable column(s): ${rejected.join(", ")}`);
  }
  const keys = requested;
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  await db.query(`UPDATE quick_answers SET ${setClause} WHERE id = $${keys.length + 1}`, [
    ...keys.map((k) => fields[k]),
    id,
  ]);
}

export async function deleteQuickAnswer(db: DbClient, id: number): Promise<void> {
  await db.query("DELETE FROM quick_answers WHERE id = $1", [id]);
}