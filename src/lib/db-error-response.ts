import { NextResponse } from "next/server";
import { DB_UNAVAILABLE_MESSAGE, isDatabaseUnavailable } from "./db-errors";

/**
 * HTTP mapping for database outages.
 *
 * Lives apart from `lib/db-errors.ts` because that module is imported by client
 * components; this one pulls in `next/server` and must stay server-only.
 *
 * Why 503 and not 500: an unreachable database is a temporary, retryable
 * condition of the whole service, and callers should be able to tell it apart
 * from a bug in the request. The body is JSON in the same `{ error }` shape the
 * public API already uses, so `widget.js` (which shows its own generic message
 * for any non-2xx) keeps working unchanged while other clients can react.
 */
export function dbUnavailableResponse(origin = ""): NextResponse {
  const res = NextResponse.json(
    { error: DB_UNAVAILABLE_MESSAGE, retryable: true },
    { status: 503 },
  );
  res.headers.set("Retry-After", "30");
  if (origin !== "") {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.append("Vary", "Origin");
  }
  return res;
}

/**
 * Run a route handler body, converting an unreachable database into a 503 JSON
 * response instead of an unhandled exception (which Next.js renders as an HTML
 * 500 that no JSON client can parse).
 */
export async function dbGuarded(
  handler: () => Promise<NextResponse>,
  origin = "",
): Promise<NextResponse> {
  try {
    return await handler();
  } catch (err) {
    if (isDatabaseUnavailable(err)) return dbUnavailableResponse(origin);
    throw err;
  }
}
