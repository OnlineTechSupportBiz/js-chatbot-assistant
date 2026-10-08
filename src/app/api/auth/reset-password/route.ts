import { NextRequest, NextResponse } from "next/server";
import { getSession, readBody, csrfCheck } from "@/lib/auth/http";
import { withTransaction } from "@/lib/db";
import { dbGuarded } from "@/lib/db-error-response";
import { resetPassword } from "@/lib/auth/auth";

export async function POST(request: NextRequest) {
  return dbGuarded(async () => {
    const session = await getSession(request);
    const body = await readBody(request);
    const csrfErr = csrfCheck(body._csrf, session);
    if (csrfErr) return csrfErr;

    const result = await withTransaction((db) => resetPassword(db, body.email ?? "", body.token ?? "", body.password ?? ""));

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ ok: true, redirect: "/login" });
  });
}
