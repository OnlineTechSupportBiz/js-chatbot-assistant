import type { DbClient } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import {
  createChatbot,
  updateChatbot,
  cloneChatbot as repoCloneChatbot,
  findChatbotById,
  type ModelConfig,
  type StylingConfig,
} from "@/repository/chatbots";
import { enqueueReprocessForChatbot } from "@/repository/document-jobs";
import { logAudit } from "@/repository/audit-logs";

/**
 * Chatbot service — ports the PHP `ChatbotController` create/update/clone logic:
 * model_config + styling defaults, allowed_domains normalization, nullable-int
 * parsing, and the daily-token-budget / rate-limit guards (0/empty = unlimited).
 */

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  temperature: 0.0,
  max_tokens: 1024,
  model: "gpt-4.1-mini",
};

export const DEFAULT_STYLING: StylingConfig = {
  primary_color: "#0d6efd",
  header_text_color: "#ffffff",
  header_gradient_to: "",
  accent_color: "",
  header_icon: "",
  header_subtitle: "",
  placeholder_icon: "",
  placeholder_title: "",
  placeholder_text: "",
  position: "bottom-right",
  bot_name: "Assistant",
  widget_theme: "",
  panel_theme: "light",
};

/** PHP `?:` semantics for numeric form fields ("0" = default, like PHP). */
function asFloat(value: unknown, fallback: number): number {
  if (value == null || value === "" || value === false) return fallback;
  const n = parseFloat(String(value).trim());
  if (!Number.isFinite(n) || n === 0) return fallback;
  return n;
}

function asInt(value: unknown, fallback: number): number {
  if (value == null || value === "" || value === false) return fallback;
  const cleaned = String(value).replace(/[^0-9]/g, "");
  const n = parseInt(cleaned || "0", 10);
  return n === 0 ? fallback : n;
}

/** Parse a form value as a nullable non-negative integer (PHP parseNullableInt). */
export function parseNullableInt(value: unknown): number | null {
  if (value == null || value === "" || value === false) return null;
  const cleaned = String(value).replace(/[^0-9]/g, "");
  return cleaned !== "" ? parseInt(cleaned, 10) : null;
}

/**
 * Normalize the allowed_domains allow-list: newline-separated, scheme/path
 * stripped, lowercased, default ports removed, wildcard `host:*` preserved.
 * Returns null when no valid domains remain (matches PHP processAllowedDomains).
 */
export function processAllowedDomains(input: string | null | undefined): string | null {
  if (input == null || input.trim() === "") return null;

  const domains: string[] = [];
  for (const line of input.split("\n")) {
    let domain = line.trim();
    if (domain === "") continue;

    if (/^https?:\/\//i.test(domain)) {
      let u: URL;
      try {
        u = new URL(domain);
      } catch {
        continue;
      }
      const host = u.hostname;
      if (host === "") continue;
      let port: number | null = u.port ? parseInt(u.port, 10) : null;
      if (port !== null && ((u.protocol === "http:" && port === 80) || (u.protocol === "https:" && port === 443))) {
        port = null;
      }
      domain = host.toLowerCase() + (port !== null ? `:${port}` : "");
    } else {
      domain = domain.replace(/[/?#].*$/, "").toLowerCase();
    }

    domain = domain.trim();
    if (domain !== "" && /^[a-z0-9.\-:*]+$/.test(domain)) {
      domains.push(domain);
    }
  }

  return domains.length > 0 ? domains.join("\n") : null;
}

export interface ChatbotFormInput {
  name: string;
  industry?: string | null;
  systemPrompt?: string | null;
  model?: unknown;
  temperature?: unknown;
  maxTokens?: unknown;
  primaryColor?: unknown;
  headerTextColor?: unknown;
  headerGradientTo?: unknown;
  accentColor?: unknown;
  headerIcon?: unknown;
  headerSubtitle?: unknown;
  placeholderIcon?: unknown;
  placeholderTitle?: unknown;
  placeholderText?: unknown;
  position?: unknown;
  botName?: unknown;
  widgetTheme?: unknown;
  panelTheme?: unknown;
  status?: string;
  leadCaptureEnabled?: unknown;
  retrievalStrategy?: string;
  allowedDomains?: string;
  dailyTokenBudget?: unknown;
  rateLimitPerSession?: unknown;
  rateLimitPerIp?: unknown;
  rateLimitPerToken?: unknown;
  maxMessageLength?: unknown;
  maxMessagesPerConversation?: unknown;
}

function str(v: unknown, fallback: string): string {
  return v == null || v === "" ? fallback : String(v);
}

function boolish(v: unknown): number {
  return v == null || v === "" || v === false || v === "0" || v === "false" ? 0 : 1;
}

export function buildModelConfig(input: ChatbotFormInput): ModelConfig {
  return {
    temperature: asFloat(input.temperature, DEFAULT_MODEL_CONFIG.temperature),
    max_tokens: asInt(input.maxTokens, DEFAULT_MODEL_CONFIG.max_tokens),
    model: str(input.model, DEFAULT_MODEL_CONFIG.model),
  };
}

export function buildStyling(input: ChatbotFormInput): StylingConfig {
  return {
    primary_color: str(input.primaryColor, DEFAULT_STYLING.primary_color),
    header_text_color: str(input.headerTextColor, DEFAULT_STYLING.header_text_color),
    header_gradient_to: str(input.headerGradientTo, DEFAULT_STYLING.header_gradient_to),
    accent_color: str(input.accentColor, DEFAULT_STYLING.accent_color),
    header_icon: str(input.headerIcon, DEFAULT_STYLING.header_icon),
    header_subtitle: str(input.headerSubtitle, DEFAULT_STYLING.header_subtitle),
    placeholder_icon: str(input.placeholderIcon, DEFAULT_STYLING.placeholder_icon),
    placeholder_title: str(input.placeholderTitle, DEFAULT_STYLING.placeholder_title),
    placeholder_text: str(input.placeholderText, DEFAULT_STYLING.placeholder_text),
    position: str(input.position, DEFAULT_STYLING.position),
    bot_name: str(input.botName, DEFAULT_STYLING.bot_name),
    widget_theme: str(input.widgetTheme, DEFAULT_STYLING.widget_theme),
    panel_theme: str(input.panelTheme, DEFAULT_STYLING.panel_theme),
  };
}

/** Daily token budget: digits only, < 100 → NULL (0/empty = unlimited). */
export function parseTokenBudget(value: unknown): number | null {
  const cleaned = String(value ?? "").replace(/[^0-9]/g, "");
  const n = cleaned === "" ? 0 : parseInt(cleaned, 10);
  return n >= 100 ? n : null;
}

/** Rate limit per session: digits only, < 1 → NULL (0/empty = unlimited). */
export function parseRateLimitPerSession(value: unknown): number | null {
  const cleaned = String(value ?? "").replace(/[^0-9]/g, "");
  const n = cleaned === "" ? 0 : parseInt(cleaned, 10);
  return n >= 1 ? n : null;
}

export async function storeChatbot(db: DbClient, actor: SessionUser, input: ChatbotFormInput): Promise<number> {
  const id = await createChatbot(db, {
    adminId: actor.admin_id,
    createdBy: actor.user_id,
    name: input.name,
    industry: input.industry || null,
    systemPrompt: input.systemPrompt || null,
    modelConfig: buildModelConfig(input),
    styling: buildStyling(input),
    status: "active",
    leadCaptureEnabled: boolish(input.leadCaptureEnabled),
    retrievalStrategy: input.retrievalStrategy || "traditional_rag",
    allowedDomains: processAllowedDomains(input.allowedDomains),
    // Sensible cost defaults (per the PHP form's own suggestions): never default to unlimited.
    dailyTokenBudget: 1000000,
    rateLimitPerSession: 30,
    maxMessageLength: parseNullableInt(input.maxMessageLength) ?? 2000,
    maxMessagesPerConversation: parseNullableInt(input.maxMessagesPerConversation) ?? 50,
  });
  await logAudit(db, {
    adminId: actor.admin_id,
    userId: actor.user_id,
    action: "create_chatbot",
    entityType: "chatbot",
    entityId: id,
    newValue: { name: input.name, industry: input.industry },
  });
  return id;
}

export async function updateChatbotFromInput(
  db: DbClient,
  actor: SessionUser,
  id: number,
  input: ChatbotFormInput,
): Promise<void> {
  const existing = await findChatbotById(db, id);
  const oldStrategy = existing?.retrieval_strategy ?? "traditional_rag";
  const newStrategy = input.retrievalStrategy || "traditional_rag";

  const status = input.status === "paused" ? "paused" : "active";
  await updateChatbot(db, id, {
    name: input.name,
    industry: input.industry || null,
    system_prompt: input.systemPrompt || null,
    model_config: buildModelConfig(input),
    styling: buildStyling(input),
    status,
    lead_capture_enabled: boolish(input.leadCaptureEnabled),
    retrieval_strategy: newStrategy,
    daily_token_budget: parseTokenBudget(input.dailyTokenBudget),
    rate_limit_per_session: parseRateLimitPerSession(input.rateLimitPerSession),
    // Tenant anti-abuse limits: blank = "use the server ceiling" (the effective
    // limit is the lower of the two, so these can only tighten protection).
    rate_limit_per_ip: parseNullableInt(input.rateLimitPerIp),
    rate_limit_per_token: parseNullableInt(input.rateLimitPerToken),
    allowed_domains: processAllowedDomains(input.allowedDomains),
    max_message_length: parseNullableInt(input.maxMessageLength),
    max_messages_per_conversation: parseNullableInt(input.maxMessagesPerConversation),
  });
  await logAudit(db, {
    adminId: actor.admin_id,
    userId: actor.user_id,
    action: "update_chatbot",
    entityType: "chatbot",
    entityId: id,
  });

  // Re-process existing documents against the new strategy (they keep their stored
  // parsed text so no re-parse or re-upload is needed).
  if (oldStrategy !== newStrategy) {
    await enqueueReprocessForChatbot(db, actor.admin_id, id);
  }
}

export async function cloneChatbot(db: DbClient, actor: SessionUser, sourceId: number, newName: string): Promise<number> {
  const id = await repoCloneChatbot(db, sourceId, newName);
  await logAudit(db, {
    adminId: actor.admin_id,
    userId: actor.user_id,
    action: "clone_chatbot",
    entityType: "chatbot",
    entityId: id,
  });
  return id;
}