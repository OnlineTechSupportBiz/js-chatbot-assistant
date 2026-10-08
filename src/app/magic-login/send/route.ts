import { NextRequest, NextResponse } from "next/server";
import { getSession, readBody, csrfCheck, deliverAuthEmail, clientRateBucket } from "@/lib/auth/http";
import { withTransaction } from "@/lib/db";
import { dbGuarded } from "@/lib/db-error-response";
import { requestMagicLink, MAGIC_RATE_MAX, AUTH_EMAIL_RATE_WINDOW } from "@/lib/auth/auth";
import { rateLimitCheck, rateLimitRecord } from "@/lib/auth/rate-limiter";
import { magicLinkEmail } from "@/lib/email/mailer";
import { getConfig } from "@/lib/config";

export async function POST(request: NextRequest) {
  return dbGuarded(async () => {
    const session = await getSession(request);
    const body = await readBody(request);
    const csrfErr = csrfCheck(body._csrf, session);
    if (csrfErr) return csrfErr;

    const email = (body.email ?? "").trim().toLowerCase();

    // Unauthenticated endpoint that sends mail: throttle the bucket it came from.
    const bucket = clientRateBucket(request);
    const limit = bucket.shared ? MAGIC_RATE_MAX * 10 : MAGIC_RATE_MAX;
    const allowed = await withTransaction((db) =>
      rateLimitCheck(db, bucket.key, limit, AUTH_EMAIL_RATE_WINDOW, "magic:"),
    );

    if (allowed) {
      await withTransaction((db) => rateLimitRecord(db, bucket.key, "magic:"));
      const result = await withTransaction((db) => requestMagicLink(db, email));
      if (result.token) {
        await deliverAuthEmail(result.email, magicLinkEmail(getConfig().url, result.token, result.brandName));
      }
    }

    // Anti-enumeration: identical response whether or not a link was sent.
    return NextResponse.json({
      ok: true,
      message: "If that email exists, a sign-in link has been sent.",
    });
  });
}
