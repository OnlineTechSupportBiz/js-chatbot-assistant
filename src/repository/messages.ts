import type { DbClient } from "@/lib/db";

export type MessageRole = "user" | "assistant" | "system";
export type MessageSource =
  | "rag"
  | "traditional_rag"
  | "page_index"
  | "quick_answer"
  | "llm_only"
  | "blocked";

export interface MessageRow {
  id: number;
  admin_id: number;
  chatbot_id: number;
  conversation_id: number;
  visitor_session_id: string;
  role: MessageRole;
  content: string;
  tokens_used: number | null;
  response_time_ms: number | null;
  source: MessageSource | null;
  created_at: string;
}

export interface NewMessage {
  adminId: number;
  chatbotId: number;
  conversationId: number;
  visitorSessionId: string;
  role: MessageRole;
  content: string;
  tokensUsed?: number | null;
  responseTimeMs?: number | null;
  source?: MessageSource | null;
}

export async function createMessage(db: DbClient, m: NewMessage): Promise<number> {
  const r = await db.query(
    `INSERT INTO messages
       (admin_id, chatbot_id, conversation_id, visitor_session_id, role, content, tokens_used, response_time_ms, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      m.adminId,
      m.chatbotId,
      m.conversationId,
      m.visitorSessionId,
      m.role,
      m.content,
      m.tokensUsed ?? null,
      m.responseTimeMs ?? null,
      m.source ?? null,
    ],
  );
  return Number(r.rows[0].id);
}

export async function findByConversation(db: DbClient, conversationId: number): Promise<MessageRow[]> {
  const r = await db.query("SELECT * FROM messages WHERE conversation_id = $1 ORDER BY id ASC", [conversationId]);
  return r.rows as MessageRow[];
}

/** Last N messages chronologically (PHP: DESC LIMIT, then reversed). */
export async function getRecentByConversation(db: DbClient, conversationId: number, limit = 20): Promise<MessageRow[]> {
  const r = await db.query(
    "SELECT * FROM messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT $2",
    [conversationId, limit],
  );
  return (r.rows as MessageRow[]).reverse();
}

export async function countByAdmin(db: DbClient, adminId: number): Promise<number> {
  const r = await db.query("SELECT COUNT(*) AS c FROM messages WHERE admin_id = $1", [adminId]);
  return Number(r.rows[0]?.c ?? 0);
}

export async function countByUser(db: DbClient, userId: number): Promise<number> {
  const r = await db.query(
    "SELECT COUNT(*) AS c FROM messages m INNER JOIN chatbots c ON c.id = m.chatbot_id WHERE c.created_by = $1",
    [userId],
  );
  return Number(r.rows[0]?.c ?? 0);
}

export async function countByChatbot(db: DbClient, chatbotId: number): Promise<number> {
  const r = await db.query("SELECT COUNT(*) AS c FROM messages WHERE chatbot_id = $1", [chatbotId]);
  return Number(r.rows[0]?.c ?? 0);
}

export interface ChartPoint {
  date: string;
  count: number;
}

export async function chartByAdmin(db: DbClient, adminId: number, from: string, to: string): Promise<ChartPoint[]> {
  const r = await db.query(
    // to_char, not DATE(): a `date` comes back through node-postgres as a JS Date
    // at the server's local midnight, which then drifts to the previous day when
    // re-rendered in another zone. A plain "YYYY-MM-DD" string names the bucket
    // exactly as the database grouped it.
    `SELECT to_char(DATE(created_at), 'YYYY-MM-DD') AS date, COUNT(*) AS count FROM messages
     WHERE admin_id = $1 AND created_at >= $2 AND created_at < $3::date + 1
     GROUP BY DATE(created_at) ORDER BY date ASC`,
    [adminId, from, to],
  );
  return r.rows as ChartPoint[];
}

export async function chartByUser(db: DbClient, userId: number, from: string, to: string): Promise<ChartPoint[]> {
  const r = await db.query(
    `SELECT to_char(DATE(m.created_at), 'YYYY-MM-DD') AS date, COUNT(*) AS count FROM messages m
     INNER JOIN chatbots c ON c.id = m.chatbot_id
     WHERE c.created_by = $1 AND m.created_at >= $2 AND m.created_at < $3::date + 1
     GROUP BY DATE(m.created_at) ORDER BY date ASC`,
    [userId, from, to],
  );
  return r.rows as ChartPoint[];
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function last7DaysByAdmin(db: DbClient, adminId: number, now = new Date()): Promise<ChartPoint[]> {
  const from = ymd(new Date(now.getTime() - 7 * 86400000));
  return chartByAdmin(db, adminId, from, ymd(now));
}

export async function last7DaysByUser(db: DbClient, userId: number, now = new Date()): Promise<ChartPoint[]> {
  const from = ymd(new Date(now.getTime() - 7 * 86400000));
  return chartByUser(db, userId, from, ymd(now));
}

export interface SourceBreakdown {
  source: string;
  count: number;
}

export async function sourceBreakdownByAdmin(db: DbClient, adminId: number): Promise<SourceBreakdown[]> {
  const r = await db.query(
    "SELECT source, COUNT(*) AS count FROM messages WHERE admin_id = $1 AND source IS NOT NULL AND role = 'assistant' GROUP BY source ORDER BY count DESC",
    [adminId],
  );
  return r.rows as SourceBreakdown[];
}

export async function sourceBreakdownByUser(db: DbClient, userId: number): Promise<SourceBreakdown[]> {
  const r = await db.query(
    `SELECT m.source, COUNT(*) AS count FROM messages m INNER JOIN chatbots c ON c.id = m.chatbot_id
     WHERE c.created_by = $1 AND m.source IS NOT NULL AND m.role = 'assistant' GROUP BY m.source ORDER BY count DESC`,
    [userId],
  );
  return r.rows as SourceBreakdown[];
}

function avg(rows: unknown[]): number | null {
  const v = (rows[0] as { avg?: unknown } | undefined)?.avg;
  return v === null || v === undefined ? null : Number(v);
}

export async function avgResponseTimeByChatbot(db: DbClient, chatbotId: number): Promise<number | null> {
  const r = await db.query(
    "SELECT AVG(response_time_ms) AS avg FROM messages WHERE chatbot_id = $1 AND response_time_ms IS NOT NULL AND role = 'assistant'",
    [chatbotId],
  );
  return avg(r.rows);
}

export async function avgResponseTimeByAdmin(db: DbClient, adminId: number): Promise<number | null> {
  const r = await db.query(
    "SELECT AVG(response_time_ms) AS avg FROM messages WHERE admin_id = $1 AND response_time_ms IS NOT NULL AND role = 'assistant'",
    [adminId],
  );
  return avg(r.rows);
}

export async function avgResponseTimeByUser(db: DbClient, userId: number): Promise<number | null> {
  const r = await db.query(
    `SELECT AVG(m.response_time_ms) AS avg FROM messages m INNER JOIN chatbots c ON c.id = m.chatbot_id
     WHERE c.created_by = $1 AND m.response_time_ms IS NOT NULL AND m.role = 'assistant'`,
    [userId],
  );
  return avg(r.rows);
}

export async function totalTokensByAdmin(db: DbClient, adminId: number): Promise<number> {
  const r = await db.query(
    "SELECT COALESCE(SUM(tokens_used), 0) AS t FROM messages WHERE admin_id = $1 AND tokens_used IS NOT NULL",
    [adminId],
  );
  return Number(r.rows[0]?.t ?? 0);
}

export async function totalTokensByUser(db: DbClient, userId: number): Promise<number> {
  const r = await db.query(
    `SELECT COALESCE(SUM(m.tokens_used), 0) AS t FROM messages m INNER JOIN chatbots c ON c.id = m.chatbot_id
     WHERE c.created_by = $1 AND m.tokens_used IS NOT NULL`,
    [userId],
  );
  return Number(r.rows[0]?.t ?? 0);
}