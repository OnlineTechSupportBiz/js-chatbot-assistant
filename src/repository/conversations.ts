import type { DbClient } from "@/lib/db";

export interface ConversationRow {
  id: number;
  admin_id: number;
  chatbot_id: number;
  visitor_session_id: string;
  visitor_ip: string | null;
  message_count: number;
  rating: number | null;
  first_message_at: string;
  last_message_at: string;
}

export async function findBySession(db: DbClient, chatbotId: number, visitorSessionId: string): Promise<ConversationRow | null> {
  const r = await db.query(
    "SELECT * FROM conversations WHERE chatbot_id = $1 AND visitor_session_id = $2",
    [chatbotId, visitorSessionId],
  );
  return (r.rows[0] as ConversationRow) ?? null;
}

export async function findConversationById(db: DbClient, id: number): Promise<ConversationRow | null> {
  const r = await db.query("SELECT * FROM conversations WHERE id = $1", [id]);
  return (r.rows[0] as ConversationRow) ?? null;
}

export async function findOrCreate(
  db: DbClient,
  adminId: number,
  chatbotId: number,
  visitorSessionId: string,
  visitorIp: string | null = null,
): Promise<ConversationRow | null> {
  const existing = await findBySession(db, chatbotId, visitorSessionId);
  if (existing) return existing;

  const ins = await db.query(
    `INSERT INTO conversations
       (admin_id, chatbot_id, visitor_session_id, visitor_ip, message_count, first_message_at, last_message_at)
     VALUES ($1,$2,$3,$4,0,NOW(),NOW())
     RETURNING id`,
    [adminId, chatbotId, visitorSessionId, visitorIp],
  );
  const id = Number(ins.rows[0].id);
  const r = await db.query("SELECT * FROM conversations WHERE id = $1", [id]);
  return (r.rows[0] as ConversationRow) ?? null;
}

export async function findByChatbot(db: DbClient, chatbotId: number, limit = 50): Promise<ConversationRow[]> {
  const r = await db.query(
    "SELECT * FROM conversations WHERE chatbot_id = $1 ORDER BY last_message_at DESC LIMIT $2",
    [chatbotId, limit],
  );
  return r.rows as ConversationRow[];
}

export type ConversationWithChatbot = ConversationRow & { chatbot_name: string };

export async function listByAdmin(db: DbClient, adminId: number, limit = 500): Promise<ConversationWithChatbot[]> {
  const r = await db.query(
    `SELECT cv.*, c.name AS chatbot_name
     FROM conversations cv JOIN chatbots c ON c.id = cv.chatbot_id
     WHERE cv.admin_id = $1
     ORDER BY cv.last_message_at DESC
     LIMIT $2`,
    [adminId, limit],
  );
  return r.rows as ConversationWithChatbot[];
}

/** Count user-role messages from this session in the last N minutes (per-session rate limit). */
export async function countRecentBySession(db: DbClient, chatbotId: number, visitorSessionId: string, withinMinutes = 1): Promise<number> {
  const r = await db.query(
    `SELECT COUNT(*) AS c FROM messages
     WHERE chatbot_id = $1 AND visitor_session_id = $2 AND role = 'user'
       AND created_at >= NOW() - ($3 * INTERVAL '1 minute')`,
    [chatbotId, visitorSessionId, withinMinutes],
  );
  return Number(r.rows[0]?.c ?? 0);
}

/** Sum tokens_used today for a chatbot (always 0 if none). */
export async function sumTokensUsedToday(db: DbClient, chatbotId: number): Promise<number> {
  const r = await db.query(
    `SELECT COALESCE(SUM(tokens_used), 0) AS t FROM messages
     WHERE chatbot_id = $1 AND tokens_used IS NOT NULL AND DATE(created_at) = CURRENT_DATE`,
    [chatbotId],
  );
  return Number(r.rows[0]?.t ?? 0);
}

export async function touch(db: DbClient, id: number): Promise<void> {
  await db.query(
    "UPDATE conversations SET message_count = message_count + 1, last_message_at = NOW() WHERE id = $1",
    [id],
  );
}

/** Rate a conversation 1-5; strips non-digits, rejects blank/out-of-range. */
export async function rate(db: DbClient, id: number, rawInput: string): Promise<boolean> {
  const clean = rawInput.replace(/[^0-9]/g, "");
  if (clean === "") return false;
  const rating = parseInt(clean, 10);
  if (rating < 1 || rating > 5) return false;
  await db.query("UPDATE conversations SET rating = $1 WHERE id = $2", [rating, id]);
  return true;
}

export async function countByAdmin(db: DbClient, adminId: number): Promise<number> {
  const r = await db.query("SELECT COUNT(*) AS c FROM conversations WHERE admin_id = $1", [adminId]);
  return Number(r.rows[0]?.c ?? 0);
}

export async function countByUser(db: DbClient, userId: number): Promise<number> {
  const r = await db.query(
    "SELECT COUNT(*) AS c FROM conversations cv INNER JOIN chatbots c ON c.id = cv.chatbot_id WHERE c.created_by = $1",
    [userId],
  );
  return Number(r.rows[0]?.c ?? 0);
}

export async function uniqueVisitorsByAdmin(db: DbClient, adminId: number): Promise<number> {
  const r = await db.query("SELECT COUNT(DISTINCT visitor_session_id) AS c FROM conversations WHERE admin_id = $1", [adminId]);
  return Number(r.rows[0]?.c ?? 0);
}

export async function uniqueVisitorsByUser(db: DbClient, userId: number): Promise<number> {
  const r = await db.query(
    "SELECT COUNT(DISTINCT cv.visitor_session_id) AS c FROM conversations cv INNER JOIN chatbots c ON c.id = cv.chatbot_id WHERE c.created_by = $1",
    [userId],
  );
  return Number(r.rows[0]?.c ?? 0);
}

export interface PerChatbotStat {
  chatbot_id: number;
  chatbot_name: string;
  count: number;
  daily_token_budget: number | null;
  tokens_today: number;
}

const PER_CHATBOT_SELECT = `SELECT cb.id AS chatbot_id, cb.name AS chatbot_name, COUNT(DISTINCT c.id) AS count,
       cb.daily_token_budget,
       COALESCE(SUM(CASE WHEN m.created_at >= CURRENT_DATE THEN m.tokens_used ELSE 0 END), 0) AS tokens_today
FROM conversations c
JOIN chatbots cb ON cb.id = c.chatbot_id
LEFT JOIN messages m ON m.conversation_id = c.id`;

export async function perChatbotByAdmin(db: DbClient, adminId: number): Promise<PerChatbotStat[]> {
  const r = await db.query(
    `${PER_CHATBOT_SELECT} WHERE c.admin_id = $1 GROUP BY cb.id, cb.name, cb.daily_token_budget ORDER BY count DESC`,
    [adminId],
  );
  return r.rows as PerChatbotStat[];
}

export async function perChatbotByUser(db: DbClient, userId: number): Promise<PerChatbotStat[]> {
  const r = await db.query(
    `${PER_CHATBOT_SELECT} WHERE cb.created_by = $1 GROUP BY cb.id, cb.name, cb.daily_token_budget ORDER BY count DESC`,
    [userId],
  );
  return r.rows as PerChatbotStat[];
}

export async function getRecentWithMessages(db: DbClient, chatbotId: number, limit = 10): Promise<Array<Record<string, unknown>>> {
  const r = await db.query(
    `SELECT c.*, m.content AS last_message_content, m.role AS last_message_role
     FROM conversations c
     LEFT JOIN messages m ON m.id = (
       SELECT id FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1
     )
     WHERE c.chatbot_id = $1
     ORDER BY c.last_message_at DESC
     LIMIT $2`,
    [chatbotId, limit],
  );
  return r.rows as Array<Record<string, unknown>>;
}