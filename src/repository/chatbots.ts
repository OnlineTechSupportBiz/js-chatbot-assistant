import type { DbClient } from "@/lib/db";
import { randomBytes } from "node:crypto";

/**
 * Chatbot repository — port of the PHP `Chatbot` model. `model_config` and
 * `styling` are jsonb columns; node-pg returns them as parsed objects on read,
 * so this repository serializes objects on write.
 */

export interface ModelConfig {
  temperature: number;
  max_tokens: number;
  model: string;
}

export interface StylingConfig {
  primary_color: string;
  header_text_color: string;
  header_gradient_to: string;
  accent_color: string;
  header_icon: string;
  header_subtitle: string;
  placeholder_icon: string;
  placeholder_title: string;
  placeholder_text: string;
  position: string;
  bot_name: string;
  widget_theme: string;
  panel_theme: string;
}

export interface ChatbotRow {
  id: number;
  admin_id: number;
  created_by: number;
  name: string;
  industry: string | null;
  system_prompt: string | null;
  model_config: ModelConfig | null;
  styling: StylingConfig | null;
  status: "active" | "paused";
  lead_capture_enabled: number;
  daily_token_budget: number | null;
  rate_limit_per_session: number | null;
  /** Tenant ceiling on requests per minute from one visitor IP (null = server ceiling). */
  rate_limit_per_ip: number | null;
  /** Tenant ceiling on requests per minute for this chatbot (null = server ceiling). */
  rate_limit_per_token: number | null;
  allowed_domains: string | null;
  widget_token: string;
  max_message_length: number | null;
  max_messages_per_conversation: number | null;
  retrieval_strategy: "traditional_rag" | "page_index";
  created_at: string;
  updated_at: string;
}

/** 64-hex widget token (matches PHP `bin2hex(random_bytes(32))`). */
export function generateWidgetToken(): string {
  return randomBytes(32).toString("hex");
}

function json(v: unknown): string | null {
  return v == null ? null : typeof v === "string" ? v : JSON.stringify(v);
}

export async function findChatbotById(db: DbClient, id: number): Promise<ChatbotRow | null> {
  const r = await db.query("SELECT * FROM chatbots WHERE id = $1", [id]);
  return (r.rows[0] as ChatbotRow) ?? null;
}

export async function findByAdmin(db: DbClient, adminId: number): Promise<ChatbotRow[]> {
  const r = await db.query("SELECT * FROM chatbots WHERE admin_id = $1 ORDER BY created_at DESC", [adminId]);
  return r.rows as ChatbotRow[];
}

export async function findByUser(db: DbClient, userId: number): Promise<ChatbotRow[]> {
  const r = await db.query("SELECT * FROM chatbots WHERE created_by = $1 ORDER BY created_at DESC", [userId]);
  return r.rows as ChatbotRow[];
}

export async function findActiveByAdmin(db: DbClient, adminId: number): Promise<ChatbotRow[]> {
  const r = await db.query(
    "SELECT * FROM chatbots WHERE admin_id = $1 AND status = 'active' ORDER BY created_at DESC",
    [adminId],
  );
  return r.rows as ChatbotRow[];
}

export async function countByAdmin(db: DbClient, adminId: number): Promise<number> {
  const r = await db.query("SELECT COUNT(*) AS cnt FROM chatbots WHERE admin_id = $1", [adminId]);
  return Number(r.rows[0]?.cnt ?? 0);
}

export async function countByUser(db: DbClient, userId: number): Promise<number> {
  const r = await db.query("SELECT COUNT(*) AS cnt FROM chatbots WHERE created_by = $1", [userId]);
  return Number(r.rows[0]?.cnt ?? 0);
}

export async function findByWidgetToken(db: DbClient, token: string): Promise<ChatbotRow | null> {
  const r = await db.query(
    "SELECT * FROM chatbots WHERE widget_token = $1 AND status = 'active'",
    [token],
  );
  return (r.rows[0] as ChatbotRow) ?? null;
}

export interface NewChatbot {
  adminId: number;
  createdBy: number;
  name: string;
  industry?: string | null;
  systemPrompt?: string | null;
  modelConfig?: ModelConfig | null;
  styling?: StylingConfig | null;
  status?: string;
  leadCaptureEnabled?: number;
  dailyTokenBudget?: number | null;
  rateLimitPerSession?: number | null;
  allowedDomains?: string | null;
  maxMessageLength?: number | null;
  maxMessagesPerConversation?: number | null;
  retrievalStrategy?: string;
}

export async function createChatbot(db: DbClient, input: NewChatbot): Promise<number> {
  const r = await db.query(
    `INSERT INTO chatbots
       (admin_id, created_by, name, industry, system_prompt, model_config, styling, status,
        lead_capture_enabled, daily_token_budget, rate_limit_per_session, allowed_domains,
        widget_token, max_message_length, max_messages_per_conversation, retrieval_strategy)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING id`,
    [
      input.adminId,
      input.createdBy,
      input.name,
      input.industry ?? null,
      input.systemPrompt ?? null,
      json(input.modelConfig),
      json(input.styling),
      input.status ?? "active",
      input.leadCaptureEnabled ?? 0,
      input.dailyTokenBudget ?? null,
      input.rateLimitPerSession ?? null,
      input.allowedDomains ?? null,
      generateWidgetToken(),
      input.maxMessageLength ?? null,
      input.maxMessagesPerConversation ?? null,
      input.retrievalStrategy ?? "traditional_rag",
    ],
  );
  return Number(r.rows[0].id);
}

/**
 * Columns `updateChatbot` may write. The SET clause is built from column names —
 * a position SQL cannot parameterise — so the names are an explicit allowlist.
 * Ownership and identity columns (`admin_id`, `created_by`, `widget_token`) are
 * deliberately absent: a caller that ever forwards a request-derived key cannot
 * inject SQL through the column, nor reassign a chatbot to another tenant.
 */
const UPDATABLE_CHATBOT_COLUMNS = new Set([
  "name",
  "industry",
  "system_prompt",
  "model_config",
  "styling",
  "status",
  "lead_capture_enabled",
  "daily_token_budget",
  "rate_limit_per_session",
  "rate_limit_per_ip",
  "rate_limit_per_token",
  "allowed_domains",
  "max_message_length",
  "max_messages_per_conversation",
  "retrieval_strategy",
]);

export async function updateChatbot(
  db: DbClient,
  id: number,
  fields: Record<string, unknown>,
): Promise<void> {
  if (fields.model_config !== undefined) fields.model_config = json(fields.model_config);
  if (fields.styling !== undefined) fields.styling = json(fields.styling);
  const requested = Object.keys(fields);
  if (requested.length === 0) return;
  const rejected = requested.filter((k) => !UPDATABLE_CHATBOT_COLUMNS.has(k));
  if (rejected.length > 0) {
    throw new Error(`updateChatbot: refusing to write non-updatable column(s): ${rejected.join(", ")}`);
  }
  const keys = requested;
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  await db.query(`UPDATE chatbots SET ${setClause} WHERE id = $${keys.length + 1}`, [
    ...keys.map((k) => fields[k]),
    id,
  ]);
}

/** Clone: copy everything except id/widget_token/timestamps; fresh token + name. */
/** Delete a chatbot. Child rows (conversations, documents, leads, ...) cascade. */
export async function deleteChatbot(db: DbClient, id: number): Promise<void> {
  await db.query("DELETE FROM chatbots WHERE id = $1", [id]);
}

export async function cloneChatbot(db: DbClient, sourceId: number, newName: string): Promise<number> {
  const source = await findChatbotById(db, sourceId);
  if (!source) {
    throw new Error("Source chatbot not found");
  }
  return createChatbot(db, {
    adminId: source.admin_id,
    createdBy: source.created_by,
    name: newName,
    industry: source.industry,
    systemPrompt: source.system_prompt,
    modelConfig: source.model_config,
    styling: source.styling,
    status: source.status ?? "active",
    leadCaptureEnabled: source.lead_capture_enabled ?? 0,
    dailyTokenBudget: source.daily_token_budget,
    rateLimitPerSession: source.rate_limit_per_session,
    allowedDomains: source.allowed_domains ?? null,
    maxMessageLength: source.max_message_length ?? null,
    maxMessagesPerConversation: source.max_messages_per_conversation ?? null,
    retrievalStrategy: source.retrieval_strategy ?? "traditional_rag",
  });
}