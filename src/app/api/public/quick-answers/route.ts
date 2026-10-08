import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { dbGuarded } from "@/lib/db-error-response";
import { findByWidgetToken } from "@/repository/chatbots";
import { findUserById } from "@/repository/users";
import { userHasPermission } from "@/repository/user-permissions";
import { findActiveByChatbot } from "@/repository/quick-answers";
import { isOriginAllowed } from "@/lib/chatbot/chat";

function applyOrigin(res: NextResponse, origin: string): NextResponse {
  if (origin !== "") {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.append("Vary", "Origin");
  }
  return res;
}

type QaOutcome =
  | { kind: "ok"; items: Array<{ trigger: string; answer: string }> }
  | { kind: "error"; status: number; error: string };

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get("origin") ?? "";
  const host = request.headers.get("host") ?? "";
  const widgetToken = (request.nextUrl.searchParams.get("widget_token") ?? "").trim();

  if (widgetToken === "") {
    return NextResponse.json({ error: "widget_token is required" }, { status: 400 });
  }

  return dbGuarded(async () => {
    const outcome = await withTransaction(async (db): Promise<QaOutcome> => {
      const b = await findByWidgetToken(db, widgetToken);
      if (!b) return { kind: "error", status: 404, error: "Invalid or inactive chatbot" };
      if (!isOriginAllowed(origin, b.allowed_domains, host))
        return { kind: "error", status: 403, error: "Origin not allowed" };

      const permUserId = b.created_by ?? b.admin_id;
      const owner = await findUserById(db, permUserId);
      if (!owner || !owner.is_active)
        return { kind: "error", status: 403, error: "Account disabled" };
      if (!(await userHasPermission(db, permUserId, "widget_quick_answers"))) {
        return { kind: "error", status: 403, error: "Quick answers are disabled for this account" };
      }

      const items = (await findActiveByChatbot(db, b.admin_id, b.id)).map((qa) => ({
        trigger: qa.trigger,
        answer: qa.answer,
      }));
      return { kind: "ok", items };
    });

    if (outcome.kind === "error") {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }
    return applyOrigin(NextResponse.json(outcome.items), origin);
  }, origin);
}
