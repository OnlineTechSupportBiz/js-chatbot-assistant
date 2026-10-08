import { NextRequest, NextResponse } from "next/server";
import { getSession, readBody, csrfCheck, deliverAuthEmail, clientRateBucket } from "@/lib/auth/http";
import { withTransaction } from "@/lib/db";
import { regenerateVerificationToken, RESEND_RATE_MAX, AUTH_EMAIL_RATE_WINDOW } from "@/lib/auth/auth";
import { rateLimitCheck, rateLimitRecord } from "@/lib/auth/rate-limiter";
import { verificationEmail } from "@/lib/email/mailer";
import { getConfig } from "@/lib/config";

export async function POST(request: NextRequest) {
  const session = await getSession(request);
  const body = await readBody(request);
  const csrfErr = csrfCheck(body._csrf, session);
  if (csrfErr) return csrfErr;

  const email = (body.email ?? "").trim().toLowerCase();

  // Unauthenticated endpoint that sends mail: throttle the bucket it came from
  // (a shared bucket gets a larger allowance so it cannot be exhausted to block
  // everyone). When the limit is hit nothing is sent and the response is
  // unchanged, so the endpoint stays enumeration-neutral.
  const bucket = clientRateBucket(request);
  const limit = bucket.shared ? RESEND_RATE_MAX * 10 : RESEND_RATE_MAX;
  const allowed = await withTransaction((db) =>
    rateLimitCheck(db, bucket.key, limit, AUTH_EMAIL_RATE_WINDOW, "resend:"),
  );

  if (allowed) {
    await withTransaction((db) => rateLimitRecord(db, bucket.key, "resend:"));
    const result = await withTransaction((db) => regenerateVerificationToken(db, email));
    if (result.token) {
      const content = verificationEmail(getConfig().url, result.token, "Chatbot Assistant");
      await deliverAuthEmail(email, content);
    }
  }

  // Uniform response (anti-enumeration).
  return NextResponse.json({ ok: true });
}