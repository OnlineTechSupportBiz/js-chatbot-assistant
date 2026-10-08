import { cookies } from "next/headers";
import { SessionManager, PostgresSessionStore } from "./session-manager";
import { getConfig } from "@/lib/config";

/**
 * Server-side session lookup for server components / route layouts.
 * Mirrors `getSession(request)` but reads cookies via `next/headers`.
 */
export async function getServerSession(): Promise<SessionManager> {
  const cookieName = getConfig().session.cookieName;
  const id = (await cookies()).get(cookieName)?.value ?? null;
  return SessionManager.start(new PostgresSessionStore(), id);
}