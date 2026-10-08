import { NextRequest, NextResponse } from "next/server";
import { readBody, clientRateBucket } from "@/lib/auth/http";
import { withTransaction } from "@/lib/db";
import { dbGuarded } from "@/lib/db-error-response";
import { findByWidgetToken } from "@/repository/chatbots";
import { findBySession, rate } from "@/repository/conversations";
import { rateLimitCheck, rateLimitRecord, rateLimitClear } from "@/lib/auth/rate-limiter";
import { isOriginAllowed } from "@/lib/chatbot/chat";

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

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get("origin") ?? "";
  const host = request.headers.get("host") ?? "";
  const body = await readBody(request);
  const widgetToken = (body.widget_token ?? "").trim();
  const visitorSessionId = (body.session_id ?? "").trim();
  const rawRating = (body.rating ?? "").trim();

  if (widgetToken === "" || visitorSessionId === "" || rawRating === "") {
    return NextResponse.json(
      { error: "widget_token, session_id, and rating are required" },
      { status: 400 },
    );
  }

  const bucket = clientRateBucket(request);

  return dbGuarded(
    () =>
      withTransaction(async (db) => {
        // Per-bucket limit. The attempt is recorded (the counter previously only
        // advanced for an *already rated* conversation, so the window never filled
        // on the normal path and the limit never fired); a shared bucket gets a
        // larger allowance so it cannot be exhausted to block everyone.
        const max = bucket.shared ? 100 : 10;
        if (!(await rateLimitCheck(db, bucket.key, max, 300, "rating:"))) {
          return NextResponse.json(
            { error: "Too many rating attempts. Try again later." },
            { status: 429 },
          );
        }
        await rateLimitRecord(db, bucket.key, "rating:");

        const chatbot = await findByWidgetToken(db, widgetToken);
        if (!chatbot) {
          return NextResponse.json({ error: "Invalid or inactive chatbot" }, { status: 404 });
        }

        if (!isOriginAllowed(origin, chatbot.allowed_domains, host)) {
          return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
        }

        const conversation = await findBySession(db, chatbot.id, visitorSessionId);
        if (!conversation) {
          return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
        }

        if (conversation.rating !== null) {
          return NextResponse.json({ error: "Conversation already rated" }, { status: 409 });
        }

        const saved = await rate(db, conversation.id, rawRating);
        if (!saved) {
          return NextResponse.json({ error: "Invalid rating — must be 1-5" }, { status: 422 });
        }

        await rateLimitClear(db, bucket.key, "rating:");
        return applyOrigin(NextResponse.json({ success: true }), origin);
      }),
    origin,
  );
}
