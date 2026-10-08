import type { DbClient } from "@/lib/db";
import type { ChatbotRow, ModelConfig } from "@/repository/chatbots";
import type { ChatCompletions, ChatMessage, ChatCompletionResult } from "@/lib/openai/client";
import type { RetrievalStrategy, RetrievalResult } from "@/lib/retrieval/engine";
import { CHAT_PROMPTS } from "@/lib/chatbot/prompts";
import { scanPrompt, type PromptScanCategory } from "@/lib/chatbot/prompt-scanner";
import { findOrCreate, touch, countRecentBySession, sumTokensUsedToday } from "@/repository/conversations";
import { createMessage, getRecentByConversation, findByConversation } from "@/repository/messages";
import { matchMessage } from "@/repository/quick-answers";
import { findByConversation as findLeadByConversation, createLead, updateLead } from "@/repository/leads";
import { logAudit } from "@/repository/audit-logs";
import {
  reserveTokens as defaultReserveTokens,
  releaseReservation as defaultReleaseReservation,
  type Reservation,
  type ReserveOptions,
} from "@/repository/token-reservations";

const POLITE_BLOCKED_REPLY =
  "I'm sorry, I'm not able to help with that request. Is there something else I can assist you with?";

/**
 * Thrown when a guardrail refuses the request instead of answering politely
 * (per-session rate limit, daily token budget). A typed error lets the public
 * route answer 429 — previously these surfaced as a generic 500.
 */
export class ChatGuardrailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatGuardrailError";
  }
}

export type ChatSource =
  | "quick_answer"
  | "blocked"
  | "rag"
  | "traditional_rag"
  | "page_index"
  | "llm_only";

export interface ChatResult {
  reply: string;
  conversation_id: number;
  source: ChatSource;
  chunks_used: number;
}

export interface ChatDeps {
  db: DbClient;
  openai: ChatCompletions;
  retrieval: RetrievalStrategy;
  adminId: number;
  chatbot: ChatbotRow;
  visitorSessionId: string;
  userMessage: string;
  visitorIp: string | null;
  /** API-key owner (created_by); falls back to adminId when unset. */
  userId?: number | null;
  now?: () => number;
  /**
   * Daily-budget reservation hooks (SEC-20). The default implementation commits a
   * short transaction on its own pooled connection — injectable so unit tests,
   * which drive a fake `db`, can exercise the guardrail hermetically.
   */
  reserveTokens?: (opts: ReserveOptions) => Promise<Reservation | null>;
  releaseReservation?: (id: number) => Promise<void>;
}

interface ExtractedLead {
  name: string | null;
  email: string | null;
  phone: string | null;
  summary: string | null;
}

/** PHP `mb_strlen` (code points). */
function mbStrlen(s: string): number {
  return [...s].length;
}

/** PHP `strlen` (UTF-8 byte count). */
function strlenBytes(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

/** Context every guardrail needs in order to record its decision. */
interface GuardContext {
  adminId: number;
  userIdForAudit: number | null;
  chatbotId: number;
  conversationId: number;
  visitorSessionId: string;
  startTime: number;
  now: () => number;
}

/**
 * Reply to a request that tripped a guardrail: audit the reason, store the polite
 * reply and touch the conversation. The visitor never sees an error or a filter
 * message (PHP behaviour), but the tenant gets the trail.
 */
async function blockedReply(
  db: DbClient,
  ctx: GuardContext,
  audit: Record<string, unknown>,
): Promise<ChatResult> {
  await logAudit(db, {
    adminId: ctx.adminId,
    userId: ctx.userIdForAudit,
    action: "abuse_guardrail",
    entityType: "chatbot",
    entityId: ctx.chatbotId,
    newValue: { ...audit, conversation_id: ctx.conversationId },
  });
  await createMessage(db, {
    adminId: ctx.adminId,
    chatbotId: ctx.chatbotId,
    conversationId: ctx.conversationId,
    visitorSessionId: ctx.visitorSessionId,
    role: "assistant",
    content: POLITE_BLOCKED_REPLY,
    tokensUsed: 0,
    responseTimeMs: ctx.now() - ctx.startTime,
    source: "blocked",
  });
  await touch(db, ctx.conversationId);
  return {
    reply: POLITE_BLOCKED_REPLY,
    conversation_id: ctx.conversationId,
    source: "blocked",
    chunks_used: 0,
  };
}

export async function extractLeadInfo(
  openai: ChatCompletions,
  messages: Array<{ role: string; content: string }>,
  modelConfig: { model?: string; temperature?: number; max_tokens?: number },
): Promise<ExtractedLead> {
  let allUserText = "";
  for (const m of messages) {
    if (m.role === "user") allUserText += "\n" + (m.content ?? "");
  }
  allUserText = allUserText.trim();
  if (allUserText === "") {
    return { name: null, email: null, phone: null, summary: null };
  }

  const systemMessage = CHAT_PROMPTS.extractSystem;
  try {
    const result: ChatCompletionResult = await openai.chatCompletion(
      [
        { role: "system", content: systemMessage },
        { role: "user", content: allUserText },
      ],
      {
        model: modelConfig.model ?? "gpt-4.1-mini",
        temperature: modelConfig.temperature ?? 0.0,
        max_tokens: modelConfig.max_tokens ?? 1024,
        response_format: { type: "json_object" },
      },
    );
    const data = JSON.parse(result.content) as Record<string, unknown>;
    return {
      name: data.name ? String(data.name).trim() : null,
      email: data.email ? String(data.email).trim() : null,
      phone: data.phone ? String(data.phone).trim() : null,
      summary: data.summary ? String(data.summary).trim() : null,
    };
  } catch {
    return { name: null, email: null, phone: null, summary: null };
  }
}

/**
 * Core chat pipeline — port of PHP `ChatController::processQuery`.
 * Guardrails (max length, max messages, prompt injection) return a polite blocked
 * reply; rate-limit / daily-budget violations THROW (surfaced only by the internal
 * test endpoint, matching PHP where the public path swallows the message).
 */
export async function processQuery(deps: ChatDeps): Promise<ChatResult> {
  const { db, openai, retrieval, adminId, chatbot, visitorSessionId, userMessage, visitorIp, userId } = deps;
  const now = deps.now ?? Date.now;
  const chatbotId = chatbot.id;
  const systemPrompt = chatbot.system_prompt ?? "";
  const modelConfig: ModelConfig = chatbot.model_config ?? { temperature: 0.0, max_tokens: 1024, model: "gpt-4.1-mini" };
  const userIdForAudit = userId ?? null;
  // Worst-case completion for this request, used to claim budget up front.
  const maxTokens = modelConfig.max_tokens ?? 1024;
  const reserve = deps.reserveTokens ?? ((o: ReserveOptions) => defaultReserveTokens(o));
  const release = deps.releaseReservation ?? ((id: number) => defaultReleaseReservation(id));

  // 1. Find or create conversation
  const conversation = await findOrCreate(db, adminId, chatbotId, visitorSessionId, visitorIp);
  const conversationId = conversation?.id ?? 0;

  const startTime = now();

  // ── Guardrails (silent abuse prevention) ──
  // Every check runs BEFORE anything is persisted or sent to a model, so a
  // hostile request costs no row, no embedding and no completion. Each one logs an
  // abuse_guardrail audit entry and answers with a polite reply, so the visitor
  // never sees an error or a filter message.
  const guardCtx: GuardContext = {
    adminId,
    userIdForAudit,
    chatbotId,
    conversationId,
    visitorSessionId,
    startTime,
    now,
  };

  // 2. Message length — checked before the write. The previous order persisted the
  //    oversized message and only then rejected it, so the limit capped the prompt
  //    but not the database.
  if (chatbot.max_message_length && mbStrlen(userMessage) > chatbot.max_message_length) {
    return blockedReply(db, guardCtx, {
      guardrail: "max_message_length",
      length: mbStrlen(userMessage),
      limit: chatbot.max_message_length,
    });
  }

  // 3. Store the user's message
  await createMessage(db, { adminId, chatbotId, conversationId, visitorSessionId, role: "user", content: userMessage });

  if (chatbot.max_messages_per_conversation) {
    const maxMsgs = chatbot.max_messages_per_conversation;
    const messageCount = conversation?.message_count ?? 0;
    if (messageCount >= maxMsgs) {
      return blockedReply(db, guardCtx, {
        guardrail: "max_messages_per_conversation",
        message_count: messageCount,
        limit: maxMsgs,
      });
    }
  }

  const injectionCategory: PromptScanCategory | null = scanPrompt(userMessage);
  if (injectionCategory !== null) {
    return blockedReply(db, guardCtx, {
      guardrail: "prompt_injection",
      category: injectionCategory,
      message_preview: [...userMessage].slice(0, 200).join(""),
    });
  }

  // ── Cost & abuse protection (before any LLM call) ──
  if (chatbot.rate_limit_per_session) {
    const recentCount = await countRecentBySession(db, chatbotId, visitorSessionId, 1);
    if (recentCount >= chatbot.rate_limit_per_session) {
      await logAudit(db, {
        adminId, userId: userIdForAudit, action: "abuse_guardrail", entityType: "chatbot", entityId: chatbotId,
        newValue: {
          guardrail: "rate_limit_per_session",
          recent_count: recentCount,
          limit: chatbot.rate_limit_per_session,
          conversation_id: conversationId,
        },
      });
      throw new ChatGuardrailError("You're sending messages too quickly. Please wait a moment and try again.");
    }
  }

  if (chatbot.daily_token_budget) {
    const tokensToday = await sumTokensUsedToday(db, chatbotId);
    if (tokensToday >= chatbot.daily_token_budget) {
      // Recorded in the audit trail like every other guardrail. This is the
      // fail-fast read; the race it cannot close is closed by the reservation
      // taken just before the model call (SEC-20).
      await logAudit(db, {
        adminId, userId: userIdForAudit, action: "abuse_guardrail", entityType: "chatbot", entityId: chatbotId,
        newValue: {
          guardrail: "daily_token_budget",
          reason: "exhausted",
          tokens_today: tokensToday,
          limit: chatbot.daily_token_budget,
          conversation_id: conversationId,
        },
      });
      throw new ChatGuardrailError("This chatbot has reached its daily message budget. Please try again tomorrow.");
    }
  }

  // 4. Quick answers (trigger-based exact match). Deliberately AFTER the
  //    guardrails: when this ran first, a caller who knew a trigger — they are
  //    public via /api/public/quick-answers — skipped the length, message-count,
  //    injection, per-session rate and daily-budget checks entirely.
  const quickMatch = await matchMessage(db, adminId, chatbotId, userMessage);
  if (quickMatch) {
    const reply = quickMatch.answer;
    const responseTimeMs = now() - startTime;
    const tokensUsed = Math.floor((strlenBytes(userMessage) + strlenBytes(reply)) / 4);
    await createMessage(db, {
      adminId,
      chatbotId,
      conversationId,
      visitorSessionId,
      role: "assistant",
      content: reply,
      tokensUsed,
      responseTimeMs,
      source: "quick_answer",
    });
    await touch(db, conversationId);
    return { reply, conversation_id: conversationId, source: "quick_answer", chunks_used: 0 };
  }

  // 5. Retrieval
  const retrievalResult: RetrievalResult = await retrieval.retrieve({ db, adminId, chatbot, query: userMessage });
  const chunksUsed = retrievalResult.chunksUsed;
  const ragContext = retrievalResult.context;

  // 6. Recent history (context window)
  const recentMessages = await getRecentByConversation(db, conversationId, 10);

  // 7. Assemble messages
  let systemMessage = systemPrompt !== "" ? systemPrompt : CHAT_PROMPTS.defaultSystemPrompt;

  if (ragContext !== "") {
    systemMessage += CHAT_PROMPTS.ragContextPrefix + ragContext + CHAT_PROMPTS.ragContextSuffix;
  }

  if (chatbot.lead_capture_enabled) {
    const existingLead = await findLeadByConversation(db, conversationId);
    if (existingLead === null) {
      systemMessage += CHAT_PROMPTS.leadCaptureInstruction;
    }
  }

  const messages: ChatMessage[] = [{ role: "system", content: systemMessage }];
  for (const m of recentMessages) {
    if (m.role === "user" || m.role === "assistant") {
      messages.push({ role: m.role, content: m.content });
    }
  }

  // 8. Daily token budget — CLAIM the tokens before spending them (SEC-20). The
  //    check above refuses a budget that is already exhausted; it cannot stop a
  //    burst, because every concurrent request reads the same "used today" figure
  //    and every one of them concludes it is under budget. The claim is evaluated
  //    under an advisory lock and committed on its own connection, so the other
  //    in-flight requests see it immediately (a write inside this request's
  //    transaction would stay invisible until it commits, which is far too late).
  //    It expires on its own if this request dies before it can be settled.
  let reservation: Reservation | null = null;
  if (chatbot.daily_token_budget) {
    reservation = await reserve({
      adminId,
      chatbotId,
      budget: chatbot.daily_token_budget,
      estimate: maxTokens,
    });
    if (reservation === null) {
      await logAudit(db, {
        adminId, userId: userIdForAudit, action: "abuse_guardrail", entityType: "chatbot", entityId: chatbotId,
        newValue: {
          guardrail: "daily_token_budget",
          reason: "reservation_refused",
          estimate_tokens: maxTokens,
          limit: chatbot.daily_token_budget,
          conversation_id: conversationId,
        },
      });
      throw new ChatGuardrailError("This chatbot has reached its daily message budget. Please try again tomorrow.");
    }
  }

  // 9. OpenAI chat completion
  const temperature = modelConfig.temperature ?? 0.0;
  const model = modelConfig.model ?? "gpt-4.1-mini";
  // The retrieval engine reports which strategy produced the context
  // (traditional_rag or page_index); when it found nothing the answer came
  // from the model alone. "rag" remains valid for legacy rows.
  const source: ChatSource =
    chunksUsed > 0 &&
    (retrievalResult.source === "traditional_rag" ||
      retrievalResult.source === "page_index")
      ? retrievalResult.source
      : "llm_only";

  let reply: string;
  try {
    const chatResult: ChatCompletionResult = await openai.chatCompletion(messages, {
      model,
      temperature,
      max_tokens: maxTokens,
    });
    reply = chatResult.content;
    const responseTimeMs = now() - startTime;

    // 10. Store assistant response with real token count
    await createMessage(db, {
      adminId, chatbotId, conversationId, visitorSessionId,
      role: "assistant", content: reply, tokensUsed: chatResult.total_tokens, responseTimeMs, source,
    });
  } finally {
    // The real usage is now recorded, so the worst-case claim is no longer needed.
    // A failure to release must not mask the original error: the reservation
    // expires by itself, which only makes the ceiling more conservative.
    if (reservation !== null) await release(reservation.id).catch(() => undefined);
  }

  // 11. Touch conversation
  await touch(db, conversationId);

  // 12. Lead capture
  if (chatbot.lead_capture_enabled) {
    const existingLead = await findLeadByConversation(db, conversationId);
    const allMessages = await findByConversation(db, conversationId);
    const extracted = await extractLeadInfo(openai, allMessages, modelConfig);

    if (existingLead === null) {
      if (extracted.name || extracted.email || extracted.phone) {
        await createLead(db, {
          adminId, chatbotId, conversationId, visitorSessionId,
          name: extracted.name, email: extracted.email, phone: extracted.phone, summary: extracted.summary,
        });
      }
    } else {
      const updates: Record<string, unknown> = {};
      if (extracted.name && !existingLead.name) updates.name = extracted.name;
      if (extracted.email && !existingLead.email) updates.email = extracted.email;
      if (extracted.phone && !existingLead.phone) updates.phone = extracted.phone;
      if (extracted.summary) updates.summary = extracted.summary;
      if (Object.keys(updates).length > 0) {
        await updateLead(db, existingLead.id, updates);
      }
    }
  }

  return { reply, conversation_id: conversationId, source, chunks_used: chunksUsed };
}

/**
 * Origin check against the saved allow list (PHP `isOriginAllowed`).
 * No allow list → allow all; wildcard `host:*`, exact host:port, and bare-host-any-port.
 */
export function isOriginAllowed(origin: string, allowedDomains: string | null | undefined, host = ""): boolean {
  if (allowedDomains == null || allowedDomains.trim() === "") return true;

  let originHost: string;
  let normalizedOrigin: string;

  if (origin !== "") {
    if (/^https?:\/\//i.test(origin)) {
      let u: URL;
      try {
        u = new URL(origin);
      } catch {
        return false;
      }
      const hostLower = u.hostname.toLowerCase();
      if (hostLower === "") return false;
      let port: number | null = u.port ? parseInt(u.port, 10) : null;
      if (port !== null && ((u.protocol === "http:" && port === 80) || (u.protocol === "https:" && port === 443))) {
        port = null;
      }
      originHost = hostLower;
      normalizedOrigin = hostLower + (port !== null ? `:${port}` : "");
    } else {
      const lower = origin.toLowerCase();
      normalizedOrigin = lower;
      originHost = lower;
    }
  } else {
    const h = host.toLowerCase();
    const parts = h.split(":");
    originHost = parts[0];
    normalizedOrigin = h;
  }

  for (let domain of allowedDomains.split("\n")) {
    domain = domain.trim();
    if (domain === "") continue;

    if (domain.endsWith(":*")) {
      const hostPrefix = domain.slice(0, -2);
      if (originHost.toLowerCase() === hostPrefix.toLowerCase()) return true;
    } else if (domain.includes(":")) {
      if (normalizedOrigin.toLowerCase() === domain.toLowerCase()) return true;
    } else {
      const originHostOnly = normalizedOrigin.replace(/:\d+$/, "");
      if (originHostOnly.toLowerCase() === domain.toLowerCase()) return true;
    }
  }

  return false;
}