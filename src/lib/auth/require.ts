import { NextRequest, NextResponse } from "next/server";
import { getSession, readBody, csrfCheck } from "./http";
import type { SessionManager } from "./session-manager";
import type { SessionUser } from "./session";
import { isAdmin } from "./authorization";
import { isDatabaseUnavailable } from "@/lib/db-errors";
import { dbUnavailableResponse } from "@/lib/db-error-response";

/**
 * Admin route guards. Read endpoints need only an authenticated session (no CSRF);
 * mutating endpoints also parse the body and validate the CSRF token.
 *
 * Both also require the `admin` role. The schema, `findUsersByAdmin` and
 * `user_permissions` all anticipate extra members inside a tenant, so
 * "authenticated" alone would hand every such member the full admin API for the
 * tenant — the role that owns those resources is the one the guards must check.
 */

export type AdminResult<T> =
  | { ok: true; session: SessionManager; user: SessionUser; body: Record<string, string>; value: T }
  | { ok: false; response: NextResponse };

/**
 * Load the session, reporting an unreachable database as a 503 instead of
 * letting the driver error escape.
 *
 * The session is stored in Postgres, so every guard needs the database before it
 * can do anything. Handling the outage here means all admin endpoints answer
 * with a clean JSON error (surfaced by `useFetch` as the message text) rather
 * than a 500 that reads as "Request failed (500)" in the admin UI.
 */
async function startSession(
  request: NextRequest,
): Promise<{ ok: true; session: SessionManager } | { ok: false; response: NextResponse }> {
  try {
    return { ok: true, session: await getSession(request) };
  } catch (err) {
    if (isDatabaseUnavailable(err)) {
      return { ok: false, response: dbUnavailableResponse(request.headers.get("origin") ?? "") };
    }
    throw err;
  }
}

export async function requireAdminSession(request: NextRequest): Promise<AdminResult<undefined>> {
  const started = await startSession(request);
  if (!started.ok) return started;
  const user = started.session.user;
  if (!user)
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!isAdmin(user))
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { ok: true, session: started.session, user, body: {}, value: undefined };
}

export async function requireAdminUser(request: NextRequest): Promise<AdminResult<undefined>> {
  const started = await startSession(request);
  if (!started.ok) return started;
  const session = started.session;
  const user = session.user;
  if (!user)
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!isAdmin(user))
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const body = await readBody(request);
  const csrf = csrfCheck(body._csrf, session);
  if (csrf) return { ok: false, response: csrf };
  return { ok: true, session, user, body, value: undefined };
}
