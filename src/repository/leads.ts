import type { DbClient } from "@/lib/db";

export interface LeadRow {
  id: number;
  admin_id: number;
  chatbot_id: number;
  conversation_id: number;
  visitor_session_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  summary: string | null;
  captured_at: string;
}

export async function findByConversation(db: DbClient, conversationId: number): Promise<LeadRow | null> {
  const r = await db.query("SELECT * FROM leads WHERE conversation_id = $1 LIMIT 1", [conversationId]);
  return (r.rows[0] as LeadRow) ?? null;
}

export async function findByChatbot(db: DbClient, adminId: number, chatbotId: number): Promise<LeadRow[]> {
  const r = await db.query(
    "SELECT * FROM leads WHERE admin_id = $1 AND chatbot_id = $2 ORDER BY captured_at DESC",
    [adminId, chatbotId],
  );
  return r.rows as LeadRow[];
}

export type LeadWithChatbot = LeadRow & { chatbot_name: string };

export async function findByAdmin(db: DbClient, adminId: number, limit = 500): Promise<LeadWithChatbot[]> {
  const r = await db.query(
    `SELECT l.*, c.name AS chatbot_name
     FROM leads l JOIN chatbots c ON c.id = l.chatbot_id
     WHERE l.admin_id = $1
     ORDER BY l.captured_at DESC
     LIMIT $2`,
    [adminId, limit],
  );
  return r.rows as LeadWithChatbot[];
}

export async function countByChatbot(db: DbClient, adminId: number, chatbotId: number): Promise<number> {
  const r = await db.query("SELECT COUNT(*) AS c FROM leads WHERE admin_id = $1 AND chatbot_id = $2", [adminId, chatbotId]);
  return Number(r.rows[0]?.c ?? 0);
}

export interface NewLead {
  adminId: number;
  chatbotId: number;
  conversationId: number;
  visitorSessionId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  summary: string | null;
}

export async function createLead(db: DbClient, l: NewLead): Promise<number> {
  const r = await db.query(
    `INSERT INTO leads
       (admin_id, chatbot_id, conversation_id, visitor_session_id, name, email, phone, summary, captured_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
     RETURNING id`,
    [l.adminId, l.chatbotId, l.conversationId, l.visitorSessionId, l.name, l.email, l.phone, l.summary],
  );
  return Number(r.rows[0].id);
}

/**
 * Columns `updateLead` may write. Column names cannot be parameterised, so they
 * are an explicit allowlist — this keeps a caller that forwards a request-derived
 * key from turning it into SQL, and stops a lead being reassigned to another
 * tenant or conversation.
 */
const UPDATABLE_LEAD_COLUMNS = new Set(["name", "email", "phone", "summary", "status"]);

export async function updateLead(db: DbClient, id: number, fields: Record<string, unknown>): Promise<void> {
  const requested = Object.keys(fields);
  if (requested.length === 0) return;
  const rejected = requested.filter((k) => !UPDATABLE_LEAD_COLUMNS.has(k));
  if (rejected.length > 0) {
    throw new Error(`updateLead: refusing to write non-updatable column(s): ${rejected.join(", ")}`);
  }
  const keys = requested;
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  await db.query(`UPDATE leads SET ${setClause} WHERE id = $${keys.length + 1}`, [
    ...keys.map((k) => fields[k]),
    id,
  ]);
}