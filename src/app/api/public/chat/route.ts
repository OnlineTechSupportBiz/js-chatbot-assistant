import { NextRequest, NextResponse } from "next/server";
import { clientIp, readBody, clientRateBucket } from "@/lib/auth/http";
import { withTransaction } from "@/lib/db";
import { dbUnavailableResponse } from "@/lib/db-error-response";
import { isDatabaseUnavailable } from "@/lib/db-errors";
import { getConfig } from "@/lib/config";
import { rateLimitCheck, rateLimitRecord } from "@/lib/auth/rate-limiter";
import { findByWidgetToken } from "@/repository/chatbots";
import { findUserById, getApiKeys, getLlmModels } from "@/repository/users";
import { userHasPermission } from "@/repository/user-permissions";
import { OpenAIClient, resolveOpenAIConfig, buildLlmChatClient } from "@/lib/openai/client";
import { RetrievalEngine } from "@/lib/retrieval/engine";
import { processQuery, isOriginAllowed, ChatGuardrailError } from "@/lib/chatbot/chat";
import { effectiveRateLimits } from "@/lib/chatbot/limits";
import { EmbeddingDimensionMismatchError } from "@/repository/document-chunks";

function applyOrigin(res: NextResponse, origin: string): NextResponse {
  if (origin !== "") {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.append("Vary", "Origin");
  }
  return res;
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/**
 * Absolute ceiling on a single visitor message, independent of the per-chatbot
 * `max_message_length`: a chatbot with that setting unset previously had no
 * server-side limit at all, and `readBody` buffers whatever it is sent.
 */
const HARD_MAX_MESSAGE_CHARS = 8000;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get("origin") ?? "";
  const host = request.headers.get("host") ?? "";
  const body = await readBody(request);
  const widgetToken = (body.widget_token ?? "").trim();
  const userMessage = (body.message ?? "").trim();
  const visitorSessionId = (body.session_id ?? "").trim();

  if (widgetToken === "" || userMessage === "" || visitorSessionId === "") {
    return NextResponse.json(
      { error: "widget_token, message, and session_id are required" },
      { status: 400 },
    );
  }

  if (userMessage.length > HARD_MAX_MESSAGE_CHARS) {
    return NextResponse.json(
      { error: `Message exceeds the ${HARD_MAX_MESSAGE_CHARS} character limit` },
      { status: 413 },
    );
  }

  try {
    // Server-keyed abuse limits, before any model work. The per-chatbot
    // `rate_limit_per_session` is keyed on a client-supplied session id, so on its
    // own it bounds nothing: rotating session_id reset the counter on every
    // request and every call was billable. These two keys cannot be chosen by the
    // caller — the widget token itself, and the IP bucket when it is trustworthy.
    // The tenant's own (stricter) limits are applied after the chatbot is loaded,
    // below; the effective value is always the lower of the two.
    const limits = getConfig().publicChatRate;
    const bucket = clientRateBucket(request);
    const ceilings = effectiveRateLimits(
      limits,
      { rate_limit_per_ip: null, rate_limit_per_token: null },
      bucket.shared,
    );
    const withinLimits = await withTransaction(async (db) => {
      const ipOk = await rateLimitCheck(db, bucket.key, ceilings.ipMax, ceilings.windowSeconds, "chat:");
      const tokenOk = await rateLimitCheck(
        db,
        widgetToken,
        ceilings.tokenMax,
        ceilings.windowSeconds,
        "chattok:",
      );
      if (ipOk && tokenOk) {
        await rateLimitRecord(db, bucket.key, "chat:");
        await rateLimitRecord(db, widgetToken, "chattok:");
      }
      return ipOk && tokenOk;
    });

    if (!withinLimits) {
      return applyOrigin(
        NextResponse.json({ error: "Too many requests" }, { status: 429 }),
        origin,
      );
    }

    return await withTransaction(async (db) => {
      const chatbot = await findByWidgetToken(db, widgetToken);
      if (!chatbot) {
        return NextResponse.json({ error: "Invalid or inactive chatbot" }, { status: 404 });
      }

      if (!isOriginAllowed(origin, chatbot.allowed_domains, host)) {
        return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
      }

      // Tenant-level anti-abuse limits, applied on top of the server ceilings. They
      // can only tighten (see `effectiveRateLimits`): the tenant controls their own
      // chatbot's exposure, never the platform's.
      //
      // Check-only, and deliberately asked for `limit + 1`: this request already
      // counted toward the server limits above, so the stored count includes it —
      // "N per window" means the Nth request still passes, which is `count <= N`.
      // `rateLimitCheck` allows while `count < max`, so passing `N + 1` expresses
      // exactly that without inventing a second counting path.
      const tenant = effectiveRateLimits(limits, chatbot, bucket.shared);
      if (tenant.ipMax < ceilings.ipMax || tenant.tokenMax < ceilings.tokenMax) {
        const ipOk = await rateLimitCheck(
          db,
          bucket.key,
          tenant.ipMax + 1,
          tenant.windowSeconds,
          "chat:",
        );
        const tokenOk = await rateLimitCheck(
          db,
          widgetToken,
          tenant.tokenMax + 1,
          tenant.windowSeconds,
          "chattok:",
        );
        if (!ipOk || !tokenOk) {
          return applyOrigin(
            NextResponse.json({ error: "Too many requests" }, { status: 429 }),
            origin,
          );
        }
      }

      const permUserId = chatbot.created_by ?? chatbot.admin_id;
      const adminId = chatbot.admin_id;

      const owner = await findUserById(db, permUserId);
      if (!owner || !owner.is_active) {
        return NextResponse.json({ error: "Account disabled" }, { status: 403 });
      }

      if (!(await userHasPermission(db, permUserId, "widget_chat"))) {
        return NextResponse.json(
          { error: "Chat widget is disabled for this account" },
          { status: 403 },
        );
      }

      const keyOwnerId = chatbot.created_by ?? chatbot.admin_id;
      const keys = await getApiKeys(db, keyOwnerId);
      const models = await getLlmModels(db, keyOwnerId);
      if (models.length === 0 && !keys.openai_api_key) {
        return NextResponse.json(
          { error: "Chatbot is not configured (missing API keys)" },
          { status: 503 },
        );
      }

      const embedder = new OpenAIClient(resolveOpenAIConfig(keys));
      const chat = buildLlmChatClient(
        models,
        chatbot.model_config?.model,
        resolveOpenAIConfig(keys),
      );
      const result = await processQuery({
        db,
        openai: chat,
        retrieval: new RetrievalEngine(embedder, chat),
        adminId,
        chatbot,
        visitorSessionId,
        userMessage,
        visitorIp: clientIp(request),
        userId: keyOwnerId,
      });

      return applyOrigin(NextResponse.json(result), origin);
    });
  } catch (err) {
    // An unreachable database is a temporary service condition, not a request
    // error: answer 503 JSON so clients can retry, instead of an opaque 500.
    if (isDatabaseUnavailable(err)) return dbUnavailableResponse(origin);
    // A guardrail rejection (rate limit, daily budget) is a client condition, so it
    // answers 429 rather than the generic 500 it used to produce.
    if (err instanceof ChatGuardrailError) {
      return applyOrigin(NextResponse.json({ error: err.message }, { status: 429 }), origin);
    }
    // The knowledge base was indexed with a different embedding model than the one
    // now configured. The tenant has to re-index; the message says so, and 503 (not
    // 500) marks it as a configuration state rather than a crash.
    if (err instanceof EmbeddingDimensionMismatchError) {
      return applyOrigin(NextResponse.json({ error: err.message }, { status: 503 }), origin);
    }
    return NextResponse.json(
      { error: "An error occurred processing your request" },
      { status: 500 },
    );
  }
}
